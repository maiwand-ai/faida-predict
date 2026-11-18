// Kalshi adapter — venue #6 (B9), Phase 9. The US-persons complement where
// Polymarket is venue-restricted: CFTC-regulated US DCM, USD, REST.
//
// CONTRACT SOURCE (S-05 [VERIFY] evidence, 2026-11-18 — checked against the
// official docs BEFORE adapter work, dated probes recorded in the compliance
// row, src/lib/venue/types.ts):
//
//   Production REST : https://external-api.kalshi.com/trade-api/v2
//                     (also served at https://api.elections.kalshi.com/trade-api/v2 —
//                      the shared host answers from the sandbox; used here)
//   GET  /markets?status=open&limit=N            → { markets: KalshiMarket[], cursor }
//   GET  /markets/{ticker}/orderbook?depth=N     → { orderbook_fp: { yes_dollars, no_dollars } }
//   GET  /series/{ticker}                        → { series: { fee_type, fee_multiplier, category, settlement_sources, ... } }
//
//   KalshiMarket (fields the adapter consumes):
//     ticker, event_ticker, title, market_type: "binary", status: "active",
//     yes_bid_dollars / yes_ask_dollars / no_bid_dollars / no_ask_dollars
//       (fixed-point dollar strings, "0.1200"),
//     volume_fp / open_interest_fp (contract counts as fixed-point strings),
//     close_time, rules_primary, rules_secondary, can_close_early
//
//   Orderbook: bids ONLY (binary complement): yes_dollars + no_dollars arrays
//   of [price_dollars, count_fp], ASCENDING — the best bid is the LAST element.
//   Documented complement: best YES ask = $1 − best NO bid; best NO ask =
//   $1 − best YES bid. Touch depth = contracts × price at that best level.
//
// Fees (documented general schedule + the venue's own series multiplier):
//   fees = round_up(M × 0.07 × C × P × (1−P))   — P in dollars, C contracts
//   (Kalshi fee schedule; series carry fee_type "quadratic" + fee_multiplier,
//   e.g. KXELONMARS answered { fee_type: "quadratic", fee_multiplier: 1 } on
//   2026-11-18). As bps of notional at entry price p: M × 7 × (100 − p) / 100.
//   Makers pay nothing on the general schedule — paper mode always enters as
//   taker (same posture as Limitless). Unknown fee_type → bps null (honest
//   unknown; the documented general multiplier is used only when the series
//   lookup itself fails, never below the venue's own 0-multiplier promos).
//
// Credential kind (carry-forward register, Phase 9): Kalshi auth is an
// asymmetric API key (RSA-PSS/SHA-256 or Ed25519 over
// "{timestamp}{METHOD}{path}") — a SECOND credential kind next to the EVM
// wallet signer. Implementation: src/lib/live/kalshiCustody.ts (env-injected,
// never stored — same posture as S-08), proven offline by
// scripts/kalshi_selftest.ts. The market-data path needs no credentials.
//
// Structural rules (src/lib/venue/rules.ts): Kalshi books are real central
// limit order books — rule (a) min-touch-depth IS armed ($50, the
// founder-calibrated Limitless number; fail-closed on missing books) and a
// $500 per-market cap; no close-time window (regulated exchange, defined
// closes, no suspended-odds window like prematch sports).
//
// Mapping scope (honest): BINARY active markets only. Multivariate events
// (mve_* fields, custom_strike combo legs, is_provisional rows) are excluded —
// multi-outcome positions need future engine work, recorded here as scope.
// The API's volume_fp is a CONTRACT count, not dollars — volumeCents stays
// null rather than inventing a conversion (D-03).
import type { VenueAdapter, VenueMarket, OrderStateGuess, LiveOrderRequest, LiveOrderOutcome } from "./types";

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const UA = "faida-predict/phase9 (paper market-data adapter)";
const CALL_SPACING_MS = 130; // unauthenticated requests have separate limits — back off on 429
const MAX_SERIES_LOOKUPS = 25;
const EVENT_PAGES = 3; // ≤600 open events scanned per sync
const MAX_EVENT_LOOKUPS = 45; // stratified events whose markets are fetched

// ── Wire shapes (subset the adapter consumes) ───────────────────────────────
export interface KalshiEvent {
  event_ticker?: string;
  series_ticker?: string;
  title?: string;
  category?: string;
  mutually_exclusive?: boolean;
}

export interface KalshiMarket {
  ticker?: string;
  event_ticker?: string;
  title?: string;
  market_type?: string; // "binary"
  status?: string; // "active"
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  volume_fp?: string;
  open_interest_fp?: string;
  close_time?: string;
  rules_primary?: string;
  can_close_early?: boolean;
  // multivariate markers — rows carrying any of these are excluded:
  mve_collection_ticker?: string;
  mve_selected_legs?: unknown[];
  custom_strike?: Record<string, unknown>;
  is_provisional?: boolean;
}

export interface KalshiOrderbook {
  orderbook_fp?: {
    yes_dollars?: Array<[string, string]>;
    no_dollars?: Array<[string, string]>;
  };
}

export interface KalshiSeries {
  ticker?: string;
  category?: string;
  fee_type?: string; // "quadratic"
  fee_multiplier?: number; // e.g. 1
  settlement_sources?: string[];
}

export interface KalshiSeriesMeta {
  category: string | null;
  feeType: string | null;
  feeMultiplier: number | null;
  settlementSources: string[] | null;
}

// ── Pure helpers (exported for the S-05 conformance harness) ────────────────

/** Fixed-point dollar string → cents (null when unusable). */
export function dollarsToCents(v: string | undefined | null): number | null {
  const n = parseFloat(String(v ?? ""));
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return Math.round(n * 100);
}

/** Fixed-point contract count → number (null when unusable/negative). */
export function fpContracts(v: string | undefined | null): number | null {
  const n = parseFloat(String(v ?? ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Documented Kalshi taker fee as bps of notional at entry price `priceCents`:
 * fee = M × 0.07 × C × p × (1−p), notional = C × p → bps = M × 700 × (1−p)
 * = M × 7 × (100 − p_cents). Multiplier 1 = the documented general schedule
 * (100 contracts at 50¢ → $1.75 fee on $50 notional → 350 bps). Never negative.
 */
export function kalshiTakerBps(feeMultiplier: number, priceCents: number): number {
  const p = Math.min(100, Math.max(0, priceCents));
  const m = Number.isFinite(feeMultiplier) && feeMultiplier >= 0 ? feeMultiplier : 1;
  return Math.round(7 * m * (100 - p));
}

/** Bids arrays are ascending — the best bid is the LAST level. */
export function bestBidLevel(book: KalshiOrderbook, side: "yes" | "no"): { priceCents: number; contracts: number } | null {
  const levels = side === "yes" ? book.orderbook_fp?.yes_dollars : book.orderbook_fp?.no_dollars;
  if (!levels || levels.length === 0) return null;
  const last = levels[levels.length - 1];
  const priceCents = dollarsToCents(last[0]);
  const contracts = fpContracts(last[1]);
  if (priceCents == null || priceCents < 1 || contracts == null) return null;
  return { priceCents, contracts };
}

export interface KalshiDepth {
  // USDC notional available at the touch: buying YES absorbs the NO bid
  // (YES ask = 100 − NO bid); buying NO absorbs the YES bid.
  yesTouchDepthCents: number | null;
  noTouchDepthCents: number | null;
  // Complement asks derived from the book's own bids (0 when the side is empty).
  bestYesAskCents: number | null;
  bestNoAskCents: number | null;
}

export function deriveDepth(book: KalshiOrderbook): KalshiDepth {
  const yesBid = bestBidLevel(book, "yes");
  const noBid = bestBidLevel(book, "no");
  return {
    // contracts × price¢ = notional¢ at the touch
    yesTouchDepthCents: noBid ? Math.round(noBid.contracts * noBid.priceCents) : null,
    noTouchDepthCents: yesBid ? Math.round(yesBid.contracts * yesBid.priceCents) : null,
    bestYesAskCents: noBid ? 100 - noBid.priceCents : null,
    bestNoAskCents: yesBid ? 100 - yesBid.priceCents : null,
  };
}

/**
 * Is this market mappable? Binary, active, not multivariate/provisional,
 * two-sided ask prices in 1..99¢, complement-consistent (yes_ask + no_bid ≈ 100
 * after cent rounding — the documented binary identity).
 */
export function isMappableKalshiMarket(m: KalshiMarket): boolean {
  if (m.market_type !== "binary") return false;
  if (m.status !== "active") return false;
  if (m.is_provisional === true) return false;
  if (m.mve_collection_ticker || m.mve_selected_legs || m.custom_strike) return false;
  if (!m.ticker || !m.title || !m.event_ticker) return false;
  const yesAsk = dollarsToCents(m.yes_ask_dollars);
  const noAsk = dollarsToCents(m.no_ask_dollars);
  const yesBid = dollarsToCents(m.yes_bid_dollars);
  const noBid = dollarsToCents(m.no_bid_dollars);
  if (yesAsk == null || noAsk == null || yesBid == null || noBid == null) return false;
  if (yesAsk < 1 || yesAsk > 99 || noAsk < 1 || noAsk > 99) return false;
  if (yesBid < 0 || yesBid > 99 || noBid < 0 || noBid > 99) return false;
  if (Math.abs(yesAsk + noBid - 100) > 1) return false; // complement sanity (rounding-safe)
  if (Math.abs(noAsk + yesBid - 100) > 1) return false;
  return true;
}

/**
 * PURE mapping — markets + series metadata + books → VenueMarket rows.
 * Exported for the S-05 conformance harness (replays recorded fixtures
 * offline). Entry prices are the venue's own ASK fields (taker posture);
 * depth comes from the book's complement identity.
 */
export function mapKalshiMarkets(
  markets: KalshiMarket[],
  seriesMeta: Record<string, KalshiSeriesMeta>,
  books: Record<string, KalshiOrderbook>,
  limit = 30,
): VenueMarket[] {
  const rows = markets
    .filter(isMappableKalshiMarket)
    .sort((a, b) => (fpContracts(b.volume_fp) ?? 0) - (fpContracts(a.volume_fp) ?? 0))
    .slice(0, limit);

  const out: VenueMarket[] = [];
  for (const m of rows) {
    const ticker = m.ticker as string;
    const seriesTicker = seriesCandidate(ticker);
    const meta = seriesMeta[seriesTicker];
    const yesAsk = dollarsToCents(m.yes_ask_dollars) as number;
    const noAsk = dollarsToCents(m.no_ask_dollars) as number;

    // Fee: the venue's own series multiplier under the documented quadratic
    // schedule. Series lookup failed → the documented GENERAL schedule (M=1).
    // An explicitly-unknown fee_type regime → null (honest unknown — no fee
    // charged, the edge gate sees raw prices). A venue 0-multiplier promo
    // yields 0 bps (the venue's own number, never a made-up discount).
    const feeType = meta?.feeType ?? null;
    const feeFor = (price: number): number | null => {
      if (meta == null) return kalshiTakerBps(1, price); // general documented schedule
      if (feeType != null && feeType !== "quadratic") return null; // unknown regime
      return kalshiTakerBps(meta.feeMultiplier ?? 1, price);
    };
    const yesFeeBps = feeFor(yesAsk);
    const noFeeBps = feeFor(noAsk);

    const book = books[ticker];
    const depth = book ? deriveDepth(book) : null;

    const rules = (m.rules_primary ?? "").trim();
    const settlement = meta?.settlementSources?.length ? meta.settlementSources.join(", ") : "";
    const resolutionSource = [
      rules || "Rules published on the contract page (kalshi.com)",
      settlement ? `settlement: ${settlement}` : "",
      meta?.category ? `category: ${meta.category}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    out.push({
      venueSymbol: `kx:${ticker}`,
      question: m.title as string,
      category: (meta?.category ?? "kalshi").toLowerCase(),
      yesPriceCents: yesAsk,
      noPriceCents: noAsk,
      liquidityCents: null, // touch depth is the structural measure — see below
      volumeCents: null, // volume_fp is a CONTRACT count, not dollars — honest null (D-03)
      closeDate: m.close_time ?? null,
      resolutionSource,
      yesTouchDepthCents: depth?.yesTouchDepthCents ?? null,
      noTouchDepthCents: depth?.noTouchDepthCents ?? null,
      yesTakerFeeBps: yesFeeBps,
      noTakerFeeBps: noFeeBps,
      // A-04: every market under one Kalshi event stacks as related exposure
      // (mutually-exclusive candidate sets are one economic bet).
      eventKey: `kx:event:${m.event_ticker}`,
    });
  }
  return out;
}

/** Series-ticker candidate from a market ticker ("<SERIES>-<rest>"). */
export function seriesCandidate(ticker: string): string {
  return ticker.split("-")[0] ?? ticker;
}

/**
 * PURE — evenly-spaced sample across the event list so one sync covers the
 * whole open-event space (elections, sports, econ, weather, long-dated),
 * not just whichever page the newest rows land on.
 */
export function stratifiedSampleEvents(events: KalshiEvent[], count: number): KalshiEvent[] {
  const usable = events.filter((e) => !!e.event_ticker);
  if (usable.length <= count) return usable;
  const step = usable.length / count;
  const out: KalshiEvent[] = [];
  for (let i = 0; i < count; i++) {
    const ev = usable[Math.min(usable.length - 1, Math.floor(i * step))];
    if (ev && !out.includes(ev)) out.push(ev);
  }
  return out;
}

/**
 * PURE — from raw per-event market rows: keep the mappable ones, rank by the
 * venue's own contract volume (SELECTION only — never reported as dollars),
 * slice to `limit`.
 */
export function selectKalshiTargets(rows: KalshiMarket[], limit: number): KalshiMarket[] {
  return rows
    .filter(isMappableKalshiMarket)
    .sort((a, b) => (fpContracts(b.volume_fp) ?? 0) - (fpContracts(a.volume_fp) ?? 0))
    .slice(0, limit);
}

// ── Adapter ─────────────────────────────────────────────────────────────────
export class KalshiAdapter implements VenueAdapter {
  readonly venue = "KALSHI";

  private async fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: { "user-agent": UA, accept: "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429) {
      // one honest back-off retry — unauthenticated limits are separate
      await new Promise((r) => setTimeout(r, 1200));
      const retry = await fetch(url, {
        ...init,
        headers: { "user-agent": UA, accept: "application/json", ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!retry.ok) throw new Error(`kalshi api ${retry.status} after 429 backoff (${new URL(url).pathname})`);
      return (await retry.json()) as T;
    }
    if (!res.ok) throw new Error(`kalshi api ${res.status} (${new URL(url).pathname})`);
    return (await res.json()) as T;
  }

  async fetchMarkets(limit = 30): Promise<VenueMarket[]> {
    // 1) Open events (the events endpoint EXCLUDES multivariate events — the
    //    newest-1000 /markets page is dominated by auto-generated MVE combo
    //    legs with no books, observed 2026-11-18). Paginate ≤3 pages, then
    //    take a stratified sample across the whole list so the sync covers
    //    every category (elections, sports, econ, weather, long-dated).
    const events: KalshiEvent[] = [];
    let cursor = "";
    for (let page = 0; page < EVENT_PAGES && page < 3; page++) {
      const body = await this.fetchJson<{ events?: KalshiEvent[]; cursor?: string }>(
        `${KALSHI_BASE}/events?status=open&limit=200&with_sub_markets=false${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      events.push(...(body.events ?? []));
      cursor = body.cursor ?? "";
      if (!cursor) break;
    }
    const sampled = stratifiedSampleEvents(events, MAX_EVENT_LOOKUPS);

    // 2) Markets per sampled event (paced) — the event_ticker filter returns
    //    every matching market in one response (documented).
    const rows: KalshiMarket[] = [];
    for (const ev of sampled) {
      await new Promise((r) => setTimeout(r, CALL_SPACING_MS));
      try {
        const body = await this.fetchJson<{ markets?: KalshiMarket[] }>(
          `${KALSHI_BASE}/markets?event_ticker=${encodeURIComponent(ev.event_ticker ?? "")}`,
        );
        rows.push(...(body.markets ?? []));
      } catch {
        // one event failing must not block the sync
      }
    }
    const targets = selectKalshiTargets(rows, limit);
    if (!targets.length) return [];

    // 3) Series metadata (fee multiplier + category + settlement sources) for
    //    the DISTINCT series of the targets — the venue's own numbers, paced.
    const seriesTickers = [...new Set(targets.map((m) => seriesCandidate(m.ticker as string)))].slice(
      0,
      MAX_SERIES_LOOKUPS,
    );
    const seriesMeta: Record<string, KalshiSeriesMeta> = {};
    for (const st of seriesTickers) {
      await new Promise((r) => setTimeout(r, CALL_SPACING_MS));
      try {
        const body = await this.fetchJson<{ series?: KalshiSeries }>(`${KALSHI_BASE}/series/${st}`);
        const s = body.series ?? {};
        if (s.ticker && s.ticker !== st) continue; // convention mismatch — leave meta absent (general schedule)
        seriesMeta[st] = {
          category: s.category ?? null,
          feeType: s.fee_type ?? null,
          feeMultiplier: typeof s.fee_multiplier === "number" ? s.fee_multiplier : null,
          settlementSources: Array.isArray(s.settlement_sources) ? s.settlement_sources.map(String) : null,
        };
      } catch {
        // series lookup failure → meta absent → documented general schedule
      }
    }

    // 4) Books best-effort (touch depth), paced — fail-closed on gaps: depth
    //    stays null and the armed min-touch rule refuses entry with the
    //    stated reason (same posture as Limitless).
    const books: Record<string, KalshiOrderbook> = {};
    for (const m of targets) {
      await new Promise((r) => setTimeout(r, CALL_SPACING_MS));
      try {
        books[m.ticker as string] = await this.fetchJson<KalshiOrderbook>(
          `${KALSHI_BASE}/markets/${m.ticker}/orderbook`,
        );
      } catch {
        // absent book entry → depth null → fail-closed depth rule
      }
    }

    return mapKalshiMarkets(targets, seriesMeta, books, limit);
  }

  // Paper venue orders are resolvable locally; the Kalshi write path does not
  // exist (no live orders until the Phase 7 gates + founder authorization —
  // and the write path would use the RSA/Ed25519 credential kind, not a
  // wallet). The honest answer for reconciliation inputs is NOT_FOUND.
  async queryOrderState(_venueOrderId: string): Promise<{ state: OrderStateGuess } | null> {
    return { state: "NOT_FOUND" };
  }

  async placeOrder(_req: LiveOrderRequest): Promise<LiveOrderOutcome> {
    // Hard block by design (B10): only POLYMARKET carries a live write path,
    // and even that is behind the DRY-RUN send armor until the founder arms.
    throw new Error("LIVE_TRADING_DISABLED: Kalshi write path does not exist; paper mode only");
  }
}

export const kalshi = new KalshiAdapter();
