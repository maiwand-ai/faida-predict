// Venue market sync (P3.1), shared by POST /api/markets and the scheduled
// tick (/api/cron/tick). Upserts the venue's live markets, records price
// ticks for the busiest ones (A-05 recorder) and flags markets without a
// tradeable two-sided book (D-04). Behavior is unchanged from the original
// route handler; it only moved here so a scheduler can call it.
import { db } from "@/lib/db";
import { getVenueAdapter } from "@/lib/venue/registry";
import { isLiveVenue } from "@/lib/venues";
import { recordTick } from "@/lib/engine/cycle";

export type SyncResult = { venue: string; synced: number; totalMarkets: number; errors: string | null; source: string };

export async function syncVenueMarkets(venue: string): Promise<SyncResult> {
  if (!isLiveVenue(venue)) return { venue, synced: 0, totalMarkets: 0, errors: "no live adapter", source: "UNAVAILABLE" };
  const adapter = getVenueAdapter(venue);
  if (!adapter) return { venue, synced: 0, totalMarkets: 0, errors: "adapter module missing", source: "UNAVAILABLE" };
  let fetched = 0;
  let errors: string | null = null;
  try {
    const live = await adapter.fetchMarkets(30);
    fetched = live.length;
    for (const m of live) {
      // D-04 honesty: a market is tradeable only with a complete two-sided
      // book (1..99¢ both sides). The flag is SET here for degenerate rows
      // and CLEARED for healthy ones — a venue that recovers its book
      // becomes tradeable again instead of staying ambiguous forever.
      const healthy =
        m.yesPriceCents != null && m.noPriceCents != null &&
        m.yesPriceCents >= 1 && m.yesPriceCents <= 99 &&
        m.noPriceCents >= 1 && m.noPriceCents <= 99;
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
          // Phase 4 structural data: touch depth, per-side taker fee bps
          // (fee schedule is config — snapshot from the venue's regime) and
          // the A-04 event-cluster key.
          yesTouchDepthCents: m.yesTouchDepthCents ?? null,
          noTouchDepthCents: m.noTouchDepthCents ?? null,
          yesTakerFeeBps: m.yesTakerFeeBps ?? null,
          noTakerFeeBps: m.noTakerFeeBps ?? null,
          eventKey: m.eventKey ?? null,
          venue,
          dataSource: `${venue}_LIVE`,
          ambiguityFlag: !healthy,
        },
        create: {
          venue,
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
          yesTouchDepthCents: m.yesTouchDepthCents ?? null,
          noTouchDepthCents: m.noTouchDepthCents ?? null,
          yesTakerFeeBps: m.yesTakerFeeBps ?? null,
          noTakerFeeBps: m.noTakerFeeBps ?? null,
          eventKey: m.eventKey ?? null,
          ambiguityFlag: !healthy,
          dataSource: `${venue}_LIVE`,
        },
      });
    }
    // A-05 recorder: persist this sync's observations as ticks (top 12 by volume
    // keeps the table bounded while giving backtests real live history).
    const tickTargets = live
      .filter((m) => m.yesPriceCents != null && m.noPriceCents != null)
      .sort((a, b) => (b.volumeCents ?? 0) - (a.volumeCents ?? 0))
      .slice(0, 12);
    for (const m of tickTargets) {
      const row = await db.market.findUnique({ where: { venueSymbol: m.venueSymbol }, select: { id: true } });
      if (row) await recordTick(row.id, m.yesPriceCents as number, m.noPriceCents as number, `${venue}_SYNC`);
    }
    // D-04 honesty: markets without a complete, tradeable two-sided book
    // (missing or degenerate 0¢/100¢ prices) are flagged and refuse orders.
    await db.market.updateMany({
      where: {
        venue,
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
  const count = await db.market.count({ where: { resolvedAt: null, venue } });
  return { venue, synced: fetched, totalMarkets: count, errors, source: fetched > 0 ? `${venue}_LIVE` : "UNAVAILABLE" };
}
