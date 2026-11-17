// Polymarket adapter — LIVE MARKET DATA ONLY in the skeleton.
// Public Gamma API, no keys, read-only. Order placement comes in Phase 7.
import type { VenueAdapter, VenueMarket, OrderStateGuess } from "./types";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

interface GammaMarket {
  id?: string | number;
  slug?: string;
  question?: string;
  title?: string;
  category?: string;
  outcomes?: string; // JSON-encoded array in gamma responses
  outcomePrices?: string; // JSON-encoded array of strings "0.34"
  clobTokenIds?: string; // JSON-encoded array
  liquidityNum?: number;
  liquidity?: string;
  volumeNum?: number;
  volume?: string;
  endDate?: string;
  closed?: boolean;
  active?: boolean;
  description?: string;
  // A-04 event clustering (Phase 4): Gamma embeds the parent event(s) —
  // markets under one event (NegRisk candidate sets, game cards) share a key.
  events?: Array<{ slug?: string; title?: string }>;
}

function parseMaybeJson(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toCents(price: unknown): number | null {
  const n = typeof price === "number" ? price : parseFloat(String(price));
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return null;
  return Math.round(n * 100);
}

function toCentsFromDollars(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export class PolymarketAdapter implements VenueAdapter {
  readonly venue = "POLYMARKET";

  async fetchMarkets(limit = 24): Promise<VenueMarket[]> {
    const url = `${GAMMA_BASE}/markets?closed=false&active=true&limit=${limit * 2}&order=volume24hr&ascending=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`gamma api ${res.status}`);
    const raw = (await res.json()) as GammaMarket[];
    const out: VenueMarket[] = [];
    for (const m of raw) {
      const outcomes = parseMaybeJson(m.outcomes).map(String);
      const prices = parseMaybeJson(m.outcomePrices);
      const tokens = parseMaybeJson(m.clobTokenIds).map(String);
      const yesIdx = outcomes.findIndex((o) => o.toUpperCase() === "YES");
      const noIdx = outcomes.findIndex((o) => o.toUpperCase() === "NO");
      let yesPrice = yesIdx >= 0 ? toCents(prices[yesIdx]) : null;
      let noPrice = noIdx >= 0 ? toCents(prices[noIdx]) : null;
      let yesToken = tokens[yesIdx] ?? tokens[0];
      let noToken = tokens[noIdx] ?? tokens[1];
      if (yesPrice == null && noPrice == null && outcomes.length === 2 && prices.length === 2) {
        // Team-named binary (sports game cards, Phase 4): "Chargers"/"Ravens"
        // carry one price per outcome — map outcome 0 to the YES side and
        // outcome 1 to NO so game-card markets (moneyline, spreads, totals
        // under one event) become tradeable two-sided books and A-04
        // cluster members instead of permanently-ambiguous dead inventory.
        yesPrice = toCents(prices[0]);
        noPrice = toCents(prices[1]);
        yesToken = tokens[0];
        noToken = tokens[1];
      }
      const symbol = String(m.slug ?? m.id ?? "");
      if (!symbol || !m.question && !m.title) continue;
      out.push({
        venueSymbol: symbol,
        question: String(m.question ?? m.title ?? symbol),
        category: String(m.category ?? "unknown").toLowerCase(),
        yesTokenId: yesToken,
        noTokenId: noToken,
        yesPriceCents: yesPrice,
        noPriceCents: noPrice,
        liquidityCents: toCentsFromDollars(m.liquidityNum ?? m.liquidity),
        volumeCents: toCentsFromDollars(m.volumeNum ?? m.volume),
        closeDate: m.endDate ?? null,
        resolutionSource: m.description ? String(m.description).slice(0, 400) : null,
        eventKey: m.events?.[0]?.slug ? `pm:event:${m.events[0].slug}` : null,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  // Paper venue orders are always resolvable locally; live queries arrive in
  // Phase 7 against the CLOB API. Returning NOT_FOUND is the honest answer.
  async queryOrderState(venueOrderId: string): Promise<{ state: OrderStateGuess } | null> {
    if (venueOrderId.startsWith("paper_")) return { state: "NOT_FOUND" };
    return { state: "NOT_FOUND" };
  }

  async placeOrder(): Promise<never> {
    // Hard block, by design: live execution requires Phase 7 gates + explicit
    // user authorization + signed wallet integration. The skeleton is honest.
    throw new Error("LIVE_TRADING_DISABLED: Phase 7 gates not passed; paper mode only");
  }
}

export const polymarket = new PolymarketAdapter();
