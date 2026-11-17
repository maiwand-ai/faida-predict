// B10 edge gate — evidence aggregation per robot. This is where the live-gate
// starts CONSUMING real evidence instead of promises: calibration of the
// active model (A-01), provenance completeness (A-02), evidence cleanliness
// (A-06), backtest evidence (A-05), paper session length, and the C25 consent
// that only Phase 7 can record. The gate NEVER grants live trading here —
// `ready` stays false by contract until Phase 7 wires the execution gates.
import { db } from "@/lib/db";
import { getBaselineDef, getModelKnobs, BASELINE_KEY } from "./baseline";
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
      calDetail = `active ${active.key}: brier ${cal.brier.toFixed(4)} vs baseline ${cal.baselineBrier.toFixed(4)} over n=${cal.n} (min ${knobs.minSamples}), ${cal.nLive} live / ${cal.nSynthetic} synthetic (D-03)`;
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
    detail: `${withProv}/${traces.length} recent traces carry full A-02 provenance (${provPct}% ≥ 95% required)`,
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
  checks.push({ check: "BACKTEST_EVIDENCE", passed: backtests > 0, detail: `${backtests} completed A-05 backtest run(s) for this robot` });

  // 5. paper session length: enough observed decisions to judge behavior.
  checks.push({ check: "PAPER_SESSION", passed: traceTotal >= 20, detail: `${traceTotal} decision traces recorded (≥ 20 required)` });

  // 6. consent (C25): recorded consent only exists after the Phase 7 flow.
  checks.push({ check: "RECORDED_CONSENT_C25", passed: false, detail: "no recorded consent — C25 flow lands in Phase 7; live trading stays disabled by contract (B10)" });

  return {
    robotId,
    ready: false,
    checks,
    generatedAt: new Date().toISOString(),
  };
}
