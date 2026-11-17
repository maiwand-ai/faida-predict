// A-07 — AI cost/latency governance read view.
// Aggregates AiCallLog (per-provider spend proxy, latency percentiles, cache
// hit rate, budget-blocked calls) plus the AiProvider budget rows so the
// Settings card and the B10 evidence can state cost/latency facts, never
// folklore. Spend bookkeeping stays on AiProvider.spentCents (integer cents).
import { db } from "@/lib/db";

export interface ProviderGovernance {
  name: string;
  enabled: boolean;
  spentCents: number;
  monthlyBudgetCents: number;
  budgetUsedPct: number;
  calls24h: number;
  blocked24h: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface GovernanceView {
  providers: ProviderGovernance[];
  cache: { entries: number; hits24h: number; misses24h: number; hitRatePct: number };
  totals24h: { calls: number; blocked: number; failed: number };
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

export async function governanceView(): Promise<GovernanceView> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [providers, recent, cacheEntries, hits24h, misses24h] = await Promise.all([
    db.aiProvider.findMany({ orderBy: { priority: "asc" } }),
    db.aiCallLog.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "asc" } }),
    db.aiCacheEntry.count(),
    db.aiCallLog.count({ where: { createdAt: { gte: since }, cache: "HIT" } }),
    db.aiCallLog.count({ where: { createdAt: { gte: since }, cache: "MISS" } }),
  ]);

  const provViews: ProviderGovernance[] = providers.map((p) => {
    const rows = recent.filter((r) => r.providerName === p.name);
    const okLat = rows.filter((r) => r.outcome === "OK" && r.cache !== "HIT").map((r) => r.latencyMs).sort((a, b) => a - b);
    return {
      name: p.name,
      enabled: p.enabled,
      spentCents: p.spentCents,
      monthlyBudgetCents: p.monthlyBudgetCents,
      budgetUsedPct: p.monthlyBudgetCents > 0 ? Math.min(100, Math.round((p.spentCents / p.monthlyBudgetCents) * 100)) : 100,
      calls24h: rows.length,
      blocked24h: rows.filter((r) => r.outcome === "BUDGET_BLOCKED").length,
      p50Ms: percentile(okLat, 50),
      p95Ms: percentile(okLat, 95),
    };
  });

  const cacheCalls = hits24h + misses24h;
  return {
    providers: provViews,
    cache: {
      entries: cacheEntries,
      hits24h,
      misses24h,
      hitRatePct: cacheCalls > 0 ? Math.round((hits24h / cacheCalls) * 100) : 0,
    },
    totals24h: {
      calls: recent.length,
      blocked: recent.filter((r) => r.outcome === "BUDGET_BLOCKED").length,
      failed: recent.filter((r) => r.outcome === "FAILED").length,
    },
  };
}
