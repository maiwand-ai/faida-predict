// Manifold adapter — week-one play-money harness (B9, Phase 3 P3.1).
// Public REST API, no keys, read-only. Manifold is play money, so the whole
// pipeline (sync -> decision -> paper fill -> ledger -> trace) can be proven
// end to end with zero financial risk before the edge gate exists.
// Verified against https://api.manifold.markets/v0/markets (2026-11):
//   sort ∈ created-time | updated-time | last-bet-time | last-comment-time
//   binary rows carry: probability (0..1), totalLiquidity, volume,
//   volume24Hours, closeTime (epoch ms), isResolved, slug, question.
import type { VenueAdapter, VenueMarket, OrderStateGuess } from "./types";

const MANIFOLD_BASE = "https://api.manifold.markets/v0";

interface ManifoldMarket {
  id?: string;
  slug?: string;
  question?: string;
  outcomeType?: string; // BINARY | MULTIPLE_CHOICE | MULTI_NUMERIC | DATE | PSEUDO_NUMERIC | PERP
  probability?: number; // BINARY only, 0..1
  totalLiquidity?: number;
  volume?: number;
  volume24Hours?: number;
  closeTime?: number;
  isResolved?: boolean;
  mechanism?: string;
  textDescription?: string;
}

function toCentsFromMana(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100); // Mana treated like dollars — display-scale only
}

export class ManifoldAdapter implements VenueAdapter {
  readonly venue = "MANIFOLD";

  /**
   * Pull tradable markets: BINARY only (two-sided book is what the paper
   * engine prices), unresolved, non-degenerate probability. Manifold's API
   * has no liquidity sort, so we take the recently-traded batch and rank by
   * 24h volume — the closest honest proxy for "active markets".
   */
  async fetchMarkets(limit = 30): Promise<VenueMarket[]> {
    const url = `${MANIFOLD_BASE}/markets?limit=500&sort=last-bet-time`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`manifold api ${res.status}`);
    const raw = (await res.json()) as ManifoldMarket[];
    const candidates = raw
      .filter(
        (m) =>
          m.outcomeType === "BINARY" &&
          !m.isResolved &&
          typeof m.probability === "number" &&
          m.probability > 0.01 &&
          m.probability < 0.99 &&
          !!m.slug &&
          !!m.question,
      )
      .sort((a, b) => (b.volume24Hours ?? 0) - (a.volume24Hours ?? 0));

    const out: VenueMarket[] = [];
    for (const m of candidates) {
      const yes = Math.round((m.probability as number) * 100);
      out.push({
        venueSymbol: String(m.slug),
        question: String(m.question),
        category: "manifold",
        yesPriceCents: Math.max(1, Math.min(99, yes)),
        noPriceCents: Math.max(1, Math.min(99, 100 - yes)),
        liquidityCents: toCentsFromMana(m.totalLiquidity),
        volumeCents: toCentsFromMana(m.volume),
        closeDate: m.closeTime ? new Date(m.closeTime).toISOString() : null,
        resolutionSource: m.textDescription ? String(m.textDescription).slice(0, 400) : null,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  // Paper venue orders are resolvable locally; Manifold order placement
  // (play-money Mana bets) is a deliberate non-goal while PAPER_ONLY holds.
  async queryOrderState(_venueOrderId: string): Promise<{ state: OrderStateGuess } | null> {
    return { state: "NOT_FOUND" };
  }

  async placeOrder(_req: import("./types").LiveOrderRequest): Promise<import("./types").LiveOrderOutcome> {
    // Hard block by design (B10): live execution — even play money — is out
    // of scope until the Phase 7 gates and explicit authorization.
    throw new Error("LIVE_TRADING_DISABLED: Manifold is play money; practice only");
  }
}

export const manifold = new ManifoldAdapter();
