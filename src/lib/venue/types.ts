// C4.1 / S-05 — Venue adapter interface. Adding a venue = implementing this
// interface + one compliance-catalog row + one fee schedule. Nothing else changes.
export interface VenueMarket {
  venueSymbol: string;
  question: string;
  category: string;
  yesTokenId?: string;
  noTokenId?: string;
  yesPriceCents: number | null;
  noPriceCents: number | null;
  liquidityCents: number | null;
  volumeCents: number | null;
  closeDate?: string | null;
  resolutionSource?: string | null;
  // Phase 4 structural thin-liquidity data (LIMITLESS). Depth = USDC notional
  // at the touch (best ask for YES entry, best bid for NO entry); null when
  // the book was not captured — the entry gate fail-closes on null. Fee bps
  // per side come from the venue's documented taker fee regime at that price.
  yesTouchDepthCents?: number | null;
  noTouchDepthCents?: number | null;
  yesTakerFeeBps?: number | null;
  noTakerFeeBps?: number | null;
  // A-04 event clustering key (venue-prefixed): markets sharing a key are
  // related outcomes whose exposure stacks in the per-event risk check.
  eventKey?: string | null;
}

export interface VenueBookSnapshot {
  venueSymbol: string;
  bestYesCents: number | null;
  bestNoCents: number | null;
  ts: number;
}

export type OrderStateGuess = "FILLED" | "OPEN" | "CANCELLED" | "NOT_FOUND";

// Phase 7 (B10): the live order request as the venue-blind engine hands it to
// the adapter. Execution goes through the gated live path (src/lib/live/).
export interface LiveOrderRequest {
  userId: string;
  robotId: string;
  marketId: string;
  side: "BUY_YES" | "BUY_NO";
  priceCents: number;
  sizeCents: number;
  nonce: string;
  trigger?: "SCHEDULE_TICK" | "MARKET_EVENT" | "MANUAL";
}

export interface LiveOrderResult {
  ok: true;
  orderId: string;
  state: string;
  dryRun: boolean;
  venueOrderId: string | null;
  signedPayloadHash: string;
}

export interface LiveOrderRejection {
  ok: false;
  stage: "GATE" | "PILOT" | "BOOK" | "ELIGIBILITY" | "PLATFORM" | "SIGNING" | "SEND";
  reason: string;
  details?: unknown;
}

export type LiveOrderOutcome = LiveOrderResult | LiveOrderRejection;

export interface VenueAdapter {
  readonly venue: string;
  // Pull tradable markets (market data is public; no keys required).
  fetchMarkets(limit: number): Promise<VenueMarket[]>;
  // Best-effort read of venue state for one order (S-04 reconciliation input).
  queryOrderState(venueOrderId: string): Promise<{ state: OrderStateGuess; filledCents?: number } | null>;
  // Live order placement — Phase 7 (B10). POLYMARKET delegates to the gated
  // live path (consent + gates + pilot caps + self-custody signing + send
  // boundary). Every other venue throws: no live write exists.
  placeOrder(req: LiveOrderRequest): Promise<LiveOrderOutcome>;
}

// Compliance catalog row per venue (S-05). [VERIFY] items are counsel work.
export const COMPLIANCE_CATALOG = [
  {
    venue: "PAPER_BOOK",
    status: "SUPPORTED",
    notes: "Internal simulated venue — always allowed, never looks live (D-05).",
  },
  {
    venue: "POLYMARKET",
    status: "MARKET_DATA_ONLY",
    notes:
      "Live market data integrated. Order placement arrives with self-custody EIP-712 signing (Phase 7). Geo-restrictions per eligibility matrix [VERIFY].",
  },
  {
    venue: "MANIFOLD",
    status: "MARKET_DATA_ONLY",
    notes:
      "Play-money harness, live market data via public REST since Phase 3 (P3.1). Robots trade the paper book against Manifold probabilities; even play-money order placement stays disabled until the Phase 7 gates.",
  },
  {
    venue: "LIMITLESS",
    status: "MARKET_DATA_ONLY",
    notes:
      "LIVE market data via public REST since Phase 4 (P4.1): /markets/active + /markets/{slug}/orderbook (books best-effort, fail-closed on gaps). Structural thin-liquidity rules armed: min-touch-depth refusal, edge-after-fees (documented taker regimes: AMM flat 0.40%, CLOB COLLATERAL module 5%×(1−p) in USDC, legacy buy curve 3.00%→0.40%), per-market position cap. Order placement arrives with self-custody signing (Phase 7). Docs mark the orderbook endpoint X-API-Key-required but it answered 200 without a key on 2026-11-17 [VERIFY]. Geo-restrictions per eligibility matrix [VERIFY].",
  },
  {
    venue: "DRIFT_BET",
    status: "SUSPENDED",
    notes:
      "[VERIFY] executed 2026-11-18 BEFORE adapter work (S-05 §3.2) — venue is NOT landable: Drift Protocol suffered a ~$285M exploit on 2026-04-01 (TRM Labs/Lazarus attribution); drift.trade incident-recovery updates (Apr 16 / May 5 / Jun 3 / Oct 1, 2026) cover recovery and a protocol reboot contingent on two independent audits (Ottersec, Asymmetric) with no BET relaunch announced; drift.bet and bet.drift.trade were unreachable on 2026-11-18; third-party trackers list Drift BET offline since the exploit (Velocity rebrand). Adapter deliberately NOT built — S-05 contract tests cannot pass against a dead market. Awaits founder verdict: substitute venue for the freed #4 slot or hold until a relaunch is announced.",
  },
  {
    venue: "AZURO",
    status: "PLANNED",
    notes: "Fast-follow — EVM sports SDK + subgraph odds; eligibility matrix must cover sports event shapes.",
  },
  {
    venue: "KALSHI",
    status: "PLANNED",
    notes: "Fast-follow, last — CFTC-regulated US DCM; REST + RSA key auth (second credential kind) per §3.",
  },
] as const;
