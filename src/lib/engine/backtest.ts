// A-05 — Backtest engine. Deterministic replay of one strategy version over
// recorded MarketPriceTicks with the conservative fill model:
//   - entry/exit fills pay adverse slippage (cents) against the quoted price
//   - fee schedule applied per side (bps of notional)
//   - liquidity guard: orders larger than 5% of recorded liquidity are skipped
// The estimator is the same family the live cycle uses (config-driven
// contrarian tilt), so a backtest exercises the strategy that will actually run.
// Output is evidence for the B10 live gate — never a promise (D-03).
import { db } from "@/lib/db";
import { parseConfig, type StrategyConfig } from "@/lib/strategy";

export interface BacktestParams {
  slippageCents: number; // adverse fill assumption per side
  feeBps: number; // bps of notional per side
  perTradeCents: number; // fixed notional per position
  minEdgePts: number; // overrides strategy config when provided
  holdTicksMax: number; // overrides strategy config when provided
  simCapitalCents: number; // denominator for ROI
}

export interface BacktestTrade {
  side: "YES" | "NO";
  entryIdx: number;
  exitIdx: number;
  entryCents: number; // fill price (with slippage)
  exitCents: number; // fill price (with slippage)
  edgeAtEntry: number;
  holdTicks: number;
  feeCents: number;
  pnlCents: number; // net of fees
}

export interface BacktestStats {
  trades: number;
  wins: number;
  winRatePct: number;
  pnlCents: number;
  feesCents: number;
  roiPct: number;
  maxDrawdownPct: number;
  avgEdgeAtEntry: number;
  avgHoldTicks: number;
  skippedForLiquidity: number;
  openAtEnd: boolean;
}

const LIQUIDITY_SHARE_MAX = 0.05; // A-05: never assume more than 5% of book depth

// Deterministic estimator — identical family to engine/cycle.ts but with the
// tilt taken from the strategy config so versions differ meaningfully.
function estimateYes(yesCents: number, cfg: StrategyConfig): number {
  const tilt = Math.round((50 - yesCents) * (cfg.estimatorTiltPct / 100));
  return Math.max(2, Math.min(98, yesCents + tilt));
}

export async function runBacktest(robotId: string, marketId: string, versionId: string, rawParams: Partial<BacktestParams>) {
  const robot = await db.robot.findUnique({ where: { id: robotId } });
  if (!robot) throw new Error("robot not found");
  const sv = await db.strategyVersion.findUnique({ where: { id: versionId } });
  if (!sv || sv.robotId !== robotId) throw new Error("version does not belong to this robot");
  const market = await db.market.findUnique({ where: { id: marketId } });
  if (!market) throw new Error("market not found");

  const cfg = parseConfig(sv.config);
  const params: BacktestParams = {
    slippageCents: Math.max(0, Math.min(5, Math.round(rawParams.slippageCents ?? 1))),
    feeBps: Math.max(0, Math.min(300, Math.round(rawParams.feeBps ?? 100))),
    perTradeCents: Math.max(100, Math.min(robot.maxPositionCents || 10000, Math.round(rawParams.perTradeCents ?? (Math.min(robot.maxPositionCents, 5000) || 5000)))),
    minEdgePts: Math.max(1, Math.min(25, Math.round(rawParams.minEdgePts ?? cfg.minEdgePts))),
    holdTicksMax: Math.max(3, Math.min(60, Math.round(rawParams.holdTicksMax ?? cfg.holdTicksMax))),
    simCapitalCents: Math.max(1000, Math.round(rawParams.simCapitalCents ?? robot.allocatedCents)),
  };

  const ticks = await db.marketPriceTick.findMany({
    where: { marketId },
    orderBy: { capturedAt: "asc" },
  });
  if (ticks.length < 20) {
    throw new Error(`insufficient tick history — ${ticks.length} ticks recorded, backtest needs at least 20 (sync markets or seed history first)`);
  }

  const feeRate = params.feeBps / 10000;
  const trades: BacktestTrade[] = [];
  const equity: Array<{ i: number; t: string; equityCents: number }> = [];
  let cash = params.simCapitalCents;
  let peak = cash;
  let maxDd = 0;
  let skipped = 0;
  let open: { side: "YES" | "NO"; entryCents: number; entryIdx: number; edgeAtEntry: number } | null = null;
  let holdCount = 0;

  const recordEquity = (i: number, tickIdx: number, markCents: number | null) => {
    let mtm = 0;
    if (open && markCents != null) {
      const shares = params.perTradeCents / open.entryCents;
      const mark = open.side === "YES" ? markCents : 100 - markCents;
      mtm = Math.round((mark - open.entryCents) * shares);
    }
    const total = cash + mtm;
    equity.push({ i, t: ticks[tickIdx].capturedAt.toISOString(), equityCents: total });
    if (total > peak) peak = total;
    const dd = peak > 0 ? ((peak - total) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  };

  for (let i = 0; i < ticks.length; i++) {
    const tick = ticks[i];
    const yes = tick.yesCents;
    const no = tick.noCents;

    if (open) {
      holdCount++;
      // mark-to-market every tick for an honest equity curve
      recordEquity(equity.length, i, yes);
      const estYes = estimateYes(yes, cfg);
      const edgeYes = estYes - yes;
      const edgeNo = 100 - estYes - no;
      const edgeNow = open.side === "YES" ? edgeYes : edgeNo;
      const exitReason = Math.abs(edgeNow) < cfg.exitEdgePts || holdCount >= params.holdTicksMax;
      if (exitReason) {
        // exit fill: adverse slippage against us
        const exitPrice = open.side === "YES" ? Math.max(1, yes - params.slippageCents) : Math.max(1, no - params.slippageCents);
        const shares = params.perTradeCents / open.entryCents;
        const gross = Math.round((exitPrice - open.entryCents) * shares);
        const fee = Math.round(params.perTradeCents * feeRate);
        cash += gross - fee;
        trades.push({
          side: open.side,
          entryIdx: open.entryIdx,
          exitIdx: i,
          entryCents: open.entryCents,
          exitCents: exitPrice,
          edgeAtEntry: open.edgeAtEntry,
          holdTicks: holdCount,
          feeCents: fee,
          pnlCents: gross - fee,
        });
        open = null;
        holdCount = 0;
        recordEquity(equity.length, i, yes);
      }
      continue;
    }

    // flat — look for an entry (liquidity guard first)
    const liquidity = Number(market.liquidityCents ?? 0);
    if (liquidity > 0 && params.perTradeCents > liquidity * LIQUIDITY_SHARE_MAX) {
      skipped++;
      continue;
    }
    const estYes = estimateYes(yes, cfg);
    const edgeYes = estYes - yes;
    const edgeNo = 100 - estYes - no;
    if (edgeYes >= params.minEdgePts) {
      const entry = Math.min(99, yes + params.slippageCents);
      open = { side: "YES", entryCents: entry, entryIdx: i, edgeAtEntry: edgeYes };
      holdCount = 0;
    } else if (edgeNo >= params.minEdgePts) {
      const entry = Math.min(99, no + params.slippageCents);
      open = { side: "NO", entryCents: entry, entryIdx: i, edgeAtEntry: edgeNo };
      holdCount = 0;
    }
    if (open) {
      const fee = Math.round(params.perTradeCents * feeRate);
      cash -= fee; // entry fee immediately
      recordEquity(equity.length, i, yes);
    }
  }

  const openAtEnd = open !== null;
  const wins = trades.filter((t) => t.pnlCents > 0).length;
  const pnl = trades.reduce((s, t) => s + t.pnlCents, 0);
  const fees = trades.reduce((s, t) => s + t.feeCents, 0);
  const stats: BacktestStats = {
    trades: trades.length,
    wins,
    winRatePct: trades.length ? Math.round((wins / trades.length) * 100) : 0,
    pnlCents: pnl,
    feesCents: fees,
    roiPct: params.simCapitalCents ? Math.round((pnl / params.simCapitalCents) * 10000) / 100 : 0,
    maxDrawdownPct: Math.round(maxDd * 10) / 10,
    avgEdgeAtEntry: trades.length ? Math.round((trades.reduce((s, t) => s + t.edgeAtEntry, 0) / trades.length) * 10) / 10 : 0,
    avgHoldTicks: trades.length ? Math.round(trades.reduce((s, t) => s + t.holdTicks, 0) / trades.length) : 0,
    skippedForLiquidity: skipped,
    openAtEnd,
  };

  // cap the stored curve at ~160 points, sampled evenly
  const curve = equity.length <= 160 ? equity : equity.filter((_, idx) => idx % Math.ceil(equity.length / 160) === 0);

  const dataSource = ticks.some((t) => t.source === "SYNTHETIC") ? "SYNTHETIC" : "LIVE";
  const run = await db.backtestRun.create({
    data: {
      robotId,
      strategyVersionId: versionId,
      marketId,
      status: "DONE",
      params: JSON.stringify(params),
      stats: JSON.stringify(stats),
      equityCurve: JSON.stringify(curve),
      trades: JSON.stringify(trades.slice(-40)),
      tickCount: ticks.length,
      dataSource,
    },
  });
  return { runId: run.id, params, stats, curve, trades: trades.slice(-40), dataSource, ticks: ticks.length, marketQuestion: market.question };
}
