// Platform control plane (C19/S-07, S-06, S-10) — Phase 3.
// A tiny KV store (PlatformControl) backs three things:
//   GLOBAL_PAUSE          — kill switch: every cycle and every order path
//                           checks it first; propagation is MEASURED, not
//                           asserted (the time from pausedAt to the first
//                           refused tick is recorded in traces).
//   AUTOPILOT             — persisted autopilot state (enabled, interval,
//                           last run summary) so the UI reflects truth even
//                           after a process restart.
//   STALENESS_THRESHOLD_MS — pre-trade freshness gate (S-10). Default 15 min
//                           for sync-fed paper; the B5 5-second book budget
//                           applies once the live book adapter lands (P7).
// Plus RobotLease: per-robot loop leases so a retried tick or a second worker
// can never double-run the same robot (S-06).
import { db } from "@/lib/db";
import { enqueueOutbox } from "@/lib/outbox";

export const CONTROL_KEYS = {
  GLOBAL_PAUSE: "GLOBAL_PAUSE",
  AUTOPILOT: "AUTOPILOT",
  STALENESS_MS: "STALENESS_THRESHOLD_MS",
} as const;

export const DEFAULT_STALENESS_MS = 15 * 60_000;
export const MIN_STALENESS_MS = 5_000;
export const MAX_STALENESS_MS = 24 * 60 * 60_000;

export const LEASE_TTL_MS = 120_000;

export interface GlobalPauseState {
  paused: boolean;
  reason: string | null;
  pausedAt: string | null;
  pausedBy: string | null;
}

export interface AutopilotLastRun {
  at: string;
  cycles: number;
  trades: number;
  noTrades: number;
  errors: number;
  reconciled?: number;
  skipped?: string;
}

export interface AutopilotState {
  enabled: boolean;
  intervalSec: number;
  startedAt: string | null;
  lastRun: AutopilotLastRun | null;
}

export const DEFAULT_PAUSE: GlobalPauseState = { paused: false, reason: null, pausedAt: null, pausedBy: null };
export const DEFAULT_AUTOPILOT: AutopilotState = { enabled: false, intervalSec: 60, startedAt: null, lastRun: null };

export async function getControl<T>(key: string, fallback: T): Promise<T> {
  const row = await db.platformControl.findUnique({ where: { key } });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function setControl(key: string, value: unknown): Promise<void> {
  await db.platformControl.upsert({
    where: { key },
    create: { key, value: JSON.stringify(value) },
    update: { value: JSON.stringify(value) },
  });
}

// ── Global pause (C19/S-07) ────────────────────────────────────────────────

export function getPauseState(): Promise<GlobalPauseState> {
  return getControl<GlobalPauseState>(CONTROL_KEYS.GLOBAL_PAUSE, DEFAULT_PAUSE);
}

export async function pausePlatform(reason: string, actor = "founder"): Promise<GlobalPauseState> {
  const state: GlobalPauseState = {
    paused: true,
    reason: reason || "manual pause",
    pausedAt: new Date().toISOString(),
    pausedBy: actor,
  };
  await setControl(CONTROL_KEYS.GLOBAL_PAUSE, state);
  const userId = await founderUserId();
  if (userId) {
    await db.notification.create({
      data: {
        userId,
        severity: "CRITICAL",
        family: "SYSTEM",
        title: "Platform paused — kill switch engaged",
        body: `All robot cycles and new orders are refused until resume. Reason: ${state.reason}`,
      },
    });
    await enqueueOutbox(db, [
      {
        aggregateType: "ROBOT",
        aggregateId: "PLATFORM",
        eventType: "PLATFORM_PAUSED",
        payload: { reason: state.reason, pausedAt: state.pausedAt, by: actor },
      },
    ]);
  }
  return state;
}

export async function resumePlatform(actor = "founder"): Promise<GlobalPauseState> {
  const prev = await getPauseState();
  const state: GlobalPauseState = { paused: false, reason: null, pausedAt: null, pausedBy: null };
  await setControl(CONTROL_KEYS.GLOBAL_PAUSE, state);
  if (prev.paused) {
    const userId = await founderUserId();
    if (userId) {
      await db.notification.create({
        data: {
          userId,
          severity: "INFO",
          family: "SYSTEM",
          title: "Platform resumed",
          body: "Robot cycles and order placement are active again.",
        },
      });
    }
  }
  return state;
}

// ── Staleness threshold (S-10) ─────────────────────────────────────────────

export async function getStalenessThresholdMs(): Promise<number> {
  const v = await getControl<number>(CONTROL_KEYS.STALENESS_MS, DEFAULT_STALENESS_MS);
  return Math.min(MAX_STALENESS_MS, Math.max(MIN_STALENESS_MS, Math.round(v)));
}

export async function setStalenessThresholdMs(ms: number): Promise<number> {
  const clamped = Math.min(MAX_STALENESS_MS, Math.max(MIN_STALENESS_MS, Math.round(ms)));
  await setControl(CONTROL_KEYS.STALENESS_MS, clamped);
  return clamped;
}

// ── Autopilot state (persisted; the timer itself is process-local) ─────────

export function getAutopilotState(): Promise<AutopilotState> {
  return getControl<AutopilotState>(CONTROL_KEYS.AUTOPILOT, DEFAULT_AUTOPILOT);
}

export async function setAutopilotState(patch: Partial<AutopilotState>): Promise<AutopilotState> {
  const next = { ...(await getAutopilotState()), ...patch };
  await setControl(CONTROL_KEYS.AUTOPILOT, next);
  return next;
}

// ── Per-robot loop leases (S-06) ───────────────────────────────────────────

export interface LeaseAcquireResult {
  ok: boolean;
  holder?: string;
  expiresAt?: Date;
}

/**
 * Acquire the single cycle slot for one robot. A live lease held by ANOTHER
 * holder refuses; expiry allows takeover so a crashed runner never wedges the
 * robot. Same-holder re-entry is refused too (each cycle invocation carries a
 * unique holder), which is exactly the duplicate-tick protection S-06 wants.
 */
export async function acquireRobotLease(robotId: string, holder: string, ttlMs = LEASE_TTL_MS): Promise<LeaseAcquireResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  try {
    // Atomic claim (S-06 hardening, Phase 7.5 chaos X5): INSERT wins or loses
    // the robotId unique constraint in one statement — the check-then-upsert
    // this replaces had a race window under concurrent schedulers where two
    // runners could both observe "no live lease" and both evaluate.
    await db.robotLease.create({ data: { robotId, holder, expiresAt } });
    return { ok: true, holder, expiresAt };
  } catch {
    // A lease row already exists. Takeover is a single conditional UPDATE:
    // only an EXPIRED lease flips, and SQLite serializes the two statements,
    // so the second contender's WHERE no longer matches and it refuses.
    const takeover = await db.robotLease.updateMany({
      where: { robotId, expiresAt: { lte: now } },
      data: { holder, expiresAt, acquiredAt: now },
    });
    if (takeover.count === 1) {
      return { ok: true, holder, expiresAt };
    }
    const existing = await db.robotLease.findUnique({ where: { robotId } });
    return { ok: false, holder: existing?.holder, expiresAt: existing?.expiresAt };
  }
}

export async function releaseRobotLease(robotId: string, holder: string): Promise<void> {
  await db.robotLease.deleteMany({ where: { robotId, holder } });
}

// ── shared founder lookup (single-tenant seed) ─────────────────────────────

async function founderUserId(): Promise<string | null> {
  const user = await db.user.findUnique({ where: { email: "founder@faida.local" }, select: { id: true } });
  return user?.id ?? null;
}
