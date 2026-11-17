// A-01/A-03/A-07 — Probability & AI layer API (Phase 5).
// GET  → registry (baseline def, knobs, models with calibration) + AI
//        governance (spend, latency percentiles, cache) + optional per-robot
//        B10 edge-gate evidence (?robotId=...).
// POST → founder actions (B8: humans own activation): RECOMPUTE calibration,
//        PROMOTE / DEMOTE a model, CHECK_DEMOTION (drill path), CLEAR_CACHE,
//        SCREEN a text sample (A-06 demonstration/verification).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listRegistry, recomputeCalibration, promoteModel, demoteModel, checkDemotion } from "@/lib/probability/registry";
import { governanceView } from "@/lib/probability/governance";
import { edgeGateReport } from "@/lib/probability/edgeGate";
import { screenEvidence } from "@/lib/probability/screening";
import { setModelKnobs } from "@/lib/probability/baseline";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const robotId = searchParams.get("robotId");
  const [registry, governance] = await Promise.all([listRegistry(), governanceView()]);
  const gate = robotId ? await edgeGateReport(robotId) : null;
  return NextResponse.json({ ...registry, governance, edgeGate: gate });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    action?: string;
    modelKey?: string;
    reason?: string;
    text?: string;
    minSamples?: number;
    promotionMarginPct?: number;
    demotionTolerancePct?: number;
  };
  const action = body.action ?? "";

  if (action === "RECOMPUTE") {
    const res = await recomputeCalibration();
    return NextResponse.json({ ok: true, ...res });
  }

  if (action === "PROMOTE") {
    if (!body.modelKey) return NextResponse.json({ error: "modelKey required" }, { status: 400 });
    const res = await promoteModel(body.modelKey);
    return NextResponse.json({ ...res }, { status: res.ok ? 200 : 422 });
  }

  if (action === "DEMOTE") {
    if (!body.modelKey) return NextResponse.json({ error: "modelKey required" }, { status: 400 });
    const res = await demoteModel(body.modelKey, body.reason ?? "manual demotion from Settings");
    return NextResponse.json({ ...res }, { status: res.ok ? 200 : 422 });
  }

  if (action === "CHECK_DEMOTION") {
    const res = await checkDemotion();
    return NextResponse.json({ ok: true, ...res });
  }

  if (action === "CLEAR_CACHE") {
    const res = await db.aiCacheEntry.deleteMany({});
    return NextResponse.json({ ok: true, cleared: res.count });
  }

  if (action === "SCREEN") {
    if (!body.text) return NextResponse.json({ error: "text required" }, { status: 400 });
    const res = screenEvidence(body.text);
    return NextResponse.json({ ok: true, ...res });
  }

  if (action === "SET_KNOBS") {
    const knobs = await setModelKnobs({
      minSamples: body.minSamples !== undefined ? body.minSamples : undefined,
      promotionMarginPct: body.promotionMarginPct !== undefined ? body.promotionMarginPct : undefined,
      demotionTolerancePct: body.demotionTolerancePct !== undefined ? body.demotionTolerancePct : undefined,
    });
    return NextResponse.json({ ok: true, knobs });
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
}
