// P-08 — Platform metrics snapshot (Phase 8).
// One honest read-only picture of the platform: robots, orders, ledger,
// sync freshness per venue, notification anti-storm accounting, outbox
// backlog + dispatch lag, AI governance counters, key usage. No secrets,
// no estimates of things the DB does not record — null when unknown.
import { db } from "@/lib/db";
import { VENUES } from "@/lib/venues";

export interface MetricsSnapshot {
  generatedAt: string;
  robots: { total: number; byStatus: Record<string, number>; byVenue: Record<string, number>; livePilot: number };
  orders24h: { total: number; byState: Record<string, number>; fills: number; feesCents: number };
  ledger: { entries: number; paperBalanceCents: number };
  markets: { total: number; ambiguous: number; freshness: Array<{ venue: string; label: string; adapter: string; markets: number; lastSyncMinAgo: number | null }> };
  notifications24h: { delivered: number; suppressed: number; byFamily: Record<string, number> };
  outbox: { pending: number; failed24h: number; dispatched24h: number; dispatchLagP50Ms: number | null; dispatchLagP95Ms: number | null };
  ai: { calls24h: number; failed24h: number; blocked24h: number; cacheEntries: number };
  apiKeys: { active: number; revoked: number; usedLast24h: number };
  decisions: { traces24h: number; trades24h: number; noTrades24h: number };
  compliance: { retentionRuns: number; lastRetentionRanAt: string | null };
}

function pctl(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export async function buildMetrics(): Promise<MetricsSnapshot> {
  const dayAgo = new Date(Date.now() - 86400 * 1000);

  const [robots, orders24h, fills24h, lastLedger, markets, notif24h, outboxPending, outboxDispatched, outboxFailed, aiCalls24h, cacheEntries, keys, traces24h, retentionRuns, lastRun] =
    await Promise.all([
      db.robot.findMany({ select: { status: true, venue: true, mode: true } }),
      db.order.findMany({ where: { createdAt: { gte: dayAgo } }, select: { state: true } }),
      db.fill.findMany({ where: { createdAt: { gte: dayAgo } }, select: { feeCents: true } }),
      db.ledgerEntry.findMany({ where: { mode: "PAPER" }, orderBy: { createdAt: "desc" }, take: 1, select: { balanceAfterCents: true } }),
      db.market.findMany({ where: { resolvedAt: null }, select: { venue: true, ambiguityFlag: true, updatedAt: true } }),
      db.notification.findMany({ where: { createdAt: { gte: dayAgo } }, select: { family: true, suppressed: true } }),
      db.outboxEvent.count({ where: { status: "PENDING" } }),
      db.outboxEvent.findMany({
        where: { status: "DISPATCHED", dispatchedAt: { gte: dayAgo } },
        select: { createdAt: true, dispatchedAt: true },
        take: 500,
      }),
      db.outboxEvent.count({ where: { status: "FAILED", createdAt: { gte: dayAgo } } }),
      db.aiCallLog.count({ where: { createdAt: { gte: dayAgo } } }),
      db.aiCacheEntry.count(),
      db.apiKey.findMany({ select: { revokedAt: true, lastUsedAt: true } }),
      db.decisionTrace.findMany({ where: { createdAt: { gte: dayAgo } }, select: { decision: true } }),
      db.retentionRun.count(),
      db.retentionRun.findFirst({ orderBy: { ranAt: "desc" }, select: { ranAt: true } }),
    ]);

  const byStatus: Record<string, number> = {};
  const byVenue: Record<string, number> = {};
  for (const r of robots) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byVenue[r.venue] = (byVenue[r.venue] ?? 0) + 1;
  }
  const byState: Record<string, number> = {};
  for (const o of orders24h) byState[o.state] = (byState[o.state] ?? 0) + 1;

  const byFamily: Record<string, number> = {};
  let suppressed = 0;
  for (const n of notif24h) {
    byFamily[n.family] = (byFamily[n.family] ?? 0) + 1;
    if (n.suppressed) suppressed++;
  }

  const now = Date.now();
  const freshness = VENUES.map((v) => {
    const venueMarkets = markets.filter((m) => m.venue === v.id);
    const newest = venueMarkets.reduce<number | null>((acc, m) => {
      const t = m.updatedAt.getTime();
      return acc == null || t > acc ? t : acc;
    }, null);
    return {
      venue: v.id,
      label: v.label,
      adapter: v.adapter,
      markets: venueMarkets.length,
      lastSyncMinAgo: newest != null ? Math.round((now - newest) / 60000) : null,
    };
  });

  const lags = outboxDispatched
    .filter((e) => e.dispatchedAt)
    .map((e) => e.dispatchedAt!.getTime() - e.createdAt.getTime())
    .filter((ms) => ms >= 0);

  return {
    generatedAt: new Date().toISOString(),
    robots: {
      total: robots.length,
      byStatus,
      byVenue,
      livePilot: robots.filter((r) => r.mode === "LIVE_PILOT").length,
    },
    orders24h: {
      total: orders24h.length,
      byState,
      fills: fills24h.length,
      feesCents: fills24h.reduce((a, f) => a + f.feeCents, 0),
    },
    ledger: { entries: await db.ledgerEntry.count(), paperBalanceCents: lastLedger[0]?.balanceAfterCents ?? 0 },
    markets: {
      total: markets.length,
      ambiguous: markets.filter((m) => m.ambiguityFlag).length,
      freshness,
    },
    notifications24h: { delivered: notif24h.length - suppressed, suppressed, byFamily },
    outbox: {
      pending: outboxPending,
      failed24h: outboxFailed,
      dispatched24h: outboxDispatched.length,
      dispatchLagP50Ms: pctl(lags, 50),
      dispatchLagP95Ms: pctl(lags, 95),
    },
    ai: {
      calls24h: aiCalls24h,
      failed24h: await db.aiCallLog.count({ where: { createdAt: { gte: dayAgo }, outcome: "FAILED" } }),
      blocked24h: await db.aiCallLog.count({ where: { createdAt: { gte: dayAgo }, outcome: "BUDGET_BLOCKED" } }),
      cacheEntries,
    },
    apiKeys: {
      active: keys.filter((k) => !k.revokedAt).length,
      revoked: keys.filter((k) => k.revokedAt).length,
      usedLast24h: keys.filter((k) => k.lastUsedAt && k.lastUsedAt.getTime() >= dayAgo.getTime()).length,
    },
    decisions: {
      traces24h: traces24h.length,
      trades24h: traces24h.filter((t) => t.decision === "TRADE").length,
      noTrades24h: traces24h.filter((t) => t.decision === "NO_TRADE").length,
    },
    compliance: { retentionRuns, lastRetentionRanAt: lastRun?.ranAt.toISOString() ?? null },
  };
}
