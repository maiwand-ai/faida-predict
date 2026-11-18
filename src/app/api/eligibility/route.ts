// Eligibility matrix (C4.5): GET the matrix; PUT flips a country.
// Sanction-list rows can never be flipped to allowed.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveOperator } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const rules = await db.eligibilityRule.findMany({ orderBy: { country: "asc" } });
  return NextResponse.json({ rules });
}

export async function PUT(req: NextRequest) {
  // Phase 10: OPERATOR-ONLY — the C4.5 matrix is platform policy.
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json()) as { country?: string; allowed?: boolean; reason?: string };
  if (!body.country || typeof body.allowed !== "boolean") {
    return NextResponse.json({ error: "country and allowed are required" }, { status: 400 });
  }
  const rule = await db.eligibilityRule.findUnique({ where: { country: body.country } });
  if (!rule) return NextResponse.json({ error: "country not in matrix" }, { status: 404 });
  if (rule.source === "SANCTION_LIST" && body.allowed) {
    return NextResponse.json(
      { error: "sanctioned jurisdictions can never be allowed — this is a hard platform invariant" },
      { status: 403 },
    );
  }
  const updated = await db.eligibilityRule.update({
    where: { country: body.country },
    data: { allowed: body.allowed, reason: body.reason ?? rule.reason },
  });
  return NextResponse.json({ ok: true, rule: updated });
}
