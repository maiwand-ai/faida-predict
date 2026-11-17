// Phase 7 — manual live ticket through the gated live path. Requires a
// LIVE_PILOT robot: the ticket is executed as that robot (gate, caps, book,
// signing, send boundary all apply — a manual ticket never bypasses a gate).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { placeLiveOrder } from "@/lib/live/execute";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await db.user.findUnique({ where: { email: "founder@faida.local" } });
  if (!user) return NextResponse.json({ error: "not seeded" }, { status: 503 });
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
