// Cross-venue price gaps: the same event, priced differently on two venues.
// FAIDA reads Polymarket, Kalshi and Limitless at once, so it can see these.
//
// Pairing: open, priced markets on DIFFERENT real-money venues whose titles
// match closely (content words, numbers must agree) and whose close dates are
// within 14 days of each other when both are known. Manifold is excluded: its
// play money can't be combined with real money.
//
// For each pair we report:
//   gap        |YES_a − YES_b| in points (cents) — the disagreement
//   lockIn     the cheaper side combo: YES on one venue + NO on the other.
//              If both venues settle the event the same way, exactly one side
//              pays $1, so profit = 100 − (yes + no) − fees. NEVER guaranteed:
//              venues word and settle questions differently; the UI says so.
// Fees use each venue's recorded taker-fee snapshot (bps of notional).
import { db } from "@/lib/db";
import { similarity } from "@/lib/matching";

export const GAP_VENUES = ["POLYMARKET", "KALSHI", "LIMITLESS"];
const MIN_SIMILARITY = 0.55;
const MAX_CLOSE_DIFF_MS = 14 * 86_400_000;

export interface GapSide { id: string; venue: string; question: string; yesPriceCents: number; noPriceCents: number; closeDate: string | null; yesFeeBps: number | null; noFeeBps: number | null }
export interface PriceGap {
  key: string;
  a: GapSide;
  b: GapSide;
  match: number;
  gapPts: number;
  lockIn: { buyYesOn: string; buyNoOn: string; costCents: number; feesCents: number; profitCents: number } | null;
}

const fee = (priceCents: number, bps: number | null) => (bps ? (priceCents * bps) / 10_000 : 0);

export async function findPriceGaps(limit = 40): Promise<{ gaps: PriceGap[]; scanned: number }> {
  const rows = await db.market.findMany({
    where: { venue: { in: GAP_VENUES }, resolvedAt: null, ambiguityFlag: false, yesPriceCents: { not: null } },
    select: { id: true, venue: true, question: true, yesPriceCents: true, noPriceCents: true, closeDate: true, yesTakerFeeBps: true, noTakerFeeBps: true },
    take: 6000,
  });
  const side = (m: (typeof rows)[number]): GapSide => ({
    id: m.id, venue: m.venue, question: m.question,
    yesPriceCents: m.yesPriceCents!, noPriceCents: m.noPriceCents ?? 100 - m.yesPriceCents!,
    closeDate: m.closeDate?.toISOString() ?? null, yesFeeBps: m.yesTakerFeeBps, noFeeBps: m.noTakerFeeBps,
  });
  const gaps: PriceGap[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const x = rows[i];
      const y = rows[j];
      if (x.venue === y.venue) continue;
      if (x.closeDate && y.closeDate && Math.abs(x.closeDate.getTime() - y.closeDate.getTime()) > MAX_CLOSE_DIFF_MS) continue;
      const s = similarity(x.question, y.question);
      if (s < MIN_SIMILARITY) continue;
      const a = side(x);
      const b = side(y);
      // the two combos: YES on a + NO on b, or YES on b + NO on a
      const combos = [
        { yes: a, no: b },
        { yes: b, no: a },
      ].map(({ yes, no }) => {
        const cost = yes.yesPriceCents + no.noPriceCents;
        const fees = fee(yes.yesPriceCents, yes.yesFeeBps) + fee(no.noPriceCents, no.noFeeBps);
        return { buyYesOn: yes.venue, buyNoOn: no.venue, costCents: cost, feesCents: Math.round(fees * 100) / 100, profitCents: Math.round((100 - cost - fees) * 100) / 100 };
      });
      const bestCombo = combos.sort((p, q) => q.profitCents - p.profitCents)[0];
      gaps.push({
        key: `${a.id}:${b.id}`,
        a,
        b,
        match: Math.round(s * 100),
        gapPts: Math.abs(a.yesPriceCents - b.yesPriceCents),
        lockIn: bestCombo.profitCents > 0 ? bestCombo : null,
      });
    }
  }
  gaps.sort((p, q) => (q.lockIn?.profitCents ?? -1) - (p.lockIn?.profitCents ?? -1) || q.gapPts - p.gapPts);
  return { gaps: gaps.slice(0, limit), scanned: rows.length };
}
