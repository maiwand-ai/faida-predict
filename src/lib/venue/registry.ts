// Adapter registry — the engine stays venue-blind; it asks this map for the
// module that owns a venue's market data. Adding a venue = one adapter module
// + one entry here + one compliance row + one venues.ts row (S-05 contract).
// AZURO's adapter module exists (Phase 8) but the venue stays PENDING in
// venues.ts — the sync API refuses non-LIVE venues BEFORE reaching this map,
// so the module is inert until the registry flip (owed after recorded
// conformance fixtures, see src/lib/venue/azuro.ts header).
// KALSHI flipped LIVE in Phase 9: the API answers from the sandbox, so S-05
// conformance fixtures were RECORDED from the live feed (unlike Azuro) —
// see scripts/record-fixtures-kalshi.ts + tests/fixtures/kalshi.
import type { VenueAdapter } from "./types";
import { polymarket } from "./polymarket";
import { manifold } from "./manifold";
import { limitless } from "./limitless";
import { azuro } from "./azuro";
import { kalshi } from "./kalshi";

const ADAPTERS: Record<string, VenueAdapter> = {
  POLYMARKET: polymarket,
  MANIFOLD: manifold,
  LIMITLESS: limitless,
  AZURO: azuro,
  KALSHI: kalshi,
};

export function getVenueAdapter(venue: string): VenueAdapter | null {
  return ADAPTERS[venue] ?? null;
}

export function adapterVenues(): string[] {
  return Object.keys(ADAPTERS);
}
