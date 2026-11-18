// P-08 — Platform metrics endpoint (read-only snapshot for the ops card).
// Phase 10: OPERATOR-ONLY (platform-wide counts are an operator view).
import { NextResponse, type NextRequest } from "next/server";
import { buildMetrics } from "@/lib/metrics";
import { resolveOperator } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const snap = await buildMetrics();
  return NextResponse.json({
    metrics: snap,
    note: "P-08 platform metrics — honest snapshot; null where the platform does not record a number (no invented precision)",
  });
}
