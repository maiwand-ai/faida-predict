// Limitless adapter — venue #3 (B9), LIVE market data since Phase 4.
// Base-network CLOB order book, USDC collateral, public REST (no keys for
// market data). https://api.limitless.exchange — [VERIFY]-checked against
// docs.limitless.exchange on 2026-11-17.
//
// Verified live behavior (2026-11-17):
//   GET /markets/active?page=1&limit=25&sortBy=high_value   (limit caps at 25)
//     → { data: [{ slug, title, description, prices: [yes, no] as 0..1
//        fractions summing to 1, categories, status: "FUNDED", expired,
//        expirationTimestamp, volume (raw 6-dec string), liquidity,
//        tradeType: "amm"|"clob"|"group", marketType, groupId,
//        venue: { feeModuleType }, metadata: { eventId, ... } }] }
//   GET /markets/{slug}/orderbook
//     → { bids: [{ price 0..1, size raw 6-dec (1e6 = 1 share), side }],
//         asks: [...], midpoint, adjustedMidpoint, minSize, tokenId }
//     The YES-side book only — NO-side liquidity is converted by the venue.
//     Docs mark this endpoint X-API-Key-required, but it answered 200 without
//     a key on 2026-11-17; the adapter treats it as best-effort and FAILS
//     CLOSED (depth null → entry refused) when a book cannot be fetched.
//   Rate limits: parallel bursts return 403 — books are fetched sequentially
//     with spacing + UA header + one backoff retry.
//
// Structural thin-liquidity rules (§3, enforced via src/lib/venue/rules.ts):
//   (a) touch depth captured per side at sync; entry refused below the
//       configured minimum (fail-closed when missing),
//   (b) per-side taker fee bps computed from the documented fee regimes and
//       stored on the market — the edge gate and paper fills consume them,
//   (c) per-market position cap declared in the rules module.
import type { VenueAdapter, VenueMarket, OrderStateGuess } from "./types";
import { limitlessTakerBps } from "./rules";

const LIMITLESS_BASE = "https://api.limitless.exchange";
const UA = "faida-predict/phase4 (paper market-data adapter)";
const BOOK_SPACING_MS = 180; // stay under the burst rate limit
const BOOK_CONCURRENCY = 2;

interface LimitlessMarket {
  id?: number;
  slug?: string;
  title?: string;
  description?: string;
  prices?: number[]; // [yes, no] as 0..1 fractions, sums to 1
  categories?: string[];
  status?: string; // FUNDED | ...
  expired?: boolean;
  hidden?: boolean;
  expirationTimestamp?: number;
  volume?: string; // raw 6-decimal USDC
  liquidity?: string; // raw 6-decimal USDC
  tradeType?: string; // amm | clob | group
  marketType?: string; // single | group
  groupId?: number | null;
  venue?: { feeModuleType?: string | null } | null;
  metadata?: Record<string, unknown> | null;
}

interface LimitlessBook {
  bids?: Array<{ price: number; size: number; side: string }>;
  asks?: Array<{ price: number; size: number; side: string }>;
  midpoint?: number;
}

function raw6ToCents(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n / 10); // raw 6-dec USDC → dollars → cents (÷1e6, ×100)
}

export class LimitlessAdapter implements VenueAdapter {
  readonly venue = "LIMITLESS";

  private async fetchJson<T>(url: string, timeoutMs = 15000): Promise<T> {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`limitless api ${res.status}`);
    return (await res.json()) as T;
  }

  /**
   * Book fetch with polite pacing. Returns null on any failure — the risk
   * gate fail-closes on null depth, so a flaky book never trades blind.
   */
  private async fetchBook(slug: string): Promise<LimitlessBook | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.fetchJson<LimitlessBook>(
          `${LIMITLESS_BASE}/markets/${encodeURIComponent(slug)}/orderbook`,
        );
      } catch {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 900)); // backoff once
      }
    }
    return null;
  }

  private deriveEventKey(m: LimitlessMarket): string | null {
    if (m.groupId != null) return `lx:group:${m.groupId}`;
    const eventId = m.metadata && typeof m.metadata.eventId === "string" ? m.metadata.eventId : null;
    return eventId ? `lx:event:${eventId}` : null;
  }

  async fetchMarkets(limit = 30): Promise<VenueMarket[]> {
    // Paginate /markets/active (25/page cap) — most valuable first.
    const pages = Math.max(1, Math.ceil(limit / 25));
    const candidates: LimitlessMarket[] = [];
    for (let page = 1; page <= pages; page++) {
      const body = await this.fetchJson<{ data?: LimitlessMarket[] }>(
        `${LIMITLESS_BASE}/markets/active?page=${page}&limit=25&sortBy=high_value`,
      );
      const rows = body.data ?? [];
      candidates.push(...rows);
      if (rows.length < 25) break;
    }

    const tradable = candidates.filter(
      (m) =>
        !!m.slug &&
        !!m.title &&
        m.status === "FUNDED" &&
        m.expired !== true &&
        m.hidden !== true &&
        Array.isArray(m.prices) &&
        m.prices.length >= 2 &&
        typeof m.prices[0] === "number" &&
        m.prices[0] > 0.005 &&
        m.prices[0] < 0.995,
    );

    // Books are fetched with bounded concurrency + spacing; per-market failure
    // is non-fatal (depth/fees stay null → fail-closed at the entry gate).
    const books = new Map<string, LimitlessBook | null>();
    let cursor = 0;
    const worker = async () => {
      while (cursor < tradable.length) {
        const m = tradable[cursor++];
        const slug = String(m.slug);
        books.set(slug, await this.fetchBook(slug));
        await new Promise((r) => setTimeout(r, BOOK_SPACING_MS));
      }
    };
    await Promise.all(Array.from({ length: Math.min(BOOK_CONCURRENCY, tradable.length) }, worker));

    const out: VenueMarket[] = [];
    for (const m of tradable) {
      const slug = String(m.slug);
      const yesRaw = m.prices![0];
      const yes = Math.max(1, Math.min(99, Math.round(yesRaw * 100)));
      const no = 100 - yes; // venue prices sum to 1 — keep exact parity

      // Touch depth in USDC cents: YES entry consumes the best ask; NO entry
      // consumes the best bid's complement side (size × (1 − bid price)).
      const book = books.get(slug) ?? null;
      const bestAsk = book?.asks?.[0];
      const bestBid = book?.bids?.[0];
      const yesTouchDepthCents =
        bestAsk && Number.isFinite(bestAsk.price) && Number.isFinite(bestAsk.size)
          ? Math.round((bestAsk.size / 1e6) * bestAsk.price * 100)
          : null;
      const noTouchDepthCents =
        bestBid && Number.isFinite(bestBid.price) && Number.isFinite(bestBid.size)
          ? Math.round((bestBid.size / 1e6) * (1 - bestBid.price) * 100)
          : null;

      // (b) edge-after-fees: per-side taker bps from the documented regimes.
      const feeShape = {
        tradeType: m.tradeType ?? null,
        feeModuleType: m.venue?.feeModuleType ?? null,
      };
      const yesTakerFeeBps = limitlessTakerBps(feeShape, yes);
      const noTakerFeeBps = limitlessTakerBps(feeShape, no);

      out.push({
        venueSymbol: slug,
        question: String(m.title),
        category: (m.categories?.[0] ?? "limitless").toLowerCase(),
        yesPriceCents: yes,
        noPriceCents: no,
        liquidityCents: raw6ToCents(m.liquidity),
        volumeCents: raw6ToCents(m.volume),
        closeDate:
          m.expirationTimestamp != null ? new Date(m.expirationTimestamp).toISOString() : null,
        resolutionSource: m.description ? String(m.description).slice(0, 400) : null,
        yesTouchDepthCents,
        noTouchDepthCents,
        yesTakerFeeBps,
        noTakerFeeBps,
        eventKey: this.deriveEventKey(m),
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  // Paper venue orders are resolvable locally; the CLOB write path arrives in
  // Phase 7 (wallet custody, B1). Returning NOT_FOUND is the honest answer.
  async queryOrderState(_venueOrderId: string): Promise<{ state: OrderStateGuess } | null> {
    return { state: "NOT_FOUND" };
  }

  async placeOrder(): Promise<never> {
    // Hard block by design (B10): live execution is out of scope until the
    // Phase 7 gates and explicit authorization.
    throw new Error("LIVE_TRADING_DISABLED: Phase 7 gates not passed; paper mode only");
  }
}

export const limitless = new LimitlessAdapter();
