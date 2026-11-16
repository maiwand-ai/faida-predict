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
}

export interface VenueBookSnapshot {
  venueSymbol: string;
  bestYesCents: number | null;
  bestNoCents: number | null;
  ts: number;
}

export type OrderStateGuess = "FILLED" | "OPEN" | "CANCELLED" | "NOT_FOUND";

export interface VenueAdapter {
  readonly venue: string;
  // Pull tradable markets (market data is public; no keys required).
  fetchMarkets(limit: number): Promise<VenueMarket[]>;
  // Best-effort read of venue state for one order (S-04 reconciliation input).
  queryOrderState(venueOrderId: string): Promise<{ state: OrderStateGuess; filledCents?: number } | null>;
  // Live order placement arrives in Phase 7 with wallet signing; the skeleton
  // implements the paper venue only. This method throws by contract.
  placeOrder(): Promise<never>;
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
    status: "PLANNED_TEST_HARNESS",
    notes: "Play-money harness for pre-edge-gate robot proving (A-03 baseline data).",
  },
  {
    venue: "LIMITLESS",
    status: "PLANNED",
    notes: "Second live venue — adapter module only; no core changes expected.",
  },
] as const;
