// Market detail (read-only) — one market with its recorded price history
// (MarketPriceTick, as captured by venue syncs and robot cycles), the acting
// user's robot decisions / orders / positions on it, and related markets
// (same A-04 event cluster first, then same category on the same venue).
// Nothing here is synthesized: an empty history stays empty.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const num = (v: bigint | null) => (v != null ? Number(v) : null);

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = auth.ctx.user;
  const { id } = await ctx.params;

  const market = await db.market.findUnique({ where: { id } });
  if (!market) return NextResponse.json({ error: "market not found" }, { status: 404 });

  const [ticks, traces, orders, positions, sameEvent] = await Promise.all([
    db.marketPriceTick.findMany({ where: { marketId: id }, orderBy: { capturedAt: "desc" }, take: 1000 }),
    db.decisionTrace.findMany({
      where: { marketId: id, robot: { userId: user.id } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { robot: { select: { id: true, name: true } } },
    }),
    db.order.findMany({
      where: { marketId: id, userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { robot: { select: { name: true } } },
    }),
    db.position.findMany({
      where: { marketId: id, OR: [{ robot: { userId: user.id } }, { userId: user.id }] },
      orderBy: { openedAt: "desc" },
      take: 50,
      include: { robot: { select: { id: true, name: true } } },
    }),
    market.eventKey
      ? db.market.findMany({ where: { eventKey: market.eventKey, id: { not: id }, resolvedAt: null }, take: 8 })
      : Promise.resolve([]),
  ]);
  const sameCategory =
    sameEvent.length < 6
      ? await db.market.findMany({
          where: { venue: market.venue, category: market.category, id: { notIn: [id, ...sameEvent.map((m) => m.id)] }, resolvedAt: null },
          orderBy: { volumeCents: "desc" },
          take: 6 - sameEvent.length,
        })
      : [];

  const plain = <T extends { volumeCents: bigint | null; liquidityCents: bigint | null }>(m: T) => ({
    ...m,
    volumeCents: num(m.volumeCents),
    liquidityCents: num(m.liquidityCents),
  });

  return NextResponse.json({
    market: plain(market),
    ticks: ticks.reverse().map((t) => ({ yesCents: t.yesCents, noCents: t.noCents, source: t.source, capturedAt: t.capturedAt })),
    traces,
    orders,
    positions,
    related: [...sameEvent.map((m) => ({ ...plain(m), relation: "SAME_EVENT" })), ...sameCategory.map((m) => ({ ...plain(m), relation: "SAME_CATEGORY" }))],
  });
}
