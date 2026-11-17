// A-02/A-06/A-07 — The single estimator entry point the cycle uses.
// Chain: ACTIVE registry model → (AI kind) injection screen → cache → AI
// gateway → baseline fallback. Every return carries the A-02 provenance
// envelope; a trace whose forecast has no provenance is not evidence (B10).
import { db } from "@/lib/db";
import { ensureBaselineRow, baselineEstimate } from "./baseline";
import { evidenceHash, screenEvidence, cacheKeyFor, sanitizeText } from "./screening";
import { estimateWithAi } from "@/lib/ai/gateway";
import { getControl } from "@/lib/control";

export const BASELINE_VERSION = "heuristic-contrarian-v1";

export interface Provenance {
  modelKey: string;
  kind: "HEURISTIC" | "AI";
  provider?: string;
  model?: string;
  latencyMs?: number;
  cache?: "HIT" | "MISS" | "NONE";
  evidenceHash: string;
  promptHash?: string;
  screening: "PASS" | "FLAGGED";
  screeningReasons?: string[];
  estimatorVersion: string;
  fallbackFrom?: string;
  costCents?: number;
}

export interface EstimateOutput {
  estimatePct: number;
  basis: string;
  modelKey: string;
  provenance: Provenance;
}

export interface EstimateInput {
  question: string;
  yesPriceCents: number | null;
  noPriceCents: number | null;
  marketId: string;
  venue: string;
  dataSource: string;
  estimatorTiltPct: number; // strategy-config tilt is used ONLY for the baseline fallback (C5)
}

function baselineOutput(input: EstimateInput, evHash: string, screening: Provenance["screening"], reasons: string[], fallbackFrom?: string, screeningNote?: string): EstimateOutput {
  const p = input.yesPriceCents ?? 50;
  // the strategy tilt (C5) personalizes the fallback so robots keep distinct
  // behavior; the A-03 baseline itself (registry/calibration) uses tilt 25
  const tilt = input.estimatorTiltPct ?? 25;
  const est = Math.max(2, Math.min(98, p + Math.round((50 - p) * (tilt / 100))));
  const basis =
    `heuristic: contrarian tilt ${tilt}% of book price toward 50%` +
    (fallbackFrom ? ` [${screeningNote ?? "AI unavailable"} — fell back from ${fallbackFrom}]` : "") +
    (screening === "FLAGGED" ? ` [A-06 screen: ${reasons.join("; ")}]` : "");
  return {
    estimatePct: est,
    basis,
    modelKey: BASELINE_VERSION,
    provenance: {
      modelKey: BASELINE_VERSION,
      kind: "HEURISTIC",
      evidenceHash: evHash,
      screening,
      screeningReasons: reasons.length ? reasons : undefined,
      estimatorVersion: BASELINE_VERSION,
      fallbackFrom,
      cache: "NONE",
    },
  };
}

// cached def read (sync context): the baseline def is static in practice; the
// registry row is the durable copy — this only supplies the tilt for display.
async function cacheTtlMs(): Promise<number> {
  const ttlSec = await getControl<number>("AI_CACHE_TTL_S", 21600); // 6 h default
  return Math.max(0, Math.round(ttlSec)) * 1000;
}

export async function estimateForMarket(input: EstimateInput): Promise<EstimateOutput> {
  await ensureBaselineRow();
  const evHash = evidenceHash([input.marketId, input.venue, input.question, input.yesPriceCents, input.noPriceCents, input.dataSource]);
  const screen = screenEvidence(input.question);

  const active = await db.probabilityModel.findFirst({ where: { status: "ACTIVE" } });

  // ── AI model active ─────────────────────────────────────────────────────
  if (active && active.kind === "AI") {
    // A-06 fail-closed: flagged evidence never reaches a prompt
    if (screen.flagged) {
      return baselineOutput(input, evHash, "FLAGGED", screen.reasons, active.key, "A-06 injection screen flagged the evidence");
    }
    const providerRow = await db.aiProvider.findFirst({ where: { name: active.providerName ?? "" } });
    const providerModel = active.providerModel ?? providerRow?.model ?? "";
    const providerName = active.providerName ?? "";

    // A-07 cache: same provider+model+market state within TTL = free estimate
    const ck = cacheKeyFor([providerName, providerModel, input.question, input.yesPriceCents, input.noPriceCents]);
    const ttlMs = await cacheTtlMs();
    if (ttlMs > 0) {
      const hit = await db.aiCacheEntry.findUnique({ where: { cacheKey: ck } });
      if (hit && Date.now() - hit.createdAt.getTime() <= ttlMs) {
        await db.aiCallLog.create({
          data: { providerName, model: providerModel, cache: "HIT", latencyMs: 0, costCents: 0, outcome: "OK" },
        });
        return {
          estimatePct: hit.estimatePct,
          basis: `${hit.basis} [cache HIT — A-07]`,
          modelKey: active.key,
          provenance: {
            modelKey: active.key,
            kind: "AI",
            provider: providerName,
            model: providerModel,
            latencyMs: 0,
            cache: "HIT",
            evidenceHash: evHash,
            screening: "PASS",
            estimatorVersion: active.key,
            costCents: 0,
          },
        };
      }
    }

    const t0 = Date.now();
    const sanitized = sanitizeText(input.question);
    const ai = await estimateWithAi(sanitized, input.yesPriceCents ?? 50, ttlMs > 0 ? "MISS" : "NONE");
    const latencyMs = Date.now() - t0;
    if (ai) {
      if (ttlMs > 0) {
        await db.aiCacheEntry.upsert({
          where: { cacheKey: ck },
          create: { cacheKey: ck, providerName, model: providerModel, estimatePct: ai.estimatePct, basis: ai.basis },
          update: { estimatePct: ai.estimatePct, basis: ai.basis, createdAt: new Date() },
        });
      }
      return {
        estimatePct: ai.estimatePct,
        basis: ai.basis,
        modelKey: active.key,
        provenance: {
          modelKey: active.key,
          kind: "AI",
          provider: providerName,
          model: providerModel,
          latencyMs,
          cache: ttlMs > 0 ? "MISS" : "NONE",
          evidenceHash: evHash,
          screening: "PASS",
          estimatorVersion: active.key,
        },
      };
    }
    // gateway could not produce an estimate (no enabled provider, budget
    // exhausted, failure) — the baseline answers, honestly labeled
    return baselineOutput(input, evHash, screen.flagged ? "FLAGGED" : "PASS", screen.reasons, active.key, "AI gateway unavailable");
  }

  // ── heuristic model active (baseline or registered heuristic variant) ──
  if (active && active.kind === "HEURISTIC") {
    const out = baselineOutput(input, evHash, screen.flagged ? "FLAGGED" : "PASS", screen.reasons);
    if (active.key !== BASELINE_VERSION) {
      out.modelKey = active.key;
      out.provenance.modelKey = active.key;
      out.provenance.estimatorVersion = active.key;
    }
    return out;
  }

  // nothing registered (fresh DB) — the baseline formula still answers
  return baselineOutput(input, evHash, screen.flagged ? "FLAGGED" : "PASS", screen.reasons);
}

// Re-exported for the cycle: the baseline estimate on a bare price (A-03).
export { baselineEstimate };
