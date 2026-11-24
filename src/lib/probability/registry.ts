// A-01 — Model registry: calibration, promotion eligibility, promote/demote.
// Calibration source: DecisionTrace rows on RESOLVED markets (A-08 traces are
// the forecast record). For every resolved forecast we compare the model's
// stored estimate against the market outcome; the baseline Brier is derived
// analytically on the same sample via the A-03 formula, so the comparison is
// always apples-to-apples. Evidence provenance (market.dataSource) is carried
// through — SYNTHETIC-heavy samples are labeled as such (D-03).
import { db } from "@/lib/db";
import { type OutboxEventType } from "@/lib/outbox";
import { notifyUser } from "@/lib/notifications";
import { baselineEstimate, ensureBaselineRow, getBaselineDef, getModelKnobs, BASELINE_KEY } from "./baseline";

export interface CalibrationSnapshot {
  n: number;
  nLive: number;
  nSynthetic: number;
  brier: number; // 0..1, lower is better (outcome 0/1, estimate 0..1)
  logLoss: number;
  baselineBrier: number;
  deltaPct: number; // + means model better than baseline
  eligible: boolean;
  demote: boolean;
  computedAt: string;
  window: string;
}

interface ForecastRow {
  modelKey: string | null;
  modelEstimatePct: number | null;
  marketPriceCents: number | null;
  dataSource: string;
  resolvedOutcome: string; // YES | NO
}

// Brier = mean((p_hat - outcome)^2) with outcome 1 for YES, 0 for NO.
function score(rows: ForecastRow[], tiltPct: number): { brier: number; logLoss: number } | null {
  if (rows.length === 0) return null;
  let brier = 0;
  let logLoss = 0;
  for (const r of rows) {
    const outcome = r.resolvedOutcome === "YES" ? 1 : 0;
    const pHat = Math.min(0.99, Math.max(0.01, (r.modelEstimatePct ?? 50) / 100));
    brier += (pHat - outcome) ** 2;
    logLoss += -(outcome * Math.log(pHat) + (1 - outcome) * Math.log(1 - pHat));
  }
  return { brier: brier / rows.length, logLoss: logLoss / rows.length };
}

// Baseline Brier over the SAME sample, derived analytically (A-03 formula on
// the recorded book price) — never a stored forecast, so models cannot gain
// an edge by choosing their comparison sample.
function baselineBrierOn(rows: ForecastRow[], tiltPct: number): number | null {
  if (rows.length === 0) return null;
  let b = 0;
  for (const r of rows) {
    const outcome = r.resolvedOutcome === "YES" ? 1 : 0;
    const pHat = Math.min(0.99, Math.max(0.01, baselineEstimate(r.marketPriceCents ?? 50, tiltPct) / 100));
    b += (pHat - outcome) ** 2;
  }
  return b / rows.length;
}

async function resolvedForecasts(modelKey: string | null, windowN: number | null): Promise<ForecastRow[]> {
  const traces = await db.decisionTrace.findMany({
    where: {
      modelKey: modelKey, // null → traces whose modelKey is unset (legacy rows are derived in recompute)
      modelEstimatePct: { not: null },
      market: { resolvedAt: { not: null }, resolutionOutcome: { in: ["YES", "NO"] } },
    },
    orderBy: { createdAt: "desc" },
    take: windowN ?? undefined,
    select: {
      modelKey: true,
      modelEstimatePct: true,
      marketPriceCents: true,
      market: { select: { dataSource: true, resolutionOutcome: true } },
    },
  });
  return traces.map((t) => ({
    modelKey: t.modelKey,
    modelEstimatePct: t.modelEstimatePct,
    marketPriceCents: t.marketPriceCents,
    dataSource: t.market.dataSource,
    resolvedOutcome: t.market.resolutionOutcome ?? "NO",
  }));
}

// Derive the model key for legacy traces that predate the registry (Phase 1–4
// traces): the estimator identity is stated in the reason/basis text. This is
// a one-time backfill per trace; new traces always carry modelKey natively.
async function backfillLegacyModelKeys(): Promise<number> {
  const unkeyed = await db.decisionTrace.findMany({
    where: { modelKey: null, modelEstimatePct: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, reason: true },
  });
  let n = 0;
  for (const t of unkeyed) {
    const key = deriveModelKey(t.reason);
    if (key) {
      await db.decisionTrace.update({ where: { id: t.id }, data: { modelKey: key } });
      n++;
    }
  }
  return n;
}

export function deriveModelKey(reason: string): string | null {
  // reasons end with the basis: "… ai:GLM/glm-4.6" or "… heuristic: contrarian …"
  const ai = reason.match(/ai:([A-Z_]+)\/([^\s,)]+)/);
  if (ai) return `ai:${ai[1]}/${ai[2]}`;
  if (reason.includes("heuristic")) return BASELINE_KEY;
  return null;
}

// Recompute calibration for every model in the registry (+ keys seen in
// traces but not yet registered → registered on sight as CANDIDATES).
export async function recomputeCalibration(): Promise<{ recomputed: number; backfilled: number }> {
  await ensureBaselineRow();
  const backfilled = await backfillLegacyModelKeys();
  const def = await getBaselineDef();
  const knobs = await getModelKnobs();

  const models = await db.probabilityModel.findMany();
  const byKey = new Map(models.map((m) => [m.key, m]));

  // keys seen in traces but missing from the registry register on sight
  const seen = await db.decisionTrace.groupBy({ by: ["modelKey"], where: { modelKey: { not: null } }, _count: true });
  for (const s of seen) {
    if (s.modelKey && !byKey.has(s.modelKey)) {
      const created = await db.probabilityModel.create({
        data: { key: s.modelKey, kind: s.modelKey.startsWith("ai:") ? "AI" : "HEURISTIC", status: "CANDIDATE", notes: "registered on first sight in traces" },
      });
      byKey.set(s.modelKey, created);
    }
  }

  let recomputed = 0;
  for (const m of byKey.values()) {
    if (m.kind === "HEURISTIC" && m.key === def.key) {
      // the baseline is scored for display; it can never be promoted/demoted
      const rows = await resolvedForecasts(m.key, null);
      const s = score(rows, def.tiltPct);
      const bb = s ? baselineBrierOn(rows, def.tiltPct) : null; // == its own brier by construction
      const snap: CalibrationSnapshot = {
        n: rows.length,
        nLive: rows.filter((r) => r.dataSource === "GAMMA_LIVE" || r.dataSource === "LIMITLESS_LIVE" || r.dataSource === "MANIFOLD_LIVE").length,
        nSynthetic: rows.filter((r) => r.dataSource === "DEMO_SNAPSHOT" || r.dataSource === "DEMO").length,
        brier: s?.brier ?? 0,
        logLoss: s?.logLoss ?? 0,
        baselineBrier: bb ?? 0,
        deltaPct: 0,
        eligible: false,
        demote: false,
        computedAt: new Date().toISOString(),
        window: "all resolved forecasts",
      };
      await db.probabilityModel.update({ where: { id: m.id }, data: { calibration: JSON.stringify(snap) } });
      recomputed++;
      continue;
    }

    // full-sample calibration + recent-window check (demotion reads the window)
    const rowsAll = await resolvedForecasts(m.key, null);
    const rowsRecent = await resolvedForecasts(m.key, knobs.minSamples);
    const sAll = score(rowsAll, def.tiltPct);
    const bbAll = sAll ? baselineBrierOn(rowsAll, def.tiltPct) : null;
    const sRecent = score(rowsRecent, def.tiltPct);
    const bbRecent = sRecent ? baselineBrierOn(rowsRecent, def.tiltPct) : null;

    const eligible =
      sAll != null &&
      bbAll != null &&
      rowsAll.length >= knobs.minSamples &&
      sAll.brier < bbAll * (1 - knobs.promotionMarginPct / 100);
    const demote =
      sRecent != null &&
      bbRecent != null &&
      rowsRecent.length >= knobs.minSamples &&
      sRecent.brier > bbRecent * (1 + knobs.demotionTolerancePct / 100);

    const snap: CalibrationSnapshot = {
      n: rowsAll.length,
      nLive: rowsAll.filter((r) => r.dataSource === "GAMMA_LIVE" || r.dataSource === "LIMITLESS_LIVE" || r.dataSource === "MANIFOLD_LIVE").length,
      nSynthetic: rowsAll.filter((r) => r.dataSource === "DEMO_SNAPSHOT" || r.dataSource === "DEMO").length,
      brier: sAll?.brier ?? 0,
      logLoss: sAll?.logLoss ?? 0,
      baselineBrier: bbAll ?? 0,
      deltaPct: sAll && bbAll && bbAll > 0 ? Math.round(((bbAll - sAll.brier) / bbAll) * 10000) / 100 : 0,
      eligible,
      demote,
      computedAt: new Date().toISOString(),
      window: `all (${rowsAll.length}) · recent ${Math.min(rowsRecent.length, knobs.minSamples)}`,
    };
    await db.probabilityModel.update({ where: { id: m.id }, data: { calibration: JSON.stringify(snap) } });
    recomputed++;
  }
  return { recomputed, backfilled };
}

// ── Promotion / demotion (B8: humans own activation; demotion is evidence- ──
//    driven and can run automatically via the drill or a scheduled pass)

export async function promoteModel(key: string): Promise<{ ok: boolean; detail: string }> {
  await ensureBaselineRow();
  const model = await db.probabilityModel.findUnique({ where: { key } });
  if (!model) return { ok: false, detail: "model not found" };
  if (model.key === BASELINE_KEY) return { ok: false, detail: "baseline is always registered — nothing to promote" };
  if (model.kind === "AI") {
    const provider = await db.aiProvider.findFirst({ where: { name: model.providerName ?? "" } });
    if (provider && !provider.enabled) {
      return { ok: false, detail: `provider ${model.providerName} is disabled — enable it in Settings first` };
    }
  }
  const knobs = await getModelKnobs();
  const cal = model.calibration ? (JSON.parse(model.calibration) as CalibrationSnapshot) : null;
  if (!cal || cal.n < knobs.minSamples) {
    return { ok: false, detail: `not enough resolved forecasts: ${cal?.n ?? 0} < min ${knobs.minSamples}` };
  }
  if (!cal.eligible) {
    return { ok: false, detail: `calibration not better than baseline by ${knobs.promotionMarginPct}%: delta ${cal.deltaPct}%` };
  }

  const prevActives = await db.probabilityModel.findMany({ where: { status: "ACTIVE" } });
  for (const prev of prevActives) {
    // the baseline is never retired — it returns to the registered floor; any
    // other previously-active model is superseded and RETIRED (A-01)
    const nextStatus = prev.key === BASELINE_KEY ? "CANDIDATE" : "RETIRED";
    const note = prev.key === BASELINE_KEY ? "floor restored to registry after a promotion" : "superseded by promotion";
    await db.probabilityModel.update({ where: { id: prev.id }, data: { status: nextStatus, notes: note } });
  }
  await db.probabilityModel.update({ where: { id: model.id }, data: { status: "ACTIVE", promotedAt: new Date(), notes: `promoted: brier ${cal.brier.toFixed(4)} vs baseline ${cal.baselineBrier.toFixed(4)} over ${cal.n} resolved forecasts` } });

  const prevNote = prevActives.length ? ` Previous active: ${prevActives.map((p) => `${p.key} → ${p.key === BASELINE_KEY ? "CANDIDATE" : "RETIRED"}`).join(", ")}.` : "";
  await notifyGovernance(
    "INFO",
    "Model promoted",
    `${model.key} is now ACTIVE (brier ${cal.brier.toFixed(4)} vs baseline ${cal.baselineBrier.toFixed(4)}, n=${cal.n}, resolved evidence ${cal.nLive} live / ${cal.nSynthetic} synthetic).${prevNote}`,
    `promote:${model.key}`,
  );
  await outboxGovernance("MODEL_PROMOTED", model.key, { key: model.key, brier: cal.brier, n: cal.n });
  return { ok: true, detail: `${model.key} promoted to ACTIVE` };
}

export async function demoteModel(key: string, reason: string, automatic = false): Promise<{ ok: boolean; detail: string }> {
  const model = await db.probabilityModel.findUnique({ where: { key } });
  if (!model) return { ok: false, detail: "model not found" };
  if (model.status !== "ACTIVE") return { ok: false, detail: `model is ${model.status}, only the ACTIVE model can be demoted` };
  if (model.key === BASELINE_KEY) return { ok: false, detail: "the built-in estimator can't be demoted: it's the fallback every robot relies on" };

  await db.probabilityModel.update({
    where: { id: model.id },
    data: { status: "DEMOTED", demotedAt: new Date(), notes: `demoted (${automatic ? "automatic drill" : "manual"}): ${reason}` },
  });
  // The baseline becomes the working estimator again (ensure + activate).
  await ensureBaselineRow();
  await db.probabilityModel.updateMany({ where: { key: BASELINE_KEY }, data: { status: "ACTIVE" } });

  await notifyGovernance(
    "WARNING",
    `Model demoted${automatic ? " (drill)" : ""}`,
    `${model.key} was demoted — ${reason} All robots fall back to the baseline heuristic (${BASELINE_KEY}) until a model is promoted again.`,
    `demote:${model.key}`,
  );
  await outboxGovernance("MODEL_DEMOTED", model.key, { key: model.key, reason, automatic });
  return { ok: true, detail: `${model.key} demoted → baseline ACTIVE` };
}

// Demotion pass: if the ACTIVE model's recent-window calibration is worse than
// baseline by the tolerance, demote it (A-01 closing criterion — the drill
// exercises exactly this path).
export async function checkDemotion(): Promise<{ demoted: string | null; detail: string }> {
  await ensureBaselineRow();
  const active = await db.probabilityModel.findFirst({ where: { status: "ACTIVE" } });
  if (!active) return { demoted: null, detail: "no ACTIVE model registered" };
  if (active.key === BASELINE_KEY) return { demoted: null, detail: "baseline active — nothing to check" };
  if (active.calibration == null) await recomputeCalibration();
  const fresh = await db.probabilityModel.findUnique({ where: { key: active.key } });
  const cal = fresh?.calibration ? (JSON.parse(fresh.calibration) as CalibrationSnapshot) : null;
  if (!cal) return { demoted: null, detail: "no calibration snapshot" };
  if (!cal.demote) {
    return { demoted: null, detail: `within tolerance: recent brier ${cal.brier.toFixed(4)} vs baseline ${cal.baselineBrier.toFixed(4)}` };
  }
  const res = await demoteModel(
    active.key,
    `recent-window calibration degraded: brier ${cal.brier.toFixed(4)} vs baseline ${cal.baselineBrier.toFixed(4)} over ${cal.n} resolved forecasts (tolerance exceeded)`,
    true,
  );
  return { demoted: res.ok ? active.key : null, detail: res.detail };
}

async function notifyGovernance(severity: "INFO" | "WARNING" | "CRITICAL", title: string, body: string, dedupeKey?: string): Promise<void> {
  const user = await db.user.findUnique({ where: { email: "founder@faida.local" }, select: { id: true } });
  if (!user) return;
  // P-04 taxonomy: MODEL_GOVERNANCE — capped + digested (promotion/demotion
  // bursts read better as one grouped row than a stack of singles).
  await notifyUser(user.id, { family: "MODEL_GOVERNANCE", severity, title, body, dedupeKey });
}

// Governance outbox events are deterministic: the create is awaited, never
// fire-and-forget — the audit trail (S-02) must not depend on promise races.
async function outboxGovernance(eventType: Extract<OutboxEventType, "MODEL_PROMOTED" | "MODEL_DEMOTED">, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
  await db.outboxEvent.create({
    data: {
      aggregateType: "MODEL",
      aggregateId,
      eventType,
      payload: JSON.stringify(payload),
    },
  });
}

// Read view for the API/UI: registry with fresh calibration + knobs.
export async function listRegistry() {
  await ensureBaselineRow();
  const def = await getBaselineDef();
  const knobs = await getModelKnobs();
  const models = await db.probabilityModel.findMany({ orderBy: [{ status: "asc" }, { kind: "asc" }, { key: "asc" }] });
  return {
    baseline: def,
    knobs,
    models: models.map((m) => ({
      key: m.key,
      kind: m.kind,
      providerName: m.providerName,
      providerModel: m.providerModel,
      status: m.status,
      notes: m.notes,
      calibration: m.calibration ? (JSON.parse(m.calibration) as CalibrationSnapshot) : null,
      promotedAt: m.promotedAt,
      demotedAt: m.demotedAt,
    })),
  };
}
