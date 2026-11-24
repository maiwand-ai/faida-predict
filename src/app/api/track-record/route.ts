// Track record (the signed-in user's robots) + AI accuracy (platform models).
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { modelAccuracy, robotRecords, MIN_RESOLVED_FOR_VERDICT } from "@/lib/trackRecord";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const [robots, accuracy] = await Promise.all([robotRecords(auth.ctx.user.id), modelAccuracy()]);
  return NextResponse.json({ robots, accuracy, minResolvedForVerdict: MIN_RESOLVED_FOR_VERDICT, generatedAt: new Date().toISOString() });
}
