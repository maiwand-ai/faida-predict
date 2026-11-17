// Orders: GET recent paper orders; POST places a paper order through the
// full pipeline (eligibility -> risk -> machine -> fill -> ledger -> outbox).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { placePaperOrder } from "@/lib/engine/paper";
import { simulateLostSubmission } from "@/lib/engine/reconcile";

export const dynamic = "force-dynamic";

export async function GET() {
  const [orders, ledger] = await Promise.all([
    db.order.findMany({
      where: { mode: "PAPER" },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { market: { select: { question: true, venue: true } }, robot: { select: { name: true } } },
    }),
    db.ledgerEntry.findMany({ where: { mode: "PAPER" }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return NextResponse.json({ orders, ledger });
}

export async function POST(req: Request) {
  const user = await db.user.findUnique({ where: { email: "founder@faida.local" } });
  if (!user) return NextResponse.json({ error: "not seeded" }, { status: 503 });
  const body = (await req.json()) as {
    action?: "PLACE" | "SIMULATE_ACK_LOSS";
    marketId?: string;
    side?: "BUY_YES" | "BUY_NO";
    priceCents?: number;
    sizeCents?: number;
    robotId?: string | null;
    nonce?: string;
  };

  if (body.action === "SIMULATE_ACK_LOSS") {
    try {
      const orderId = await simulateLostSubmission(body.marketId ?? (await db.market.findFirstOrThrow().then((m) => m.id)));
      return NextResponse.json({ ok: true, orderId, simulated: "venue ack lost -> UNKNOWN (run reconciliation to resolve)" });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e instanceof Error ? e.message : e) }, { status: 400 });
    }
  }

  if (!body.marketId || !body.side || !body.priceCents || !body.sizeCents) {
    return NextResponse.json({ error: "marketId, side, priceCents, sizeCents required" }, { status: 400 });
  }
  const result = await placePaperOrder({
    userId: user.id,
    robotId: body.robotId ?? null,
    marketId: body.marketId,
    side: body.side,
    priceCents: body.priceCents,
    sizeCents: body.sizeCents,
    nonce: body.nonce ?? crypto.randomUUID(),
    trigger: "MANUAL",
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, stage: result.stage, reason: result.reason, details: result.details }, { status: 422 });
  }
  return NextResponse.json({ ...result, ok: true });
}
