// Track record + AI accuracy — the evidence page. Everything is computed from
// recorded facts only:
//   • robot record: the robot's own orders → their ledger rows (refId =
//     order id). Realized P&L = SETTLEMENT + FEE rows; a closed bet is a
//     SETTLEMENT row, a win when it is positive. Open positions are reported
//     separately (not realized).
//   • AI accuracy: for every model, its LAST estimate on each market made
//     before that market resolved, scored against the real outcome with the
//     Brier score (mean squared error of a probability; 0 = perfect, 0.25 =
//     coin flip). The market's own price at that same moment is scored the
//     same way, so "does the AI beat the crowd?" is answered head to head.
// No smoothing, no projections: too few resolved markets = say so.
import { db } from "@/lib/db";

export const MIN_RESOLVED_FOR_VERDICT = 30;

export interface RobotRecord {
  robotId: string;
  name: string;
  venue: string;
  family: string;
  status: string;
  since: string;
  days: number;
  allocatedCents: number;
  decisions: number;
  trades: number;
  closedBets: number;
  wins: number;
  winRatePct: number | null;
  realizedCents: number;
  returnPct: number | null;
  maxDrawdownPct: number;
  curve: Array<{ t: string; cents: number }>;
  lastDecisionAt: string | null;
  backtest: { roiPct: number | null; winRatePct: number | null; trades: number | null; at: string } | null;
}

export interface ModelAccuracy {
  modelKey: string;
  label: string;
  resolved: number;
  brierModel: number | null;
  brierMarket: number | null;
  verdict: "AHEAD" | "BEHIND" | "EVEN" | "TOO_EARLY";
  bins: Array<{ from: number; to: number; n: number; avgForecastPct: number; hitRatePct: number }>;
  pending: number;
  nextResolution: string | null;
}

function modelLabel(key: string): string {
  if (key.startsWith("ai:")) return `AI · ${key.slice(3)}`;
  if (key.startsWith("heuristic")) return "Built-in estimator";
  return key;
}

export async function robotRecords(userId: string): Promise<RobotRecord[]> {
  const robots = await db.robot.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (robots.length === 0) return [];
  const ids = robots.map((r) => r.id);
  const [orders, traceCounts, lastTraces, backtests] = await Promise.all([
    db.order.findMany({ where: { robotId: { in: ids }, state: "FILLED" }, select: { id: true, robotId: true, side: true } }),
    db.decisionTrace.groupBy({ by: ["robotId"], where: { robotId: { in: ids } }, _count: { _all: true } }),
    db.decisionTrace.groupBy({ by: ["robotId"], where: { robotId: { in: ids } }, _max: { createdAt: true } }),
    db.backtestRun.findMany({ where: { robotId: { in: ids }, status: "DONE" }, orderBy: { createdAt: "desc" }, select: { robotId: true, stats: true, createdAt: true } }),
  ]);
  const orderRobot = new Map(orders.map((o) => [o.id, o.robotId!]));
  const ledger = orders.length
    ? await db.ledgerEntry.findMany({
        where: { refId: { in: orders.map((o) => o.id) }, type: { in: ["SETTLEMENT", "FEE"] } },
        orderBy: { createdAt: "asc" },
        select: { refId: true, type: true, amountCents: true, createdAt: true },
      })
    : [];
  const now = Date.now();

  return robots.map((r) => {
    const rows = ledger.filter((l) => l.refId && orderRobot.get(l.refId) === r.id);
    let cum = 0;
    let peak = 0;
    let maxDd = 0;
    const curve: RobotRecord["curve"] = [];
    for (const l of rows) {
      cum += l.amountCents;
      curve.push({ t: l.createdAt.toISOString(), cents: cum });
      peak = Math.max(peak, cum);
      if (r.allocatedCents > 0) maxDd = Math.max(maxDd, ((peak - cum) / r.allocatedCents) * 100);
    }
    const settlements = rows.filter((l) => l.type === "SETTLEMENT");
    const wins = settlements.filter((l) => l.amountCents > 0).length;
    const bt = backtests.find((b) => b.robotId === r.id);
    let btStats: RobotRecord["backtest"] = null;
    if (bt) {
      try {
        const s = JSON.parse(bt.stats) as { roiPct?: number; winRatePct?: number; trades?: number };
        btStats = { roiPct: s.roiPct ?? null, winRatePct: s.winRatePct ?? null, trades: s.trades ?? null, at: bt.createdAt.toISOString() };
      } catch { /* malformed stats → no backtest summary */ }
    }
    return {
      robotId: r.id,
      name: r.name,
      venue: r.venue,
      family: r.family,
      status: r.status,
      since: r.createdAt.toISOString(),
      days: Math.max(0, Math.floor((now - r.createdAt.getTime()) / 86_400_000)),
      allocatedCents: r.allocatedCents,
      decisions: traceCounts.find((t) => t.robotId === r.id)?._count._all ?? 0,
      trades: orders.filter((o) => o.robotId === r.id && o.side.startsWith("BUY")).length,
      closedBets: settlements.length,
      wins,
      winRatePct: settlements.length ? (wins / settlements.length) * 100 : null,
      realizedCents: cum,
      returnPct: r.allocatedCents > 0 ? (cum / r.allocatedCents) * 100 : null,
      maxDrawdownPct: maxDd,
      curve,
      lastDecisionAt: lastTraces.find((t) => t.robotId === r.id)?._max.createdAt?.toISOString() ?? null,
      backtest: btStats,
    };
  });
}

const brier = (pairs: Array<[number, number]>) => (pairs.length ? pairs.reduce((a, [p, o]) => a + (p - o) ** 2, 0) / pairs.length : null);

export async function modelAccuracy(): Promise<ModelAccuracy[]> {
  const traces = await db.decisionTrace.findMany({
    where: { modelEstimatePct: { not: null }, modelKey: { not: null } },
    select: {
      modelKey: true, marketId: true, modelEstimatePct: true, marketPriceCents: true, createdAt: true,
      market: { select: { resolvedAt: true, resolutionOutcome: true, closeDate: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const byModel = new Map<string, typeof traces>();
  for (const t of traces) {
    const k = t.modelKey!;
    byModel.set(k, [...(byModel.get(k) ?? []), t]);
  }
  const out: ModelAccuracy[] = [];
  for (const [key, rows] of byModel) {
    // last estimate per market made BEFORE it resolved (later ones would peek)
    const lastPerMarket = new Map<string, (typeof rows)[number]>();
    const pendingMarkets = new Set<string>();
    let nextRes: number | null = null;
    for (const t of rows) {
      const m = t.market;
      const resolved = m.resolvedAt && (m.resolutionOutcome === "YES" || m.resolutionOutcome === "NO");
      if (resolved) {
        if (t.createdAt <= m.resolvedAt!) lastPerMarket.set(t.marketId, t);
      } else {
        pendingMarkets.add(t.marketId);
        const cd = m.closeDate?.getTime();
        if (cd && cd > Date.now()) nextRes = nextRes == null ? cd : Math.min(nextRes, cd);
      }
    }
    const scored = [...lastPerMarket.values()].map((t) => ({
      p: (t.modelEstimatePct ?? 50) / 100,
      m: Math.min(0.99, Math.max(0.01, (t.marketPriceCents ?? 50) / 100)),
      o: t.market.resolutionOutcome === "YES" ? 1 : 0,
    }));
    const bModel = brier(scored.map((s) => [s.p, s.o]));
    const bMarket = brier(scored.map((s) => [s.m, s.o]));
    const bins = Array.from({ length: 10 }, (_, i) => {
      const inBin = scored.filter((s) => (i === 9 ? s.p >= 0.9 : s.p >= i / 10 && s.p < (i + 1) / 10));
      return {
        from: i * 10,
        to: (i + 1) * 10,
        n: inBin.length,
        avgForecastPct: inBin.length ? (inBin.reduce((a, s) => a + s.p, 0) / inBin.length) * 100 : 0,
        hitRatePct: inBin.length ? (inBin.filter((s) => s.o === 1).length / inBin.length) * 100 : 0,
      };
    });
    let verdict: ModelAccuracy["verdict"] = "TOO_EARLY";
    if (scored.length >= MIN_RESOLVED_FOR_VERDICT && bModel != null && bMarket != null) {
      verdict = Math.abs(bModel - bMarket) < 0.002 ? "EVEN" : bModel < bMarket ? "AHEAD" : "BEHIND";
    }
    out.push({
      modelKey: key,
      label: modelLabel(key),
      resolved: scored.length,
      brierModel: bModel,
      brierMarket: bMarket,
      verdict,
      bins,
      pending: pendingMarkets.size,
      nextResolution: nextRes ? new Date(nextRes).toISOString() : null,
    });
  }
  return out.sort((a, b) => b.resolved - a.resolved || b.pending - a.pending);
}
