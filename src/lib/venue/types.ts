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
    status: "VERIFY_BLOCKED",
    notes:
      "[VERIFY] executed 2026-11-18 BEFORE adapter work (S-05 §3.2). Protocol ALIVE: azuro.org reachable, docs (gem.azuro.org) active, official @azuro-org/toolkit v7.2.0 (npm, 2026-10-10) pins the V3 feed contract — adapter IMPLEMENTED against it (src/lib/venue/azuro.ts: REST api.onchainfeed.org/api/v1/public market-manager, environments PolygonUSDT/BaseWETH, GameState Prematch, ConditionState Active, margin embedded in odds, binary conditions only). BUT every Azuro feed host (api.onchainfeed.org, dev-api.onchainfeed.org, preprod-api.azuro.org, api.azuro.org, streams.onchainfeed.org) returns origin-level 404 for ALL paths from the sandbox, and thegraph.onchainfeed.org does not resolve — across HTTP versions/methods/headers, while Gamma/Manifold/Limitless/CLOB all answer from the same vantage. Conformance fixtures CANNOT be recorded here → venue stays PENDING, robot creation refused 422 (Drift precedent applied proportionately: no self-approved flip). UNBLOCK: from the founder host (or any unblocked vantage) run `bun scripts/record-fixtures-azuro.ts` then `bun run conformance:azuro`; pass flips the registry. Sports-shape structural rules ARMED in rules.ts (rule (d) close-time window 20 min + $100 per-market cap); eligibility matrix must cover sports categories [VERIFY with counsel].",
  },
  {
    venue: "KALSHI",
    status: "MARKET_DATA_ONLY",
    notes:
      "[VERIFY] executed 2026-11-18 BEFORE adapter work (S-05 §3.2), all from the sandbox: trade-api/v2 markets 200 with live data 04:50:46Z (970 ms), events + market + orderbook + series endpoints 200 with full field sets 04:52:15–30Z (api.elections.kalshi.com — the documented external-api host's shared alias; legacy trade-api.kalshi.com does not resolve), docs.kalshi.com 200 (markdown contract index). Contract verified against official docs: market data UNAUTHENTICATED; trading auth = asymmetric API key (RSA-PSS/SHA-256 or Ed25519 over '{timestamp}{METHOD}{path}', headers KALSHI-ACCESS-KEY/-TIMESTAMP/-SIGNATURE) — the platform's SECOND credential kind, env-injected per process, never stored (src/lib/live/kalshiCustody.ts, proven offline by scripts/kalshi_selftest.ts). Orderbook returns BIDS ONLY — asks derive from the binary complement (YES ask = 1 − NO bid); fees = round_up(M × 0.07 × C × P × (1−P)) with the series' own fee_multiplier (quadratic schedule; general M=1). LIVE market data since Phase 9 (P9.1): binary active non-multivariate markets, entry prices = the venue's own ask fields, touch depth from book complement, fee bps from the series multiplier. Robots trade the full paper pipeline; the Kalshi write path does not exist (B10 gates + founder arm would govern it). CFTC-regulated US DCM — US persons eligible where Polymarket is venue-restricted; geo matrix rows still need counsel sign-off [VERIFY]. Multivariate (combo) markets excluded — multi-outcome positions are recorded scope.",
  },
] as const;
