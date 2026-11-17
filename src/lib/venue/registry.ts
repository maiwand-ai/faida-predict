// Adapter registry — the engine stays venue-blind; it asks this map for the
// module that owns a venue's market data. Adding a venue = one adapter module
// + one entry here + one compliance row + one venues.ts row (S-05 contract).
import type { VenueAdapter } from "./types";
import { polymarket } from "./polymarket";
import { manifold } from "./manifold";
import { limitless } from "./limitless";

const ADAPTERS: Record<string, VenueAdapter> = {
  POLYMARKET: polymarket,
  MANIFOLD: manifold,
  LIMITLESS: limitless,
};

export function getVenueAdapter(venue: string): VenueAdapter | null {
  return ADAPTERS[venue] ?? null;
}

export function adapterVenues(): string[] {
  return Object.keys(ADAPTERS);
}
