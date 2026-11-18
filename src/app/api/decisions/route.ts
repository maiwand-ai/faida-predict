// Decision journal (read-only) — the acting user's robot decision traces with
// robot and market context, newest first. Optional ?robotId= and ?limit=
// (default 100, max 500). Mirrors the trace shape the dashboard returns.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = auth.ctx.user;
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(500, Math.max(1, parseInt(sp.get("limit") ?? "", 10) || 100));
  const robotId = sp.get("robotId");
  const traces = await db.decisionTrace.findMany({
    where: { robot: { userId: user.id }, ...(robotId ? { robotId } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      robot: { select: { id: true, name: true, venue: true } },
      market: { select: { id: true, question: true, venue: true, yesPriceCents: true, category: true } },
    },
  });
  return NextResponse.json({ traces });
}
