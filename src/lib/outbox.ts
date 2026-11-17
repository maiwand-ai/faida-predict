// S-02 — Transactional outbox.
// Events are written inside the SAME prisma transaction as the state change,
// then drained asynchronously by the dispatcher. No dual-write window.
import { db } from "@/lib/db";
import { EMAIL_EVENT_TYPES, emailSubjectFor, notifyEnvStatus, sendEmail } from "@/lib/notify";
import { notifyUser } from "@/lib/notifications";

export type OutboxAggregate = "ORDER" | "ROBOT" | "LEDGER" | "RECONCILIATION" | "MODEL";
export type OutboxEventType =
  | "ORDER_STATE_CHANGED"
  | "ORDER_FILLED"
  | "ROBOT_STATE_CHANGED"
  | "RISK_PAUSE"
  | "LEDGER_APPENDED"
  | "RECONCILIATION_OPENED"
  | "RECONCILIATION_RESOLVED"
  | "PLATFORM_PAUSED"
  | "PLATFORM_RESUMED"
  | "MODEL_PROMOTED"
  | "MODEL_DEMOTED"
  // Phase 7 — gated live automation
  | "CONSENT_RECORDED"
  | "CONSENT_REVOKED"
  | "LIVE_PILOT_UPDATED"
  | "ROBOT_MODE_LIVE_PILOT"
  | "LIVE_ORDER_SIGNED_NOT_SENT"
  | "LIVE_ORDER_ACCEPTED"
  | "LIVE_ORDER_REJECTED"
  | "LIVE_ORDER_ACK_LOST"
  // Phase 8 — commercial platform (P-06/P-07 audit trail)
  | "API_KEY_CREATED"
  | "API_KEY_REVOKED"
  | "COMPLIANCE_RETENTION_RUN";

export interface OutboxDraft {
  aggregateType: OutboxAggregate;
  aggregateId: string;
  eventType: OutboxEventType;
  payload: Record<string, unknown>;
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

export async function enqueueOutbox(tx: Tx, drafts: OutboxDraft[]): Promise<void> {
  for (const d of drafts) {
    // Awaited — Phase 7 fixed a real bug here: fire-and-forget (`void`) writes
    // were dropped when called with the plain client outside a transaction
    // (pause/consent events silently vanished). Awaited writes inside
    // $transaction callbacks keep the same-transaction guarantee (S-02).
    await tx.outboxEvent.create({
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
      // P-04 taxonomy: risk pauses are RISK-family (WARNING) with a per-robot
      // dedupe key — a flapping robot cannot storm the feed, but the FIRST
      // pause always lands and any PAUSE after a resume lands too.
      await notifyUser(userId, {
        family: "RISK",
        title: String(data.title ?? "Robot paused by risk"),
        body: String(data.body ?? ""),
        dedupeKey: `risk-pause:${String(data.robotId ?? aggregateId)}`,
      });
    }
  }
  if (eventType === "RECONCILIATION_OPENED") {
    const userId = String(data.userId ?? "");
    if (userId) {
      // P-04 taxonomy: reconciliation openings are EXECUTION/CRITICAL —
      // UNKNOWN orders are the highest-severity signal the platform emits.
      await notifyUser(userId, {
        family: "EXECUTION",
        title: "Order entered reconciliation — venue state unconfirmed",
        body: `Order ${aggregateId}: ${String(data.reason ?? "")}`,
        dedupeKey: `recon-open:${aggregateId}`,
      });
    }
  }
  // Other event types are consumed by the activity feed query at read time.
}
