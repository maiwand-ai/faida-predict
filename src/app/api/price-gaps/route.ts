// Cross-venue price gaps (read-only research; nothing is traded from here).
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { findPriceGaps } from "@/lib/priceGaps";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { gaps, scanned } = await findPriceGaps(40);
  return NextResponse.json({ gaps, scanned, generatedAt: new Date().toISOString() });
}
