// P-08 — Platform metrics endpoint (read-only snapshot for the ops card).
import { NextResponse } from "next/server";
import { buildMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  const snap = await buildMetrics();
  return NextResponse.json({
    metrics: snap,
    note: "P-08 platform metrics — honest snapshot; null where the platform does not record a number (no invented precision)",
  });
}
