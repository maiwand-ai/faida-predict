// B10 edge gate — evidence aggregation per robot. This is where the live-gate
// starts CONSUMING real evidence instead of promises: calibration of the
// active model (A-01), provenance completeness (A-02), evidence cleanliness
// (A-06), backtest evidence (A-05), paper session length, and the C25 consent
// (real since Phase 7). The edge gate alone still does NOT grant live
// trading — the Phase-7 execution gates (src/lib/live/gates.ts) stack the
// custody/credentials/pilot/B3 checks on top before any send is possible.
import { db } from "@/lib/db";
import { getBaselineDef, getModelKnobs, BASELINE_KEY } from "./baseline";
import { getConsent } from "@/lib/live/consent";
import type { CalibrationSnapshot } from "./registry";

export interface EdgeGateCheck {
  check: string;
  passed: boolean;
  detail: string;
}

export interface EdgeGateReport {
  robotId: string;
  ready: boolean; // always false until Phase 7 (consent + execution gates)
  checks: EdgeGateCheck[];
  generatedAt: string;
}

export async function edgeGateReport(robotId: string): Promise<EdgeGateReport | null> {
  const robot = await db.robot.findUnique({ where: { id: robotId } });
  if (!robot) return null;
  const def = await getBaselineDef();
  const knobs = await getModelKnobs();

  const traces = await db.decisionTrace.findMany({
    where: { robotId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, decision: true, modelKey: true, provenance: true },
  });
  const backtests = await db.backtestRun.count({ where: { robotId, status: "DONE" } });
  const traceTotal = await db.decisionTrace.count({ where: { robotId } });

  const active = await db.probabilityModel.findFirst({ where: { status: "ACTIVE" } });
  const cal = active?.calibration ? (JSON.parse(active.calibration) as CalibrationSnapshot) : null;

  // 1. model calibration (A-01): an ACTIVE model must exist and, if it is not
  //    the baseline itself, must be at least as good as the baseline floor.
  let calibrated = false;
  let calDetail = "no calibration snapshot — run Recompute";
  if (active && cal) {
    if (active.key === BASELINE_KEY) {
      calibrated = cal.n >= knobs.minSamples;
      calDetail = `active model is the baseline (${BASELINE_KEY}) with n=${cal.n} resolved forecasts (min ${knobs.minSamples})`;
    } else {
      calibrated = cal.n >= knobs.minSamples && cal.brier <= cal.baselineBrier;
      calDetail = `accuracy of ${active.key}: score ${cal.brier.toFixed(4)} vs the built-in estimator ${cal.baselineBrier.toFixed(4)} over ${cal.n} resolved markets (needs ${knobs.minSamples}); ${cal.nLive} real, ${cal.nSynthetic} simulated`;
    }
  }
  const checks: EdgeGateCheck[] = [
    { check: "MODEL_CALIBRATED", passed: calibrated, detail: calDetail },
  ];

  // 2. provenance completeness (A-02): a forecast without provenance is not
  //    evidence; the last 50 traces must carry modelKey + envelope.
  const withProv = traces.filter((t) => t.modelKey && t.provenance).length;
  const provPct = traces.length ? Math.round((withProv / traces.length) * 100) : 0;
  checks.push({
    check: "PROVENANCE_COMPLETENESS",
    passed: traces.length > 0 && provPct >= 95,
    detail: `${withProv} of ${traces.length} recent decisions record where their estimate came from (${provPct}%, needs 95%)`,
  });

  // 3. evidence cleanliness (A-06): no TRADE decided on flagged evidence.
  const flaggedTrades = traces.filter((t) => {
    if (t.decision !== "TRADE" || !t.provenance) return false;
    try {
      return JSON.parse(t.provenance).screening === "FLAGGED";
    } catch {
      return true; // unparseable provenance counts as dirty
    }
  }).length;
  checks.push({ check: "EVIDENCE_CLEAN", passed: flaggedTrades === 0, detail: `${flaggedTrades} trades decided on screened/flagged evidence in the last ${traces.length} traces (must be 0)` });

  // 4. backtest evidence (A-05, Phase 2 gate): at least one completed replay.
  checks.push({ check: "BACKTEST_EVIDENCE", passed: backtests > 0, detail: `${backtests} past-price test${backtests === 1 ? "" : "s"} completed for this robot` });

  // 5. paper session length: enough observed decisions to judge behavior.
  checks.push({ check: "PAPER_SESSION", passed: traceTotal >= 20, detail: `${traceTotal} decision traces recorded (≥ 20 required)` });

  // 6. consent (C25): real since Phase 7 — a recorded, unrevoked consent row
  //    on PlatformControl.LIVE_CONSENT is the only acceptable evidence.
  const consent = await getConsent();
  checks.push({
    check: "RECORDED_CONSENT_C25",
    passed: consent.consented && !consent.revokedAt,
    detail: consent.consented
      ? `consent recorded ${consent.recordedAt} (hash ${consent.consentHash?.slice(0, 12)}…), wallet ${consent.walletAddress}`
      : "No consent recorded yet. Record it in Settings › Real-money permissions (you type a confirmation); real money stays off until you do.",
  });

  return {
    robotId,
    ready: checks.every((c) => c.passed),
    checks,
    generatedAt: new Date().toISOString(),
  };
}
