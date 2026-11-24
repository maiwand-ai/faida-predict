// Market data: GET = cached list from DB (all venues); POST = sync live from
// the adapter for the requested venue (P3.1). Every successful sync appends
// MarketPriceTicks (A-05 recorder, <VENUE>_SYNC source).
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getVenueAdapter } from "@/lib/venue/registry";
import { isLiveVenue, VENUE_IDS, VENUE_LABEL } from "@/lib/venues";
import { syncVenueMarkets } from "@/lib/sync";
import { resolveOperator } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.market.findMany({
    where: { resolvedAt: null },
    orderBy: { volumeCents: "desc" },
    take: 120,
  });
  // 24h price move from recorded ticks: the oldest YES tick inside the last
  // 24 hours vs the current price (null when no tick exists in that window)
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const ticks = rows.length
    ? await db.marketPriceTick.findMany({
        where: { marketId: { in: rows.map((m) => m.id) }, capturedAt: { gte: since } },
        orderBy: { capturedAt: "asc" },
        select: { marketId: true, yesCents: true },
      })
    : [];
  const firstTick = new Map<string, number>();
  for (const t of ticks) if (!firstTick.has(t.marketId)) firstTick.set(t.marketId, t.yesCents);
  // BigInt columns -> plain numbers for JSON (all realistic values < 2^53)
  const markets = rows.map((m) => ({
    ...m,
    volumeCents: m.volumeCents != null ? Number(m.volumeCents) : null,
    liquidityCents: m.liquidityCents != null ? Number(m.liquidityCents) : null,
    change24hCents: m.yesPriceCents != null && firstTick.has(m.id) ? m.yesPriceCents - (firstTick.get(m.id) as number) : null,
  }));
  return NextResponse.json({ markets, compliance: "per-venue details in src/lib/venue/types.ts" });
}

export async function POST(req: NextRequest) {
  // Phase 10: OPERATOR-ONLY — platform-level mutation.
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as { venue?: string };
  const venue = (body.venue ?? "POLYMARKET").toUpperCase();

  if (!isLiveVenue(venue)) {
    return NextResponse.json(
      {
        error: `no live market-data adapter for "${venue}"`,
        hint: VENUE_LABEL[venue]
          ? `${VENUE_LABEL[venue]} is coming soon`
          : `unknown venue — registry: ${VENUE_IDS.join(", ")}`,
      },
      { status: 400 },
    );
  }
  const adapter = getVenueAdapter(venue);
  if (!adapter) {
    return NextResponse.json({ error: `adapter module missing for ${venue}` }, { status: 500 });
  }

  const result = await syncVenueMarkets(venue);
  return NextResponse.json(result);
}

