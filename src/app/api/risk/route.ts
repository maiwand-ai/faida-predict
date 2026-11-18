// Risk config: GET effective two-tier view; PUT sets a user limit (clamped to
// the platform maximum — stricter-only, per B5/C10).
// Phase 10: request-scoped auth (session cookie; founder fallback outside
// strict mode) — members see and set only their own tier.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getEffectiveRisk, setUserRisk } from "@/lib/risk";
import { resolveAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = auth.ctx.user;
  const effective = await getEffectiveRisk(user.id);
  const rows = await db.riskConfig.findMany({
    where: { OR: [{ scope: "PLATFORM" }, { userId: user.id }] },
  });
  const platformMax: Record<string, number> = {};
  for (const r of rows) if (r.scope === "PLATFORM") platformMax[r.key] = r.valueNum;
  return NextResponse.json({ effective, platformMax, rows });
}

export async function PUT(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = auth.ctx.user;
  const body = (await req.json()) as { key?: string; value?: number };
  const VALID = ["DAILY_LOSS_STOP_PCT", "DRAWDOWN_STOP_PCT", "PER_EVENT_EXPOSURE_PCT", "AI_MONTHLY_BUDGET_CENTS"];
  if (!body.key || !VALID.includes(body.key) || typeof body.value !== "number") {
    return NextResponse.json({ error: `key must be one of ${VALID.join(", ")} and value must be numeric` }, { status: 400 });
  }
  const clamped = await setUserRisk(user.id, body.key, Math.floor(body.value));
  return NextResponse.json({ ok: true, key: body.key, appliedValue: clamped, note: "clamped to platform maximum if looser" });
}
