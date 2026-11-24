// P-07 — Compliance operations + data retention (Phase 8).
//
// Policy: EPHEMERAL operational data (price ticks, decision traces,
// notifications, outbox failures) is pruned after its retention window.
// FINANCIAL truth (LedgerEntry, Order, OrderEvent, Fill, Position,
// ReconciliationEntry, RetentionRun) is NEVER pruned — the append-only
// ledger and the order journal are the product (hard invariants 1/2/6).
// Policy keys live in the existing control plane (PlatformControl KV) so
// the operator surface stays one source of truth.
import { db } from "@/lib/db";
import { enqueueOutbox } from "@/lib/outbox";
import { notifyUser } from "@/lib/notifications";
import { getControl, setControl } from "@/lib/control";

export const RETENTION_KEYS = {
  TICKS_DAYS: "RETENTION_TICKS_DAYS",
  TRACES_DAYS: "RETENTION_TRACES_DAYS",
  NOTIFICATIONS_DAYS: "RETENTION_NOTIFICATIONS_DAYS",
  OUTBOX_FAILED_DAYS: "RETENTION_OUTBOX_FAILED_DAYS",
} as const;

// Defaults (days): ticks 90 (backtests read ticks — long enough for evidence
// packs), traces 180 (decision provenance), notifications 30, failed outbox 7.
export const RETENTION_DEFAULTS: Record<string, number> = {
  [RETENTION_KEYS.TICKS_DAYS]: 90,
  [RETENTION_KEYS.TRACES_DAYS]: 180,
  [RETENTION_KEYS.NOTIFICATIONS_DAYS]: 30,
  [RETENTION_KEYS.OUTBOX_FAILED_DAYS]: 7,
};

export const RETENTION_BOUNDS: Record<string, { min: number; max: number }> = {
  [RETENTION_KEYS.TICKS_DAYS]: { min: 7, max: 3650 },
  [RETENTION_KEYS.TRACES_DAYS]: { min: 7, max: 3650 },
  [RETENTION_KEYS.NOTIFICATIONS_DAYS]: { min: 1, max: 3650 },
  [RETENTION_KEYS.OUTBOX_FAILED_DAYS]: { min: 1, max: 3650 },
};

export interface RetentionPolicyView {
  key: string;
  label: string;
  days: number;
  bounds: { min: number; max: number };
}

export async function getRetentionPolicies(): Promise<RetentionPolicyView[]> {
  const labels: Record<string, string> = {
    [RETENTION_KEYS.TICKS_DAYS]: "Price ticks (backtest history)",
    [RETENTION_KEYS.TRACES_DAYS]: "Decision traces (provenance)",
    [RETENTION_KEYS.NOTIFICATIONS_DAYS]: "Notifications (incl. suppressed)",
    [RETENTION_KEYS.OUTBOX_FAILED_DAYS]: "Failed outbox events",
  };
  return Object.values(RETENTION_KEYS).map((key) => {
    const b = RETENTION_BOUNDS[key];
    return { key, label: labels[key], bounds: b, days: getPolicySync(key) };
  });
}

// Policies are read via the control plane; a small sync cache keeps the
// view cheap (values change rarely and only through the operator route).
const policyCache = new Map<string, number>();

function getPolicySync(key: string): number {
  return policyCache.get(key) ?? RETENTION_DEFAULTS[key];
}

export async function loadPolicies(): Promise<void> {
  for (const key of Object.values(RETENTION_KEYS)) {
    const v = await getControl<number>(key, RETENTION_DEFAULTS[key]);
    policyCache.set(key, typeof v === "number" ? v : RETENTION_DEFAULTS[key]);
  }
}

export async function setRetentionDays(key: string, days: number): Promise<number> {
  if (!(key in RETENTION_BOUNDS)) throw new Error(`unknown retention key ${key}`);
  const b = RETENTION_BOUNDS[key];
  const clamped = Math.max(b.min, Math.min(b.max, Math.round(days)));
  await setControl(key, clamped);
  policyCache.set(key, clamped);
  return clamped;
}

export interface PruneResult {
  ticks: number;
  traces: number;
  notifications: number;
  outboxFailed: number;
  policies: RetentionPolicyView[];
  ranAt: string;
  preserved: string[];
}

/**
 * Run the prune. Financial truth is NEVER touched (the preserved list is
 * part of the auditable result). Every run writes a RetentionRun row +
 * a COMPLIANCE outbox event — the ops trail is append-only.
 */
export async function runRetention(kind: "MANUAL" | "SCHEDULED" = "MANUAL"): Promise<PruneResult> {
  await loadPolicies();
  const days = (k: string) => getPolicySync(k);
  const cutoff = (k: string) => new Date(Date.now() - days(k) * 86400 * 1000);

  const ticks = await db.marketPriceTick.deleteMany({ where: { capturedAt: { lt: cutoff(RETENTION_KEYS.TICKS_DAYS) } } });
  const traces = await db.decisionTrace.deleteMany({ where: { createdAt: { lt: cutoff(RETENTION_KEYS.TRACES_DAYS) } } });
  const notifications = await db.notification.deleteMany({ where: { createdAt: { lt: cutoff(RETENTION_KEYS.NOTIFICATIONS_DAYS) } } });
  const outboxFailed = await db.outboxEvent.deleteMany({
    where: { status: "FAILED", createdAt: { lt: cutoff(RETENTION_KEYS.OUTBOX_FAILED_DAYS) } },
  });

  const policies = await getRetentionPolicies();
  const result: PruneResult = {
    ticks: ticks.count,
    traces: traces.count,
    notifications: notifications.count,
    outboxFailed: outboxFailed.count,
    policies,
    ranAt: new Date().toISOString(),
    // Hard invariants: these tables are NEVER pruned by policy.
    preserved: ["LedgerEntry (append-only)", "Orders and their full history", "Fill", "Position", "ReconciliationEntry", "RetentionRun"],
  };

  await db.retentionRun.create({
    data: { kind, policies: JSON.stringify(policies.map((p) => ({ key: p.key, days: p.days }))), pruned: JSON.stringify({ ticks: result.ticks, traces: result.traces, notifications: result.notifications, outboxFailed: result.outboxFailed }) },
  });
  const founder = await db.user.findUnique({ where: { email: "founder@faida.local" }, select: { id: true } });
  await enqueueOutbox(db, [
    {
      aggregateType: "ROBOT",
      aggregateId: "COMPLIANCE",
      eventType: "COMPLIANCE_RETENTION_RUN",
      payload: { kind, ...result, ranAt: result.ranAt },
    },
  ]);
  if (founder) {
    await notifyUser(founder.id, {
      family: "COMPLIANCE",
      title: `Retention run (${kind.toLowerCase()}): ${result.ticks + result.traces + result.notifications + result.outboxFailed} rows pruned`,
      body: `ticks ${result.ticks} · traces ${result.traces} · notifications ${result.notifications} · failed outbox ${result.outboxFailed}. Financial truth never pruned: ${result.preserved.join(", ")}.`,
      dedupeKey: `retention-run:${result.ranAt}`,
    });
  }
  return result;
}
