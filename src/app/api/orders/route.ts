// Orders: GET recent paper orders (request-scoped — Phase 10: members see
// their own; the operator sees their own); POST places a paper order through
// the full pipeline (eligibility -> risk -> machine -> fill -> ledger -> outbox).
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { placePaperOrder } from "@/lib/engine/paper";
import { simulateLostSubmission } from "@/lib/engine/reconcile";
import { resolveAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = auth.ctx.user;
  // optional ?limit= (read-only, capped) for history views; defaults unchanged
  const lim = Math.min(1000, Math.max(0, parseInt(req.nextUrl.searchParams.get("limit") ?? "", 10) || 0));
  const [orders, ledger] = await Promise.all([
    db.order.findMany({
      where: { mode: "PAPER", userId: user.id },
      orderBy: { createdAt: "desc" },
      take: lim || 40,
      include: { market: { select: { question: true, venue: true } }, robot: { select: { name: true } } },
    }),
    db.ledgerEntry.findMany({ where: { mode: "PAPER", userId: user.id }, orderBy: { createdAt: "desc" }, take: lim || 30 }),
  ]);
  return NextResponse.json({ orders, ledger });
}

export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = auth.ctx.user;
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
