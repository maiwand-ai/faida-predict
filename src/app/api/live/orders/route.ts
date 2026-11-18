// Phase 7 — manual live ticket through the gated live path. Requires a
// LIVE_PILOT robot: the ticket is executed as that robot (gate, caps, book,
// signing, send boundary all apply — a manual ticket never bypasses a gate).
// Phase 10: session auth + ownership — a member may only ticket their OWN
// robot; the operator may ticket any.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { placeLiveOrder } from "@/lib/live/execute";
import { resolveAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = auth.ctx.user;
  const body = (await req.json().catch(() => ({}))) as {
    robotId?: string;
    marketId?: string;
    side?: "BUY_YES" | "BUY_NO";
    priceCents?: number;
    sizeCents?: number;
    nonce?: string;
  };
  if (!body.robotId || !body.marketId || !body.side || !body.priceCents || !body.sizeCents) {
    return NextResponse.json({ error: "robotId, marketId, side, priceCents, sizeCents required" }, { status: 400 });
  }
  const robot = await db.robot.findUnique({ where: { id: body.robotId }, select: { userId: true } });
  if (!robot) return NextResponse.json({ error: "robot not found" }, { status: 404 });
  if (user.role !== "OPERATOR" && robot.userId !== user.id) {
    return NextResponse.json({ error: "not your robot" }, { status: 403 });
  }
  const result = await placeLiveOrder({
    userId: user.id,
    robotId: body.robotId,
    marketId: body.marketId,
    side: body.side,
    priceCents: body.priceCents,
    sizeCents: body.sizeCents,
    nonce: body.nonce ?? crypto.randomUUID(),
    trigger: "MANUAL",
  });
  if (!result.ok) {
    return NextResponse.json({ ...result }, { status: 422 });
  }
  return NextResponse.json(result);
}
