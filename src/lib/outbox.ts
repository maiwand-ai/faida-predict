// S-02 — Transactional outbox.
// Events are written inside the SAME prisma transaction as the state change,
// then drained asynchronously by the dispatcher. No dual-write window.
import { db } from "@/lib/db";
import { EMAIL_EVENT_TYPES, emailSubjectFor, notifyEnvStatus, sendEmail } from "@/lib/notify";

export type OutboxAggregate = "ORDER" | "ROBOT" | "LEDGER" | "RECONCILIATION";
export type OutboxEventType =
  | "ORDER_STATE_CHANGED"
  | "ORDER_FILLED"
  | "ROBOT_STATE_CHANGED"
  | "RISK_PAUSE"
  | "LEDGER_APPENDED"
  | "RECONCILIATION_OPENED"
  | "RECONCILIATION_RESOLVED"
  | "PLATFORM_PAUSED"
  | "PLATFORM_RESUMED";

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
// in-process consumer (notifications/activity feed) and pages the user by
// email (Resend) for severity-relevant event types. Email is best-effort and
// recorded per-event (emailStatus) — the notification feed stays the source
// of truth. In production the same drain fans out to websockets and analytics.
const EMAIL_CAP_PER_DRAIN = 10; // throttle: never send more than this per drain

export async function drainOutbox(limit = 50): Promise<number> {
  const pending = await db.outboxEvent.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let dispatched = 0;
  let emails = 0;
  for (const ev of pending) {
    try {
      await consume(ev.aggregateType, ev.aggregateId, ev.eventType, ev.payload);
      let emailStatus = "SKIP";
      if (EMAIL_EVENT_TYPES.has(ev.eventType)) {
        if (emails >= EMAIL_CAP_PER_DRAIN) {
          emailStatus = "SKIP"; // throttled — retried only if the event retries
        } else {
          emailStatus = await emailForEvent(ev.aggregateId, ev.eventType, ev.payload);
          if (emailStatus === "SENT") emails++;
        }
      }
      await db.outboxEvent.update({
        where: { id: ev.id },
        data: { status: "DISPATCHED", dispatchedAt: new Date(), attempts: { increment: 1 }, emailStatus },
      });
      dispatched++;
    } catch {
      const attempts = ev.attempts + 1;
      await db.outboxEvent.update({
        where: { id: ev.id },
        data: { status: attempts >= 8 ? "FAILED" : "PENDING", attempts },
      });
    }
  }
  return dispatched;
}

// Resolve the recipient from the event payload's userId and send. Dev/seed
// accounts (*.local) never receive email.
async function emailForEvent(aggregateId: string, eventType: string, payload: string): Promise<string> {
  if (!notifyEnvStatus().resendConfigured) return "NO_KEY";
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return "SKIP";
  }
  const userId = String(data.userId ?? "");
  if (!userId) return "SKIP";
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user || user.email.endsWith(".local")) return "SKIP";
  const subject = emailSubjectFor(eventType);
  const lines = [subject, "", String(data.title ?? data.reason ?? ""), String(data.body ?? data.note ?? "")];
  if (eventType !== "RISK_PAUSE") lines.push("", `Ref: ${aggregateId}`);
  const res = await sendEmail(user.email, subject, lines.filter(Boolean).join("\n"));
  return res.ok ? "SENT" : "FAILED";
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
