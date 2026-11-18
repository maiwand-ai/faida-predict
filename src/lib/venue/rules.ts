// Phase 4 — structural venue entry rules (S-05, B9 Limitless contract).
// Thin liquidity is handled STRUCTURALLY, not as an afterthought: the entry
// rules a venue declares here are enforced by the shared risk engine
// (src/lib/risk.ts) and the cycle gate — no venue logic leaks into the engine;
// the engine just applies whatever the venue module declares (§3 standing rule).
//
// Limits are config, never hardcoded at call sites (C4.4 philosophy). They are
// founder-calibrated 2026-11-17 against measured Limitless books:
//   BTC daily book   — YES touch ≈ $536, NO touch ≈ $53   → trades
//   BTC hourly book  — YES touch ≈ $1.56, NO touch ≈ $24  → refuses
// so the daily markets pass while the recurring hourly markets are refused
// with a stated depth reason (that is the intended conservative behavior).

export interface VenueEntryRules {
  /**
   * (a) min-touch-depth refusal: entry refused when the USDC notional
   * available at the touch (best ask for YES, best bid for NO) is below this
   * minimum, or when the book was never captured (fail-closed). null = rule
   * not armed for this venue.
   */
  minTouchDepthCents: number | null;
  /**
   * (c) per-market position cap: total OPEN notional held by the user across
   * ALL robots on one market may not exceed this — thin books make exiting a
   * large position expensive, so the cap is market-wide, not per-robot.
   * null = rule not armed for this venue.
   */
  perMarketPositionCapCents: number | null;
  /**
   * (d) close-time window (Phase 8, sports shape — AZURO): entry refused
   * inside the final N minutes before the market's closeDate (game start).
   * Prematch sports odds inside the closing window are unstable and often
   * suspended — robots must not enter it. Fail-closed when closeDate is
   * missing on a venue that arms the rule. null = rule not armed.
   */
  minMinutesBeforeClose: number | null;
}

export const EMPTY_ENTRY_RULES: VenueEntryRules = {
  minTouchDepthCents: null,
  perMarketPositionCapCents: null,
  minMinutesBeforeClose: null,
};

export const VENUE_ENTRY_RULES: Record<string, VenueEntryRules> = {
  // Polymarket / Manifold: deep or play-money books — structural rules not
  // armed; the two-tier risk engine (B5/C10) still applies everywhere.
  POLYMARKET: EMPTY_ENTRY_RULES,
  MANIFOLD: EMPTY_ENTRY_RULES,
  // Limitless: thin crypto-native order book on Base — rules ARMED (§3).
  LIMITLESS: {
    minTouchDepthCents: 5000, // $50 — refuse entries the touch cannot absorb
    perMarketPositionCapCents: 50000, // $500 per market, user-wide across robots
    minMinutesBeforeClose: null, // rule (d) not armed — crypto markets close soft
  },
  // Fast-follow venues adopt rules when their adapters land (Phase 6 / 8 / 9).
  DRIFT_BET: EMPTY_ENTRY_RULES,
  // Azuro (sports, Phase 8): the feed exposes no book depth — rule (a) must
  // NOT arm (it would fail-close everything). Sports shape arms instead:
  // conservative per-market cap + a close-time window (odds inside the final
  // minutes before kickoff are unstable and often suspended). Config, not
  // code — recalibrate by editing this row only.
  AZURO: {
    minTouchDepthCents: null,
    perMarketPositionCapCents: 10000, // $100 per game condition, user-wide
    minMinutesBeforeClose: 20, // no entries inside the final 20 minutes
  },
  // Kalshi (Phase 9): CFTC-regulated exchange with real central limit order
  // books — rule (a) min-touch-depth IS armed (the founder-calibrated $50
  // Limitless number; fail-closed when the book was not captured at sync) and
  // a $500 per-market cap. No close-time window: a regulated exchange with
  // defined closes has no suspended-odds prematch window (contrast AZURO).
  // Config, not code — recalibrate by editing this row only.
  KALSHI: {
    minTouchDepthCents: 5000, // $50 at the touch (book complement notional)
    perMarketPositionCapCents: 50000, // $500 per market, user-wide across robots
    minMinutesBeforeClose: null,
  },
};

export function entryRulesFor(venue: string): VenueEntryRules {
  return VENUE_ENTRY_RULES[venue] ?? EMPTY_ENTRY_RULES;
}

// ── (b) edge-after-fees: venue taker fee curves ─────────────────────────────
// Sources: docs.limitless.exchange/user-guide/fees ([VERIFY]-checked
// 2026-11-17). Three documented regimes:
//   • AMM markets        — flat 0.40% taker fee
//   • CLOB, fee module COLLATERAL ("new trading venues") — fees paid in USDC
//     on both sides: 5% × (1 − price) of the trade's USDC value
//   • CLOB, legacy venue — buy fee curve paid in outcome tokens, 3.00% at low
//     prices easing to 0.40% near certainty (documented anchor points below)
// Makers pay nothing (limit orders free) — paper mode always enters as taker.
export const LIMITLESS_AMM_TAKER_BPS = 40;

/** New-venue USDC curve: 5% × (1 − price) → bps of notional. */
export function limitlessCollateralTakerBps(priceCents: number): number {
  const p = Math.min(100, Math.max(0, priceCents));
  return Math.round(500 * (100 - p) / 100);
}

/** Documented legacy buy-fee anchors [priceCents, bps] — piecewise-linear. */
export const LIMITLESS_LEGACY_BUY_CURVE: Array<[number, number]> = [
  [1, 300], [50, 300], [55, 252], [60, 213], [65, 180], [70, 151],
  [75, 126], [80, 105], [85, 85], [90, 68], [95, 53], [99, 42], [100, 40],
];

export function limitlessLegacyBuyTakerBps(priceCents: number): number {
  const p = Math.min(100, Math.max(1, priceCents));
  for (let i = 1; i < LIMITLESS_LEGACY_BUY_CURVE.length; i++) {
    const [lo, loBps] = LIMITLESS_LEGACY_BUY_CURVE[i - 1];
    const [hi, hiBps] = LIMITLESS_LEGACY_BUY_CURVE[i];
    if (p <= hi) {
      const t = p <= lo ? 0 : (p - lo) / (hi - lo);
      return Math.round(loBps + t * (hiBps - loBps));
    }
  }
  return 40;
}

export interface LimitlessFeeShape {
  tradeType: string | null; // "amm" | "clob" | "group"
  feeModuleType: string | null; // e.g. "COLLATERAL" on the current venue
}

/** Taker bps for one LIMITLESS entry at `priceCents` under the documented regimes. */
export function limitlessTakerBps(shape: LimitlessFeeShape, priceCents: number): number {
  if (shape.tradeType === "amm") return LIMITLESS_AMM_TAKER_BPS;
  if (shape.feeModuleType === "COLLATERAL") return limitlessCollateralTakerBps(priceCents);
  return limitlessLegacyBuyTakerBps(priceCents);
}

/**
 * Fee drag in probability POINTS for an entry at `priceCents` charging
 * `feeBps` of notional: breakeven moves from p to p×(1+fee), so the drag is
 * p × fee. This is what the edge gate subtracts before comparing to minEdgePts.
 * Example: 40¢ entry at 300 bps → 40 × 0.03 = 1.2 pts of required edge.
 */
export function feeDragPts(priceCents: number, feeBps: number): number {
  return (priceCents * feeBps) / 10000;
}
