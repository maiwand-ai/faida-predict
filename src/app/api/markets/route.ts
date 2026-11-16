// Market data: GET = cached list from DB; POST = sync live from Polymarket Gamma.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { polymarket } from "@/lib/venue/polymarket";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.market.findMany({
    where: { resolvedAt: null },
    orderBy: { volumeCents: "desc" },
    take: 40,
  });
  // BigInt columns -> plain numbers for JSON (all realistic values < 2^53)
  const markets = rows.map((m) => ({
    ...m,
    volumeCents: m.volumeCents != null ? Number(m.volumeCents) : null,
    liquidityCents: m.liquidityCents != null ? Number(m.liquidityCents) : null,
  }));
  return NextResponse.json({ markets, compliance: "POLYMARKET: MARKET_DATA_ONLY (S-05)" });
}

export async function POST() {
  let fetched = 0;
  let errors: string | null = null;
  try {
    const live = await polymarket.fetchMarkets(30);
    fetched = live.length;
    for (const m of live) {
      await db.market.upsert({
        where: { venueSymbol: m.venueSymbol },
        update: {
          question: m.question,
          yesPriceCents: m.yesPriceCents,
          noPriceCents: m.noPriceCents,
          liquidityCents: m.liquidityCents != null ? BigInt(m.liquidityCents) : null,
          volumeCents: m.volumeCents != null ? BigInt(m.volumeCents) : null,
          closeDate: m.closeDate ? new Date(m.closeDate) : null,
          yesTokenId: m.yesTokenId ?? null,
          noTokenId: m.noTokenId ?? null,
          dataSource: "GAMMA_LIVE",
        },
        create: {
          venueSymbol: m.venueSymbol,
          question: m.question,
          category: m.category,
          yesTokenId: m.yesTokenId ?? null,
          noTokenId: m.noTokenId ?? null,
          yesPriceCents: m.yesPriceCents,
          noPriceCents: m.noPriceCents,
          liquidityCents: m.liquidityCents != null ? BigInt(m.liquidityCents) : null,
          volumeCents: m.volumeCents != null ? BigInt(m.volumeCents) : null,
          closeDate: m.closeDate ? new Date(m.closeDate) : null,
          resolutionSource: m.resolutionSource ?? null,
          dataSource: "GAMMA_LIVE",
        },
      });
    }
    // D-04 honesty: markets without a complete, tradeable two-sided book
    // (missing or degenerate 0¢/100¢ prices) are flagged and refuse orders.
    await db.market.updateMany({
      where: {
        OR: [
          { yesPriceCents: null },
          { noPriceCents: null },
          { yesPriceCents: { lte: 0 } },
          { noPriceCents: { lte: 0 } },
          { yesPriceCents: { gte: 100 } },
          { noPriceCents: { gte: 100 } },
        ],
      },
      data: { ambiguityFlag: true },
    });
  } catch (e) {
    errors = String(e instanceof Error ? e.message : e);
  }
  const count = await db.market.count({ where: { resolvedAt: null } });
  return NextResponse.json({ synced: fetched, totalMarkets: count, errors, source: fetched > 0 ? "GAMMA_LIVE" : "UNAVAILABLE" });
}
