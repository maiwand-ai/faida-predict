// Scheduled tick for serverless hosting (Vercel). A long-running server keeps
// the autopilot alive with an in-process timer; serverless functions don't
// stay alive between requests, so the same work runs here instead, triggered
// by /api/cron/tick (external scheduler) and by dashboard polls while the app
// is open. One tick:
//   1. refreshes market data for every live venue if the last refresh is
//      older than SYNC_EVERY_MS (keeps prices inside the staleness gate and
//      builds the price history backtests need);
//   2. runs one autopilot pass if autopilot is ON, the platform is not paused
//      and the configured interval has elapsed since the last run.
// A database lease makes overlapping triggers safe: only one tick runs at a
// time, and nothing runs more often than the user's own settings allow.
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { LIVE_VENUE_IDS } from "@/lib/venues";
import { getAutopilotState, getControl, getPauseState, setAutopilotState, setControl } from "@/lib/control";
import { syncVenueMarkets, type SyncResult } from "@/lib/sync";
import { runAutopilotOnce } from "./autopilot";

const LEASE_KEY = "SCHEDULER_LEASE";
const LAST_SYNC_KEY = "LAST_MARKET_SYNC";
const LEASE_TTL_MS = 4 * 60_000;
export const SYNC_EVERY_MS = 10 * 60_000;

async function claimLease(): Promise<string | null> {
  const now = Date.now();
  const token = randomUUID();
  const next = JSON.stringify({ token, until: now + LEASE_TTL_MS });
  const row = await db.platformControl.findUnique({ where: { key: LEASE_KEY } });
  if (!row) {
    try {
      await db.platformControl.create({ data: { key: LEASE_KEY, value: next } });
      return token;
    } catch {
      return null; // another trigger created it first
    }
  }
  let until = 0;
  try { until = (JSON.parse(row.value) as { until?: number }).until ?? 0; } catch { /* corrupt row: treat as expired */ }
  if (until > now) return null;
  // compare-and-set on the exact previous value: only one claimant wins
  const res = await db.platformControl.updateMany({ where: { key: LEASE_KEY, value: row.value }, data: { value: next } });
  return res.count === 1 ? token : null;
}

async function releaseLease(token: string): Promise<void> {
  await db.platformControl
    .updateMany({ where: { key: LEASE_KEY, value: { contains: token } }, data: { value: JSON.stringify({ token: null, until: 0 }) } })
    .catch(() => undefined);
}

export type TickReport = {
  ranAt: string;
  skipped?: "BUSY";
  sync: { ran: boolean; results?: SyncResult[]; lastSyncAt: string | null };
  autopilot: { enabled: boolean; ran: boolean; reason: string; lastRun?: unknown };
};

export async function runScheduledTick(opts: { forceSync?: boolean } = {}): Promise<TickReport> {
  const ranAt = new Date().toISOString();
  const token = await claimLease();
  if (!token) {
    return { ranAt, skipped: "BUSY", sync: { ran: false, lastSyncAt: null }, autopilot: { enabled: false, ran: false, reason: "another tick is running" } };
  }
  try {
    // 1. market data refresh
    const last = await getControl<{ at: string } | null>(LAST_SYNC_KEY, null);
    const syncDue = opts.forceSync || !last || Date.now() - new Date(last.at).getTime() >= SYNC_EVERY_MS;
    let results: SyncResult[] | undefined;
    let lastSyncAt = last?.at ?? null;
    if (syncDue) {
      results = [];
      for (const venue of LIVE_VENUE_IDS) {
        results.push(await syncVenueMarkets(venue).catch((e) => ({ venue, synced: 0, totalMarkets: 0, errors: String(e), source: "UNAVAILABLE" })));
      }
      lastSyncAt = new Date().toISOString();
      await setControl(LAST_SYNC_KEY, { at: lastSyncAt, results: results.map((r) => ({ venue: r.venue, synced: r.synced, errors: r.errors })) });
    }

    // 2. autopilot pass when due
    const state = await getAutopilotState();
    if (!state.enabled) {
      return { ranAt, sync: { ran: syncDue, results, lastSyncAt }, autopilot: { enabled: false, ran: false, reason: "autopilot is off" } };
    }
    const pause = await getPauseState();
    if (pause.paused) {
      return { ranAt, sync: { ran: syncDue, results, lastSyncAt }, autopilot: { enabled: true, ran: false, reason: "platform paused" } };
    }
    const lastAt = state.lastRun?.at ? new Date(state.lastRun.at).getTime() : 0;
    const due = Date.now() - lastAt >= state.intervalSec * 1000 - 2000;
    if (!due) {
      return { ranAt, sync: { ran: syncDue, results, lastSyncAt }, autopilot: { enabled: true, ran: false, reason: "not due yet" } };
    }
    const lastRun = await runAutopilotOnce();
    await setAutopilotState({ lastRun });
    return { ranAt, sync: { ran: syncDue, results, lastSyncAt }, autopilot: { enabled: true, ran: true, reason: "ran", lastRun } };
  } finally {
    await releaseLease(token);
  }
}
