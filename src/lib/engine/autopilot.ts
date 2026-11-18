// Autopilot (P3.2 / B8) — interval-driven robot cycles without manual clicks.
// The TIMER is process-local (self-host single process); the STATE is
// persisted in PlatformControl, so the UI reflects truth and a restarted
// server self-heals the timer on the next API touch (ensureAutopilotTimer).
// Humans own start/stop; the global pause (C19) overrides everything.
import { runAllCycles } from "./cycle";
import { reconcilePendingOrders } from "./reconcile";
import { drainOutbox } from "@/lib/outbox";
import {
  getAutopilotState,
  getPauseState,
  setAutopilotState,
  type AutopilotLastRun,
} from "@/lib/control";

const MIN_INTERVAL_SEC = 30;
const MAX_INTERVAL_SEC = 900;

type Timer = ReturnType<typeof setTimeout>;

// survive dev-server HMR reloads
const g = globalThis as unknown as { __faidaAutopilotTimer?: Timer; __faidaAutopilotBusy?: boolean };

export function clampIntervalSec(sec: number): number {
  return Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, Math.round(sec)));
}

export async function startAutopilot(intervalSec = 60): Promise<void> {
  const interval = clampIntervalSec(intervalSec);
  await setAutopilotState({ enabled: true, intervalSec: interval, startedAt: new Date().toISOString() });
  scheduleTimer(interval);
}

export async function stopAutopilot(): Promise<void> {
  if (g.__faidaAutopilotTimer) {
    clearTimeout(g.__faidaAutopilotTimer);
    g.__faidaAutopilotTimer = undefined;
  }
  await setAutopilotState({ enabled: false });
}

/** Self-heal: if the persisted state says enabled but this process has no timer, rebuild it. */
export async function ensureAutopilotTimer(): Promise<void> {
  if (g.__faidaAutopilotTimer) return;
  const state = await getAutopilotState();
  if (state.enabled) scheduleTimer(state.intervalSec);
}

function scheduleTimer(intervalSec: number): void {
  if (g.__faidaAutopilotTimer) clearTimeout(g.__faidaAutopilotTimer);
  g.__faidaAutopilotTimer = setTimeout(() => void tick(), intervalSec * 1000);
}

// One autopilot pass: every eligible robot cycles, unresolved orders are
// reconciled and the outbox drains. Shared by the in-process timer (long-running
// server) and the scheduled tick (serverless, see lib/engine/scheduler.ts).
export async function runAutopilotOnce(): Promise<AutopilotLastRun> {
    const pause = await getPauseState();
    let lastRun: AutopilotLastRun;
    if (pause.paused) {
      // C19: while paused the platform does not even churn — record the skip
      lastRun = { at: new Date().toISOString(), cycles: 0, trades: 0, noTrades: 0, errors: 0, skipped: "PLATFORM_PAUSED" };
    } else {
      const summaries = await runAllCycles();
      const reconcile = await reconcilePendingOrders().catch(() => []);
      await drainOutbox(25).catch(() => undefined);
      lastRun = {
        at: new Date().toISOString(),
        cycles: summaries.length,
        trades: summaries.filter((s) => s.decision === "TRADE").length,
        noTrades: summaries.filter((s) => s.decision === "NO_TRADE").length,
        errors: summaries.filter((s) => s.reason.startsWith("cycle error")).length,
        reconciled: reconcile.length,
      };
    }
  return lastRun;
}

async function tick(): Promise<void> {
  g.__faidaAutopilotTimer = undefined;
  if (g.__faidaAutopilotBusy) {
    // previous run still in flight — re-arm without stacking cycles
    const state = await getAutopilotState();
    if (state.enabled) scheduleTimer(state.intervalSec);
    return;
  }
  g.__faidaAutopilotBusy = true;
  try {
    const state = await getAutopilotState();
    if (!state.enabled) return; // stopped while we slept

    const lastRun = await runAutopilotOnce();
    await setAutopilotState({ lastRun });
  } catch {
    // a failed tick must never kill the loop; next interval retries
  } finally {
    g.__faidaAutopilotBusy = false;
    const state = await getAutopilotState();
    if (state.enabled) scheduleTimer(state.intervalSec);
  }
}
