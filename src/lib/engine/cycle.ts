// Robot evaluation cycle — one tick per robot.
// Heuristic estimator by default (deterministic, no key required); upgrades to
// the registry ACTIVE model automatically when it is calibrated (A-01).
// Every decision — trade or no-trade — writes a DecisionTrace (A-08), and
// since Phase 5 every trace names the exact model + full provenance (A-02).
// Phase 2: entry/exit knobs come from the robot's active strategy version
// (C5) and every cycle appends a MarketPriceTick to the A-05 recorder.
// Phase 3: global pause gate (C19/S-07, propagation measured), per-robot
// loop lease (S-06), pre-trade staleness gate (S-10).
// Phase 4: edge computed AFTER venue taker fees (rule b — fee schedule is
// stored on the market at sync), risk checks carry the entry side so venue
// structural rules (touch depth, per-market cap) arm per venue.
// Phase 5: single estimator chain (screen → cache → AI → baseline fallback)
// with prompt-injection screening fail-closed and cache/cost governance.
import { db } from "@/lib/db";
import { parityGapCents } from "@/lib/money";
import { feeDragPts } from "@/lib/venue/rules";
import { closePaperPosition, placePaperOrder } from "./paper";
import { placeLiveOrder } from "@/lib/live/execute";
import { preTradeRiskChecks } from "@/lib/risk";
import { estimateForMarket } from "@/lib/probability/estimate";
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
    where: {
      venue: robot.venue,
      ambiguityFlag: false,
      resolvedAt: null,
      yesPriceCents: { not: null },
      positions: { none: { robotId: robot.id, status: "OPEN" } },
    },
    orderBy: { volumeCents: "desc" },
  });
  if (!market) {
    const pauseNow = await getPauseState();
    const exits = robot.mode === "LIVE_PILOT" || pauseNow.paused ? [] : await managePaperExits(robot.id, robot.activeVersion);
    const note = exits.length ? ` · closed ${exits.length} position${exits.length === 1 ? "" : "s"}` : "";
    return { robotId, robotName: robot.name, decision: "NO_TRADE", reason: `no eligible live market on ${robot.venue}${note}`, traceId: "-" };
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
        reason: `platform paused: ${pause.reason ?? "manual pause"} — refused ${propagationMs != null ? `${propagationMs}ms after pause decision` : "while pause active"}`,
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
      reason: `no-trade: robot lease held by another runner (another check is already running it) until ${lease.expiresAt?.toISOString() ?? "?"}`,
      traceId: "-",
    };
  }

  try {
    // ── exit management (paper robots): review open positions first ───────
    const exits = robot.mode === "LIVE_PILOT" ? [] : await managePaperExits(robot.id, robot.activeVersion);
    const exitNote = exits.length ? ` · closed ${exits.length} position${exits.length === 1 ? "" : "s"}` : "";

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

    // 1) estimate — one chain: registry ACTIVE model → screen → cache → AI →
    //    baseline fallback; every output carries the A-02 provenance envelope.
    const est = await estimateForMarket({
      question: market.question,
      yesPriceCents: market.yesPriceCents,
      noPriceCents: market.noPriceCents,
      marketId: market.id,
      venue: robot.venue,
      dataSource: market.dataSource,
      estimatorTiltPct: cfg.estimatorTiltPct,
    });
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
    //    LIVE_PILOT robots read the LIVE ledger (mode LIVE), paper robots the paper book.
    const livePilot = robot.mode === "LIVE_PILOT";
    const balance = await db.ledgerEntry
      .findMany({ where: { userId: robot.userId, mode: livePilot ? "LIVE" : "PAPER" }, orderBy: { createdAt: "desc" }, take: 1 })
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
    } else if (est.provenance.kind === "AI" && est.estimatePct < 3) {
      reason = `no-trade: AI estimate unreliable (${est.estimatePct}%)`;
    } else {
      decision = "TRADE";
      reason = `trade: ${side} on "${market.question.slice(0, 50)}" — estimate ${est.estimatePct}% vs market ${marketPct}% = ${grossEdgePts} pts gross edge${feeClause}, ${est.basis}`;
    }

    // 4) trace (A-08) — immutable record either way; edgeNetPct is the fee-
    //    adjusted edge so backtests and the live gate see the honest number.
    //    Phase 5 (A-02): the trace names the producing model and carries the
    //    provenance envelope — a forecast without provenance is not evidence.
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
        modelKey: est.modelKey,
        provenance: JSON.stringify(est.provenance),
      },
    });

    // 5) execute the order when trading — paper robots through the paper book,
    //    LIVE_PILOT robots through the gated live path (consent + gates + pilot
    //    caps + B5 book freshness + self-custody signing + send boundary).
    if (decision === "TRADE") {
      const commonOrder = {
        userId: robot.userId,
        robotId: robot.id,
        marketId: market.id,
        side,
        priceCents: side === "BUY_YES" ? (market.yesPriceCents ?? 50) : (market.noPriceCents ?? 50),
        sizeCents,
        nonce: `cycle_${trace.id}`,
        trigger: "SCHEDULE_TICK" as const,
      };
      if (livePilot) {
        const live = await placeLiveOrder(commonOrder);
        if (!live.ok) {
          reason = `live attempt rejected at ${live.stage}: ${live.reason}`;
          await db.decisionTrace.update({ where: { id: trace.id }, data: { decision: "NO_TRADE", reason } });
          decision = "NO_TRADE";
        } else if (live.dryRun) {
          reason = `${reason} — LIVE DRY-RUN: order signed (payload ${live.signedPayloadHash.slice(0, 12)}…) and audited, NOT sent (arm switch off)`;
          await db.decisionTrace.update({ where: { id: trace.id }, data: { reason } });
        }
      } else {
        const res = await placePaperOrder(commonOrder);
        if (!res.ok) {
          reason = `trade attempt rejected at ${res.stage}: ${res.reason}`;
          await db.decisionTrace.update({ where: { id: trace.id }, data: { decision: "NO_TRADE", reason } });
          decision = "NO_TRADE";
        }
      }
    }

    return { robotId, robotName: robot.name, decision, reason: reason + exitNote, traceId: trace.id };
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

// ── Exit management (paper robots) ───────────────────────────────────────────
// Every cycle reviews the robot's open positions and closes those whose
// thesis is gone, using the robot's active strategy version:
//   • edge on the held side fell below exitEdgePts (same estimator chain as
//     entries, so the exit sees the same model the entry saw), or
//   • the position has been held for holdTicksMax recorded price ticks, or
//   • the market's close date has passed.
// Each exit is a paper sell at the current price (closePaperPosition) and a
// DecisionTrace with decision "EXIT" and the reason, so it shows up in the
// robot's journal like every other decision.
async function managePaperExits(robotId: string, activeVersion: number): Promise<Array<{ positionId: string; pnlCents: number }>> {
  const positions = await db.position.findMany({ where: { robotId, status: "OPEN" }, include: { market: true } });
  if (positions.length === 0) return [];
  const sv = await db.strategyVersion.findFirst({ where: { robotId, version: activeVersion } });
  const cfg = sv ? parseConfig(sv.config) : { ...DEFAULT_CONFIG };
  const robot = await db.robot.findUnique({ where: { id: robotId }, select: { venue: true } });
  const out: Array<{ positionId: string; pnlCents: number }> = [];
  for (const p of positions) {
    const m = p.market;
    const mark = p.side === "YES" ? m.yesPriceCents : m.noPriceCents;
    if (mark == null) continue; // cannot price it — keep and retry next cycle
    const heldTicks = await db.marketPriceTick.count({ where: { marketId: m.id, capturedAt: { gt: p.openedAt } } });
    const closed = m.closeDate != null && m.closeDate.getTime() <= Date.now();
    let why: string | null = null;
    let estPct: number | null = null;
    let heldEdge: number | null = null;
    let modelKey: string | null = null;
    let provenance: string | null = null;
    if (closed) {
      why = "market close date has passed";
    } else if (heldTicks >= cfg.holdTicksMax) {
      why = `time stop: held ${heldTicks} ticks ≥ max ${cfg.holdTicksMax}`;
    } else {
      const est = await estimateForMarket({
        question: m.question,
        yesPriceCents: m.yesPriceCents,
        noPriceCents: m.noPriceCents,
        marketId: m.id,
        venue: robot?.venue ?? m.venue,
        dataSource: m.dataSource,
        estimatorTiltPct: cfg.estimatorTiltPct,
      });
      estPct = est.estimatePct;
      modelKey = est.modelKey;
      provenance = JSON.stringify(est.provenance);
      // edge on the side we hold: YES = estimate − YES price; NO = (100 − estimate) − NO price
      heldEdge = p.side === "YES" ? est.estimatePct - mark : 100 - est.estimatePct - mark;
      if (heldEdge < cfg.exitEdgePts) why = `edge on held ${p.side} side is ${heldEdge.toFixed(1)} pts, below exit threshold ${cfg.exitEdgePts} pts`;
    }
    if (!why) continue;
    const res = await closePaperPosition({ positionId: p.id, reason: why });
    const reason = res.ok
      ? `exit: closed ${p.side} on "${m.question.slice(0, 50)}" at ${mark}¢ (entry ${p.avgPriceCents}¢) — ${why}; realized ${res.pnlCents >= 0 ? "+" : ""}${res.pnlCents}¢${res.feeCents ? `, fee ${res.feeCents}¢` : ""}`
      : `exit attempt failed — ${res.reason} (${why})`;
    await db.decisionTrace.create({
      data: {
        robotId,
        marketId: m.id,
        strategyVersionId: sv?.id ?? null,
        trigger: "SCHEDULE_TICK",
        modelEstimatePct: estPct,
        marketPriceCents: m.yesPriceCents,
        edgeNetPct: heldEdge != null ? Math.round(heldEdge) : null,
        decision: res.ok ? "EXIT" : "NO_TRADE",
        reason,
        riskChecks: JSON.stringify([{ check: "EXIT_RULES", passed: true, detail: why }]),
        modelKey,
        provenance,
      },
    });
    if (res.ok) out.push({ positionId: p.id, pnlCents: res.pnlCents });
  }
  return out;
}
