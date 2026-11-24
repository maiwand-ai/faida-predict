// A-03 — Baseline definition.
// The baseline is the deterministic contrarian heuristic: every registered
// model must BEAT it on calibration before it may drive decisions, and an
// active model that loses to it is demoted. The definition lives in
// PlatformControl (config, not folklore) and is recorded in DECISIONS.md.
// Canonical formula (v1):
//   est = clamp(p + round((50 - p) * tilt / 100), 2, 98)
// where p is the YES book price in cents and tilt the configured fade.
import { db } from "@/lib/db";
import { getControl, setControl } from "@/lib/control";

export const BASELINE_KEY = "heuristic-contrarian-v1";
export const BASELINE_TILT_PCT = 25;

export interface BaselineDef {
  key: string;
  version: number;
  formula: string;
  tiltPct: number;
  kind: "HEURISTIC";
  recordedIn: string;
}

export const DEFAULT_BASELINE: BaselineDef = {
  key: BASELINE_KEY,
  version: 1,
  formula: "est = clamp(p + round((50 - p) * tilt / 100), 2, 98) — contrarian fade of the YES book toward 50%",
  tiltPct: BASELINE_TILT_PCT,
  kind: "HEURISTIC",
  recordedIn: "Built-in estimator definition (DECISIONS.md)",
};

export async function getBaselineDef(): Promise<BaselineDef> {
  return getControl<BaselineDef>("MODEL_BASELINE", DEFAULT_BASELINE);
}

// Registry knobs (config, not folklore): minimum resolved forecasts before a
// model may be promoted / demoted, how much better than baseline a candidate
// must be, and how much worse than baseline the active model may drift.
export interface ModelKnobs {
  minSamples: number;
  promotionMarginPct: number; // candidate must be this % better than baseline
  demotionTolerancePct: number; // active may be at most this % worse than baseline
}

export const DEFAULT_KNOBS: ModelKnobs = { minSamples: 30, promotionMarginPct: 5, demotionTolerancePct: 5 };

export async function getModelKnobs(): Promise<ModelKnobs> {
  const v = await getControl<ModelKnobs>("MODEL_KNOBS", DEFAULT_KNOBS);
  return {
    minSamples: Math.max(5, Math.round(v.minSamples || DEFAULT_KNOBS.minSamples)),
    promotionMarginPct: Math.min(50, Math.max(1, Math.round(v.promotionMarginPct || DEFAULT_KNOBS.promotionMarginPct))),
    demotionTolerancePct: Math.min(50, Math.max(1, Math.round(v.demotionTolerancePct || DEFAULT_KNOBS.demotionTolerancePct))),
  };
}

export async function setModelKnobs(patch: Partial<ModelKnobs>): Promise<ModelKnobs> {
  const next = { ...(await getModelKnobs()), ...patch };
  await setControl("MODEL_KNOBS", next);
  return next;
}

// The canonical baseline estimate, evaluated on a book snapshot. Every
// calibration comparison re-derives this analytically from the recorded
// market price — no stored baseline forecast needed, the formula IS the
// baseline (A-03), so the comparison sample is always identical.
export function baselineEstimate(marketPriceCents: number, tiltPct = BASELINE_TILT_PCT): number {
  const p = Math.max(1, Math.min(99, Math.round(marketPriceCents)));
  return Math.max(2, Math.min(98, p + Math.round((50 - p) * (tiltPct / 100))));
}

// Ensure the baseline row exists and is never demoted away into nothing:
// the baseline is the fallback estimator, so it can be ACTIVE or merely
// registered, but it must always exist (seed + this guard).
export async function ensureBaselineRow(): Promise<void> {
  const def = await getBaselineDef();
  await db.probabilityModel.upsert({
    where: { key: def.key },
    create: {
      key: def.key,
      kind: "HEURISTIC",
      status: "CANDIDATE",
      notes: `Built-in estimator: ${def.formula}`,
    },
    update: {},
  });
}
