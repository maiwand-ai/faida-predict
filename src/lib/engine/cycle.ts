// Robot evaluation cycle — one tick per robot.
// Heuristic estimator by default (deterministic, no key required); upgrades to
// the AI gateway automatically when any provider key is enabled (A-06).
// Every decision — trade or no-trade — writes a DecisionTrace (A-08).
// Phase 2: entry/exit knobs come from the robot's active strategy version
// (C5) and every cycle appends a MarketPriceTick to the A-05 recorder.
// Phase 3: global pause gate (C19/S-07, propagation measured), per-robot
// loop lease (S-06), pre-trade staleness gate (S-10).
// Phase 4: edge computed AFTER venue taker fees (rule b — fee schedule is
// stored on the market at sync), risk checks carry the entry side so venue
// structural rules (touch depth, per-market cap) arm per venue.
import { db } from "@/lib/db";
import { parityGapCents } from "@/lib/money";
import { feeDragPts } from "@/lib/venue/rules";
import { placePaperOrder } from "./paper";
import { preTradeRiskChecks } from "@/lib/risk";
import { estimateWithAi } from "@/lib/ai/gateway";
import { parseConfig, DEFAULT_CONFIG, type StrategyConfig } from "@/lib/strategy";
import {
  acquireRobotLease,
  getPauseState,
  getStalenessThresholdMs,
  releaseRobotLease,
} from "@/lib/control";

export interface CycleSummary {
  robotId: string;
  robotName: string;
  decision: "TRADE" | "NO_TRADE";
  reason: string;
  traceId: string;
}

export interface RiskCheck {
  check: string;
  passed: boolean;
  detail: string;
}

function heuristicEstimate(market: { yesPriceCents: number | null; noPriceCents: number | null }, cfg: StrategyConfig): { estimatePct: number; basis: string } {
  // Deterministic paper heuristic: fade the book toward 50 with the strategy's
  // configured tilt, so demo robots produce both trades and no-trades.
  const p = market.yesPriceCents ?? 50;
  const tilt = Math.round((50 - p) * (cfg.estimatorTiltPct / 100));
  const est = Math.max(2, Math.min(98, p + tilt));
  return { estimatePct: est, basis: `heuristic: contrarian tilt ${cfg.estimatorTiltPct}% of book price toward 50%` };
}

export async function recordTick(marketId: string, yesCents: number, noCents: number, source: string) {
  return db.marketPriceTick.create({ data: { marketId, yesCents, noCents, source } });
}

export async function runRobotCycle(robotId: string): Promise<CycleSummary> {
  const robot = await db.robot.findUnique({ where: { id: robotId }, include: { user: true } });
  if (!robot) throw new Error("robot not found");
  if (!["RUNNING", "PAPER_ONLY"].includes(robot.status)) {
    return { robotId, robotName: robot.name, decision: "NO_TRADE", reason: `robot is ${robot.status} — cycle skipped`, traceId: "-" };
  }

  // pick the most liquid live market on THIS robot's venue (B11 venue scoping)
  // without an open position on the chosen side
  const market = await db.market.findFirst({
    where: { venue: robot.venue, ambiguityFlag: false, resolvedAt: null, yesPriceCents: { not: null } },
    orderBy: { volumeCents: "desc" },
  });
  if (!market) {
    return { robotId, robotName: robot.name, decision: "NO_TRADE", reason: `no eligible live market on ${robot.venue}`, traceId: "-" };
  }

  // ── global pause gate (C19/S-07): checked FIRST, propagation measured ────
  // The refusal is traced against the market the robot would have evaluated,
  // so soak evidence stays complete (every cycle produces a trace).
  const pause = await getPauseState();
  if (pause.paused) {
    const pausedAtMs = pause.pausedAt ? Date.parse(pause.pausedAt) : null;
    const propagationMs = pausedAtMs != null && Number.isFinite(pausedAtMs) ? Math.max(0, Date.now() - pausedAtMs) : null;
    const trace = await db.decisionTrace.create({
      data: {
        robotId: robot.id,
        marketId: market.id,
        strategyVersionId: null,
        trigger: "SCHEDULE_TICK",
        decision: "NO_TRADE",
        reason: `platform paused (C19): ${pause.reason ?? "manual pause"} — refused ${propagationMs != null ? `${propagationMs}ms after pause decision` : "while pause active"}`,
        riskChecks: JSON.stringify([
          { check: "GLOBAL_PAUSE", passed: false, detail: pause.reason ?? "manual pause" } as RiskCheck,
        ]),
      },
    });
    return {
      robotId,
      robotName: robot.name,
      decision: "NO_TRADE",
      reason: `platform paused — cycle refused (${pause.reason ?? "manual pause"})`,
      traceId: trace.id,
    };
  }

  // ── per-robot loop lease (S-06): a retried tick or second worker never ───
  //    double-runs the same robot; expiry allows takeover after a crash.
  const holder = `cycle_${robotId}_${crypto.randomUUID()}`;
  const lease = await acquireRobotLease(robot.id, holder);
  if (!lease.ok) {
    return {
      robotId,
      robotName: robot.name,
      decision: "NO_TRADE",
      reason: `no-trade: robot lease held by another runner (S-06) until ${lease.expiresAt?.toISOString() ?? "?"}`,
      traceId: "-",
    };
  }

  try {
    // ── staleness gate (S-10): refuse decisions on stale market data ───────
    const stalenessMs = await getStalenessThresholdMs();
    const ageMs = Date.now() - market.updatedAt.getTime();
    const staleCheck: RiskCheck = {
      check: "STALE_DATA",
      passed: ageMs <= stalenessMs,
      detail: `market age ${Math.round(ageMs / 1000)}s vs threshold ${Math.round(stalenessMs / 1000)}s (S-10)`,
    };

    const sv = await db.strategyVersion.findFirst({ where: { robotId: robot.id, version: robot.activeVersion } });
    const cfg = sv ? parseConfig(sv.config) : { ...DEFAULT_CONFIG };

    // A-05 recorder: every cycle observation lands in the tick history
    if (market.yesPriceCents != null && market.noPriceCents != null) {
      await recordTick(market.id, market.yesPriceCents, market.noPriceCents, "CYCLE");
    }

    // 1) estimate — AI when configured, strategy-config heuristic otherwise
    const ai = await estimateWithAi(market.question, market.yesPriceCents ?? 50);
    const est = ai ?? heuristicEstimate(market, cfg);
    const marketPct = market.yesPriceCents ?? 50;
    const grossEdgePts = est.estimatePct - marketPct;
    const parity = market.yesPriceCents != null && market.noPriceCents != null ? parityGapCents(market.yesPriceCents, market.noPriceCents) : null;

    // Side is determined by the sign of the gross edge (conviction direction);
    // fees size the threshold, they do not flip the direction.
    const side: "BUY_YES" | "BUY_NO" = grossEdgePts > 0 ? "BUY_YES" : "BUY_NO";
    // (b) edge-after-fees: the venue's taker fee at the entry price is stored
    // on the market at sync (fee schedule is config, never hardcoded — C4.4).
    // Breakeven moves from p to p×(1+fee), so the drag is p × fee in points.
    const entryPriceCents = side === "BUY_YES" ? (market.yesPriceCents ?? 50) : (market.noPriceCents ?? 50);
    const entryFeeBps = (side === "BUY_YES" ? market.yesTakerFeeBps : market.noTakerFeeBps) ?? 0;
    const feeDrag = feeDragPts(entryPriceCents, entryFeeBps);
    const netEdgePts = grossEdgePts - feeDrag;

    // 2) risk checks (recorded even when no trade happens — that's where trust is built)
    const balance = await db.ledgerEntry
      .findMany({ where: { userId: robot.userId, mode: "PAPER" }, orderBy: { createdAt: "desc" }, take: 1 })
      .then((r) => r[0]?.balanceAfterCents ?? 0);
    const sizeCents = Math.min(robot.maxPositionCents, Math.max(500, Math.floor(robot.allocatedCents / 10)));
    const riskChecks = [staleCheck, ...(await preTradeRiskChecks({
      userId: robot.userId,
      robot,
      marketId: market.id,
      side,
      sizeCents,
      balanceCents: balance,
    }))];
    const failed = riskChecks.find((c) => !c.passed);

    // 3) decide
    const edgeMagnitude = Math.abs(netEdgePts);
    let decision: "TRADE" | "NO_TRADE" = "NO_TRADE";
    let reason: string;
    const feeClause =
      entryFeeBps > 0
        ? ` − ${feeDrag.toFixed(1)} pts ${robot.venue} taker fee (${entryFeeBps}bps @ ${entryPriceCents}¢) = ${netEdgePts.toFixed(1)} pts net`
        : " (no taker fee on this venue)";

    if (!staleCheck.passed) {
      reason = `no-trade: stale market data — age ${Math.round(ageMs / 1000)}s exceeds freshness threshold ${Math.round(stalenessMs / 1000)}s (S-10); sync ${robot.venue} markets first`;
    } else if (failed) {
      reason = `no-trade: risk check failed — ${failed.check}: ${failed.detail}`;
    } else if (edgeMagnitude < cfg.minEdgePts) {
      reason = `no-trade: edge ${grossEdgePts} pts gross${feeClause} below minimum ${cfg.minEdgePts} pts net of fees (strategy v${robot.activeVersion})`;
    } else if (est.basis.startsWith("ai:") && est.estimatePct < 3) {
      reason = `no-trade: AI estimate unreliable (${est.estimatePct}%)`;
    } else {
      decision = "TRADE";
      reason = `trade: ${side} on "${market.question.slice(0, 50)}" — estimate ${est.estimatePct}% vs market ${marketPct}% = ${grossEdgePts} pts gross edge${feeClause}, ${est.basis}`;
    }

    // 4) trace (A-08) — immutable record either way; edgeNetPct is the fee-
    //    adjusted edge so backtests and the live gate see the honest number.
    const trace = await db.decisionTrace.create({
      data: {
        robotId: robot.id,
        marketId: market.id,
        strategyVersionId: sv?.id ?? null,
        trigger: "SCHEDULE_TICK",
        modelEstimatePct: est.estimatePct,
        marketPriceCents: marketPct,
        edgeNetPct: Math.round(netEdgePts),
        decision,
        reason,
        riskChecks: JSON.stringify(riskChecks),
      },
    });

    // 5) execute paper order when trading
    if (decision === "TRADE") {
      const res = await placePaperOrder({
        userId: robot.userId,
        robotId: robot.id,
        marketId: market.id,
        side,
        priceCents: side === "BUY_YES" ? (market.yesPriceCents ?? 50) : (market.noPriceCents ?? 50),
        sizeCents,
        nonce: `cycle_${trace.id}`,
        trigger: "SCHEDULE_TICK",
      });
      if (!res.ok) {
        reason = `trade attempt rejected at ${res.stage}: ${res.reason}`;
        await db.decisionTrace.update({ where: { id: trace.id }, data: { decision: "NO_TRADE", reason } });
        decision = "NO_TRADE";
      }
    }

    return { robotId, robotName: robot.name, decision, reason, traceId: trace.id };
  } finally {
    await releaseRobotLease(robot.id, holder);
  }
}

export async function runAllCycles(): Promise<CycleSummary[]> {
  const robots = await db.robot.findMany({ where: { status: { in: ["RUNNING", "PAPER_ONLY"] } } });
  const out: CycleSummary[] = [];
  for (const r of robots) {
    try {
      out.push(await runRobotCycle(r.id));
    } catch (e) {
      out.push({ robotId: r.id, robotName: r.name, decision: "NO_TRADE", reason: `cycle error: ${String(e)}`, traceId: "-" });
    }
  }
  return out;
}
