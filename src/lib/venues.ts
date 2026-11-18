// Venue registry — single source of truth for which prediction markets
// FAIDA Predict can reach. Robot.venue references these ids.
//
// Founder-ratified lineup (B9):
//   1. POLYMARKET — primary. CLOB, REST + WebSocket, USDC on Polygon,
//      API-only — market makers run bots there today. Where robots earn.
//   2. MANIFOLD  — free harness from week one. Play money, public API,
//      bots encouraged; Polymarket-shaped enough to exercise the whole
//      pipeline so new robots prove themselves before the edge gate.
//      Market-data adapter LIVE since Phase 3 (P3.1).
//   3. LIMITLESS — fast-follow, LIVE since Phase 4 (P4.1). Crypto-native
//      order book on Base, public REST. Thinner liquidity is handled
//      structurally (min-touch-depth refusal + edge-after-fees + per-market
//      cap) — thin books make robots conservative, not broken.
//   4. DRIFT_BET — SUSPENDED 2026-11-18 ([VERIFY] before adapter work): the
//      April 1, 2026 Drift exploit ($285M) took the protocol into a full
//      reboot; BET has been offline since and no relaunch is announced.
//      Adapter deliberately NOT built — a dead market cannot pass S-05.
//   5. AZURO     — fast-follow. EVM, sports-leaning, SDK-first.
//   6. KALSHI    — fast-follow, LIVE since Phase 9 (P9.1). CFTC-regulated US
//      exchange, public REST market data; key-based auth (RSA/Ed25519) is the
//      platform's SECOND credential kind (wallet ≠ API key); the US-persons
//      complement to the non-US crypto venues.
//
// A venue may only be selected for a robot or receive orders once its adapter
// is LIVE here — the robots API enforces this at creation time (B11).
//
// Color identity (B12): every venue carries its own accent hex. The UI uses it
// on the venue card, the venue workspace interior, venue badges and venue-
// scoped sections, so the user always sees which market they entered. Pending
// venues keep their hue, muted (the UI grays it toward slate until the adapter
// ships).

export interface VenueDef {
  id: string;
  label: string;
  /** LIVE = adapter implemented; PENDING = on the roadmap, adapter not built yet. */
  adapter: "LIVE" | "PENDING";
  /** Why the venue is in the lineup — drives the UI badges. */
  role: "PRIMARY" | "HARNESS" | "FAST_FOLLOW";
  short: string;
  /** B12 color identity — distinct accent per venue, used across the whole UI. */
  hex: string;
  note: string;
}

export const VENUES: VenueDef[] = [
  {
    id: "POLYMARKET",
    label: "Polymarket",
    adapter: "LIVE",
    role: "PRIMARY",
    short: "PM",
    hex: "#3E8EFF", // electric blue — the primary market
    note: "Primary venue — CLOB REST + WebSocket, USDC on Polygon, API-only; where robots earn (B2)",
  },
  {
    id: "MANIFOLD",
    label: "Manifold",
    adapter: "LIVE",
    role: "HARNESS",
    short: "MF",
    hex: "#14D9C4", // turquoise — play-money harness, fresh and low-stakes
    note: "Week-one harness, LIVE since Phase 3 — play money, public API; zero-risk environment where new robots prove the full pipeline before the edge gate (B9)",
  },
  {
    id: "LIMITLESS",
    label: "Limitless",
    adapter: "LIVE",
    role: "FAST_FOLLOW",
    short: "LX",
    hex: "#F26BC8", // magenta — crypto-native Base order book
    note: "Fast-follow → LIVE since Phase 4 — Base CLOB order book, public REST; thin liquidity handled structurally (min-touch-depth refusal, edge-after-fees, per-market cap) (B9)",
  },
  {
    id: "DRIFT_BET",
    label: "Drift BET",
    adapter: "PENDING",
    role: "FAST_FOLLOW",
    short: "DB",
    hex: "#C6F542", // lime — Solana energy
    note: "SUSPENDED [VERIFY 2026-11-18] — offline since the April 2026 Drift exploit ($285M, protocol reboot pending two audits); adapter deliberately not built, a dead market cannot pass S-05 — slot #4 substitution awaits founder ratification (B9)",
  },
  {
    id: "AZURO",
    label: "Azuro",
    adapter: "PENDING",
    role: "FAST_FOLLOW",
    short: "AZ",
    hex: "#B18CFF", // lavender — EVM sports
    note: "Phase 8 — adapter IMPLEMENTED against the SDK-verified V3 contract, venue stays PENDING: Azuro feed hosts are unreachable from the sandbox (origin-level 404, dated evidence in the S-05 compliance row), conformance fixtures cannot be recorded here; flip owed after `record-fixtures-azuro` + `conformance:azuro` pass from an unblocked vantage (B9/S-05)",
  },
  {
    id: "KALSHI",
    label: "Kalshi",
    adapter: "LIVE",
    role: "FAST_FOLLOW",
    short: "KX",
    hex: "#FFB25C", // soft orange — regulated US exchange
    note: "Fast-follow → LIVE since Phase 9 — CFTC-regulated US exchange, public REST market data (S-05 fixtures recorded from the live feed); the US-persons complement where Polymarket is venue-restricted; key-based auth (RSA/Ed25519) as the platform's second credential kind (B9)",
  },
];

export const VENUE_IDS = VENUES.map((v) => v.id);
export const LIVE_VENUE_IDS = VENUES.filter((v) => v.adapter === "LIVE").map((v) => v.id);
export const VENUE_LABEL: Record<string, string> = Object.fromEntries(VENUES.map((v) => [v.id, v.label]));
/** B12 — venue accent hex by id; unknown venues fall back to the platform accent. */
export const VENUE_COLOR: Record<string, string> = Object.fromEntries(VENUES.map((v) => [v.id, v.hex]));
export function venueColor(id: string): string {
  return VENUE_COLOR[id] ?? "#3E9BF0";
}

export const ROLE_LABEL: Record<VenueDef["role"], string> = {
  PRIMARY: "PRIMARY",
  HARNESS: "HARNESS — WEEK ONE",
  FAST_FOLLOW: "FAST-FOLLOW",
};

export function isVenue(id: string): boolean {
  return VENUE_IDS.includes(id);
}

export function isLiveVenue(id: string): boolean {
  return LIVE_VENUE_IDS.includes(id);
}
