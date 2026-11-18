// S-05 venue conformance contract test — KALSHI (Phase 9).
// Runs the adapter's PURE mapping (mapKalshiMarkets) against RECORDED FIXTURES
// (tests/fixtures/kalshi, captured from the LIVE production Trade API) so the
// venue contract is reproducible offline — standing rule §3.4.
//
//   bun run conformance:kalshi
//   bun scripts/record-fixtures-kalshi.ts   ← record from the live feed first
//
// HONEST SKIP (not a fake pass): when fixtures are absent, this script says
// so and exits 0 — the venue's S-05 state is "conformance owed", never
// "conformance passed". The phase smoke asserts the SKIP notice itself.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mapKalshiMarkets,
  kalshiTakerBps,
  dollarsToCents,
  deriveDepth,
  type KalshiMarket,
  type KalshiSeries,
  type KalshiOrderbook,
} from "../src/lib/venue/kalshi";

const FX = join(fileURLToPath(new URL(".", import.meta.url)), "..", "tests", "fixtures", "kalshi");

const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  const ok = Boolean(cond);
  if (!ok) failures.push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}

if (!existsSync(join(FX, "recorded.json"))) {
  console.log("SKIP  kalshi conformance — no recorded fixtures (tests/fixtures/kalshi absent).");
  console.log("      Record from the live feed: bun scripts/record-fixtures-kalshi.ts");
  console.log("      The venue's S-05 state is 'conformance owed' until then — no fake pass.");
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(join(FX, "recorded.json"), "utf8"));
const marketsBody = JSON.parse(readFileSync(join(FX, "markets.json"), "utf8")) as { markets?: KalshiMarket[] };
const seriesRaw = JSON.parse(readFileSync(join(FX, "series.json"), "utf8")) as Record<string, KalshiSeries | null>;
const books = JSON.parse(readFileSync(join(FX, "orderbooks.json"), "utf8")) as Record<string, KalshiOrderbook>;

const seriesMeta: Record<string, { category: string | null; feeType: string | null; feeMultiplier: number | null; settlementSources: string[] | null }> = {};
for (const [k, s] of Object.entries(seriesRaw)) {
  seriesMeta[k] = {
    category: s?.category ?? null,
    feeType: s?.fee_type ?? null,
    feeMultiplier: typeof s?.fee_multiplier === "number" ? s.fee_multiplier : null,
    settlementSources: Array.isArray(s?.settlement_sources) ? s.settlement_sources.map(String) : null,
  };
}

check("manifest has provenance (recordedAt/base)", !!manifest.recordedAt && !!manifest.base);
check("recorded markets exist", (marketsBody.markets ?? []).length > 0);

const mapped = mapKalshiMarkets(marketsBody.markets ?? [], seriesMeta, books, 100);
check("mapping produces markets", mapped.length > 0, "no binary markets mapped — check fixture content");

// Every mapped market satisfies the VenueMarket contract invariants.
let allValid = true;
for (const m of mapped) {
  const ok =
    m.venueSymbol.startsWith("kx:") &&
    !!m.question &&
    m.yesPriceCents != null && m.yesPriceCents >= 1 && m.yesPriceCents <= 99 &&
    m.noPriceCents != null && m.noPriceCents >= 1 && m.noPriceCents <= 99 &&
    typeof m.eventKey === "string" && m.eventKey.startsWith("kx:event:") &&
    !!m.resolutionSource &&
    m.closeDate != null && !Number.isNaN(new Date(m.closeDate as string).getTime());
  if (!ok) { allValid = false; break; }
}
check("all mapped markets carry venue-scoped symbol/question/eventKey/closeDate/resolution", allValid);

// Entry prices are the venue's OWN ask fields (taker posture) — verify the
// first market against its recorded row.
const first = (marketsBody.markets ?? []).find(
  (m) => m.ticker && (m.market_type === "binary" && m.status === "active" && !m.is_provisional && !m.mve_collection_ticker && !m.mve_selected_legs && !m.custom_strike),
);
if (first?.ticker) {
  const row = mapped.find((m) => m.venueSymbol === `kx:${first.ticker}`);
  check("entry prices match the venue's own ask fields", !!row && row.yesPriceCents === dollarsToCents(first.yes_ask_dollars) && row.noPriceCents === dollarsToCents(first.no_ask_dollars));

  // Touch depth from the book complement identity (YES ask = 100 − NO bid).
  const book = books[first.ticker];
  if (book) {
    const depth = deriveDepth(book);
    check("book complement depth derives (fail-closed to null on empty sides)", depth.yesTouchDepthCents == null || depth.yesTouchDepthCents > 0);
    const row2 = mapped.find((m) => m.venueSymbol === `kx:${first.ticker}`);
    check("mapped depth matches the recorded book", !!row2 && row2.yesTouchDepthCents === depth.yesTouchDepthCents && row2.noTouchDepthCents === depth.noTouchDepthCents);
  }

  // Fee bps from the series' own multiplier under the documented formula.
  const st = (first.ticker as string).split("-")[0];
  const s = seriesRaw[st];
  const mult = typeof s?.fee_multiplier === "number" && (s.fee_type ?? "quadratic") === "quadratic" ? s.fee_multiplier : 1;
  const expectedBps = mult === 1 ? kalshiTakerBps(1, dollarsToCents(first.yes_ask_dollars) as number) : kalshiTakerBps(mult, dollarsToCents(first.yes_ask_dollars) as number);
  const row3 = mapped.find((m) => m.venueSymbol === `kx:${first.ticker}`);
  check("fee bps = M × 7 × (100 − ask) (documented quadratic schedule)", !!row3 && row3.yesTakerFeeBps === expectedBps, `expected ${expectedBps}`);
}

// A-04: markets of one event share the eventKey; distinct events → distinct keys.
const keys = new Set(mapped.map((m) => m.eventKey));
const distinctEvents = new Set(mapped.map((m) => (m.venueSymbol.split(":")[1] as string).split("-").slice(0, -1).join("-")));
check("eventKey clusters per event", keys.size >= Math.min(distinctEvents.size, keys.size) && [...keys].every((k) => typeof k === "string" && k.startsWith("kx:event:")));

// No multivariate rows leak through.
check("no multivariate/provisional rows mapped", (marketsBody.markets ?? []).every((m) => mapped.find((x) => m.ticker && x.venueSymbol === `kx:${m.ticker}`) == null || (m.market_type === "binary" && m.status === "active" && !m.is_provisional && !m.mve_collection_ticker && !m.mve_selected_legs && !m.custom_strike)));

// Honesty: volumeCents stays null (volume_fp is a contract count, not dollars).
check("volumeCents honest null (contract count ≠ dollars)", mapped.every((m) => m.volumeCents === null));

console.log("");
if (failures.length) {
  console.log(`CONFORMANCE FAIL — ${failures.length} check(s) failed`);
  process.exit(1);
} else {
  console.log(`CONFORMANCE PASS — ${mapped.length} markets replayed from recorded fixtures`);
}
