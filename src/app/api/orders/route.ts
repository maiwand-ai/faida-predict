// Orders: GET recent paper orders (request-scoped — Phase 10: members see
// their own; the operator sees their own); POST places a paper order through
// the full pipeline (eligibility -> risk -> machine -> fill -> ledger -> outbox).
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getPauseState } from "@/lib/control";
import { closePaperPosition, placePaperOrder } from "@/lib/engine/paper";
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
    action?: "PLACE" | "SIMULATE_ACK_LOSS" | "CLOSE_POSITION";
    positionId?: string;
    marketId?: string;
    side?: "BUY_YES" | "BUY_NO";
    priceCents?: number;
    sizeCents?: number;
    robotId?: string | null;
    nonce?: string;
  };

  // Close one of the user's open paper positions at the current price
  // (robot or manual). The global pause blocks it like any other order.
  if (body.action === "CLOSE_POSITION") {
    if (!body.positionId) return NextResponse.json({ ok: false, error: "positionId required" }, { status: 400 });
    const pos = await db.position.findUnique({ where: { id: body.positionId }, include: { robot: { select: { userId: true, mode: true } } } });
    if (!pos || (pos.userId ?? pos.robot?.userId) !== user.id) return NextResponse.json({ ok: false, error: "position not found" }, { status: 404 });
    if (pos.robot?.mode === "LIVE_PILOT") return NextResponse.json({ ok: false, error: "live-pilot positions close through the live path" }, { status: 422 });
    const pause = await getPauseState();
    if (pause.paused) return NextResponse.json({ ok: false, error: `platform paused: ${pause.reason ?? "manual pause"}` }, { status: 422 });
    const res = await closePaperPosition({ positionId: pos.id, reason: "closed manually" });
    return res.ok
      ? NextResponse.json({ ok: true, state: "FILLED", orderId: res.orderId, proceedsCents: res.proceedsCents, pnlCents: res.pnlCents, feeCents: res.feeCents })
      : NextResponse.json({ ok: false, error: res.reason }, { status: 422 });
  }

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
