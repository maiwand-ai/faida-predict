// S-02 — Transactional outbox.
// Events are written inside the SAME prisma transaction as the state change,
// then drained asynchronously by the dispatcher. No dual-write window.
import { db } from "@/lib/db";

export type OutboxAggregate = "ORDER" | "ROBOT" | "LEDGER" | "RECONCILIATION";
export type OutboxEventType =
  | "ORDER_STATE_CHANGED"
  | "ORDER_FILLED"
  | "ROBOT_STATE_CHANGED"
  | "RISK_PAUSE"
  | "LEDGER_APPENDED"
  | "RECONCILIATION_OPENED"
  | "RECONCILIATION_RESOLVED";

export interface OutboxDraft {
  aggregateType: OutboxAggregate;
  aggregateId: string;
  eventType: OutboxEventType;
  payload: Record<string, unknown>;
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

export function enqueueOutbox(tx: Tx, drafts: OutboxDraft[]): void {
  for (const d of drafts) {
    void tx.outboxEvent.create({
      data: {
        aggregateType: d.aggregateType,
        aggregateId: d.aggregateId,
        eventType: d.eventType,
        payload: JSON.stringify(d.payload),
      },
    });
  }
}

// The dispatcher drains pending events. In the skeleton this delivers to the
// in-process consumer (notifications/activity feed). In production this is the
// point where emails (Resend), websockets and analytics fan out.
export async function drainOutbox(limit = 50): Promise<number> {
  const pending = await db.outboxEvent.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let dispatched = 0;
  for (const ev of pending) {
    try {
      await consume(ev.aggregateType, ev.aggregateId, ev.eventType, ev.payload);
      await db.outboxEvent.update({
        where: { id: ev.id },
        data: { status: "DISPATCHED", dispatchedAt: new Date(), attempts: { increment: 1 } },
      });
      dispatched++;
    } catch {
      await db.outboxEvent.update({
        where: { id: ev.id },
        data: { status: "FAILED", attempts: { increment: 1 } },
      });
    }
  }
  return dispatched;
}

async function consume(
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: string,
): Promise<void> {
  const data = JSON.parse(payload) as Record<string, unknown>;
  if (eventType === "RISK_PAUSE") {
    const userId = String(data.userId ?? "");
    if (userId) {
      await db.notification.create({
        data: {
          userId,
          severity: "WARNING",
          family: "RISK",
          title: String(data.title ?? "Robot paused by risk"),
          body: String(data.body ?? ""),
        },
      });
    }
  }
  if (eventType === "RECONCILIATION_OPENED") {
    const userId = String(data.userId ?? "");
    if (userId) {
      await db.notification.create({
        data: {
          userId,
          severity: "CRITICAL",
          family: "EXECUTION",
          title: "Order entered reconciliation — venue state unconfirmed",
          body: `Order ${aggregateId}: ${String(data.reason ?? "")}`,
        },
      });
    }
  }
  // Other event types are consumed by the activity feed query at read time.
}
