// S-05 venue conformance contract test — LIMITLESS (Phase 4, P4.3).
// Runs the adapter against RECORDED FIXTURES (tests/fixtures/limitless) so the
// venue contract is reproducible offline: identical assertions on every run,
// no live-API flakiness. Standing rule §3.4: "Venue conformance contract
// tests (S-05) run against a recorded fixture."
//
//   bun run conformance
//   bun scripts/record-fixtures-limitless.ts   ← re-record from the live API
//
// Every expectation is DERIVED from the fixtures + their provenance manifest
// (recorded.json) — nothing hardcodes a slug, price or fee that market rolls
// would invalidate. The documented fee-regime anchors below are constants of
// the fee PAGE (docs.limitless.exchange/user-guide/fees), not of any market.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FX = join(fileURLToPath(new URL(".", import.meta.url)), "..", "tests", "fixtures", "limitless");
const fx = (name: string) => JSON.parse(readFileSync(join(FX, name), "utf8"));

const page1 = fx("markets-active-page1.json");
const page2 = fx("markets-active-page2.json");
const manifest = fx("recorded.json");
const liquidSlug = String(manifest.liquidSlug);
const thinSlug = String(manifest.thinSlug);
const MIN_TOUCH = Number(manifest.minTouchDepthCents); // 5000 — matches rules.ts
const books: Record<string, unknown> = {
  [liquidSlug]: fx("orderbook-liquid.json"),
  [thinSlug]: fx("orderbook-thin.json"),
};

// Mirror of the adapter's tradable filter — the conformance counts rows the
// adapter must map, so the expected count is computed with the same filter.
function tradable(m: {
  slug?: string; title?: string; status?: string; expired?: boolean; hidden?: boolean; prices?: unknown[];
}): boolean {
  return (
    !!m.slug &&
    !!m.title &&
    m.status === "FUNDED" &&
    m.expired !== true &&
    m.hidden !== true &&
    Array.isArray(m.prices) &&
    m.prices.length >= 2 &&
    typeof m.prices[0] === "number" &&
    m.prices[0] > 0.005 &&
    m.prices[0] < 0.995
  );
}
const rows = [...(page1.data ?? []), ...(page2.data ?? [])].filter(tradable);
const rowBySlug = new Map<string, Record<string, unknown>>(rows.map((m) => [String(m.slug), m]));

// Expected touch depths computed FROM the recorded books — the test asserts
// mapping correctness, not market state.
function expectedTouch(book: { asks?: Array<{ price: number; size: number }>; bids?: Array<{ price: number; size: number }> }) {
  const a = book.asks?.[0];
  const b = book.bids?.[0];
  return {
    yes: a ? Math.round((a.size / 1e6) * a.price * 100) : null,
    no: b ? Math.round((b.size / 1e6) * (1 - b.price) * 100) : null,
  };
}
const liquidBook = fx("orderbook-liquid.json");
const thinBook = fx("orderbook-thin.json");
const liquidExp = expectedTouch(liquidBook);
const thinExp = expectedTouch(thinBook);

let failures = 0;
function check(name: string, cond: unknown, detail = ""): void {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}

// ── Stub fetch BEFORE importing the adapter (recorded fixture, not live) ────
globalThis.fetch = (async (input: string | URL | Request) => {
  const u = String(input instanceof Request ? input.url : input);
  if (u.includes("/markets/active")) {
    if (/[?&]page=2/.test(u)) return new Response(JSON.stringify(page2), { status: 200 });
    if (/[?&]page=1/.test(u) || !/[?&]page=/.test(u)) return new Response(JSON.stringify(page1), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 }); // pages ≥ 3: empty
  }
  for (const [slug, book] of Object.entries(books)) {
    if (u.includes(`/markets/${encodeURIComponent(slug)}/orderbook`)) {
      return new Response(JSON.stringify(book), { status: 200 });
    }
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const { LimitlessAdapter } = await import("../src/lib/venue/limitless");
const {
  entryRulesFor,
  limitlessTakerBps,
  limitlessCollateralTakerBps,
  limitlessLegacyBuyTakerBps,
  feeDragPts,
} = await import("../src/lib/venue/rules");

console.log(`── S-05 conformance: LIMITLESS (fixtures recorded ${manifest.recordedAt}) ──`);

// 1. Market mapping: fractions → integer cents with exact YES/NO parity.
const adapter = new LimitlessAdapter();
const markets = await adapter.fetchMarkets(100);
check(
  `fetchMarkets maps exactly the ${rows.length} tradable fixture rows (page 1 + 2)`,
  markets.length === rows.length,
  `got ${markets.length} want ${rows.length}`,
);
const liquid = markets.find((m) => m.venueSymbol === liquidSlug);
const thin = markets.find((m) => m.venueSymbol === thinSlug);
check("liquid + thin fixture markets are both mapped", !!liquid && !!thin);
check("every market keeps exact parity (yes + no = 100)", markets.every((m) => (m.yesPriceCents ?? 0) + (m.noPriceCents ?? 0) === 100));
check("prices are integer cents within 1..99", markets.every((m) => (m.yesPriceCents ?? 0) >= 1 && (m.yesPriceCents ?? 0) <= 99));
const mappingOk = markets.every((m) => {
  const raw = rowBySlug.get(m.venueSymbol)?.prices as number[] | undefined;
  return raw ? m.yesPriceCents === Math.max(1, Math.min(99, Math.round(raw[0] * 100))) : false;
});
check("every mapped price equals round(fixture fraction × 100)", mappingOk);
check("raw 6-dec volume/liquidity convert to integer cents", markets.every((m) =>
  (m.volumeCents == null || Number.isInteger(m.volumeCents)) && (m.liquidityCents == null || Number.isInteger(m.liquidityCents)),
));

// 2. Touch depth derivation (rule a input): YES from best ask, NO from the
//    best bid complement; missing book → null → fail-closed.
check(`liquid book YES touch = recorded ask → ${liquidExp.yes}¢`, liquid?.yesTouchDepthCents === liquidExp.yes, `got ${liquid?.yesTouchDepthCents} want ${liquidExp.yes}`);
check(`liquid book NO touch = recorded bid complement → ${liquidExp.no}¢`, liquid?.noTouchDepthCents === liquidExp.no, `got ${liquid?.noTouchDepthCents} want ${liquidExp.no}`);
check(`thin book YES touch = ${thinExp.yes}¢ (below minimum)`, thin?.yesTouchDepthCents === thinExp.yes, `got ${thin?.yesTouchDepthCents}`);
check(`thin book NO touch = ${thinExp.no}¢`, thin?.noTouchDepthCents === thinExp.no, `got ${thin?.noTouchDepthCents}`);
const unbooked = markets.find((m) => m.venueSymbol !== liquidSlug && m.venueSymbol !== thinSlug);
check("markets without a recorded book carry null depth (fail-closed)", unbooked?.yesTouchDepthCents == null && unbooked?.noTouchDepthCents == null);

// 3. Fee regimes (rule b input): per-side bps must equal the documented
//    regime for that market's tradeType/feeModuleType at its price.
let feeMismatches = 0;
for (const m of markets) {
  const raw = rowBySlug.get(m.venueSymbol) as
    | { tradeType?: string | null; venue?: { feeModuleType?: string | null } | null }
    | undefined;
  const shape = { tradeType: raw?.tradeType ?? null, feeModuleType: raw?.venue?.feeModuleType ?? null };
  const okYes = m.yesTakerFeeBps === limitlessTakerBps(shape, m.yesPriceCents ?? 50);
  const okNo = m.noTakerFeeBps === limitlessTakerBps(shape, m.noPriceCents ?? 50);
  if (!okYes || !okNo) feeMismatches++;
}
check("stored per-side bps follow each market's documented regime (all rows)", feeMismatches === 0, `${feeMismatches} mismatches`);
check("every mapped row carries taker fee bps (edge gate needs them)", markets.every((m) => m.yesTakerFeeBps != null && m.noTakerFeeBps != null));
check("A-04 event keys present where the venue declares them (groupId/eventId)", markets.some((m) => !!m.eventKey));

// Documented anchors from the fees page (constants of the regime, not of a market).
check("COLLATERAL module: 40¢ → 300 bps (5% × (1−p))", limitlessCollateralTakerBps(40) === 300);
check("COLLATERAL module: 90¢ → 50 bps", limitlessCollateralTakerBps(90) === 50);
check("legacy curve: 1¢ → 300 bps", limitlessLegacyBuyTakerBps(1) === 300);
check("legacy curve: 55¢ → 252 bps", limitlessLegacyBuyTakerBps(55) === 252);
check("legacy curve: 90¢ → 68 bps", limitlessLegacyBuyTakerBps(90) === 68);
check("legacy curve: 99¢ → 42 bps", limitlessLegacyBuyTakerBps(99) === 42);
check("legacy curve interpolates: 57¢ → 236 bps", limitlessLegacyBuyTakerBps(57) === 236, `got ${limitlessLegacyBuyTakerBps(57)}`);
check("AMM flat: 0.40% regardless of module", limitlessTakerBps({ tradeType: "amm", feeModuleType: "COLLATERAL" }, 50) === 40);

// 4. Fee drag in points (rule b math): breakeven moves p → p×(1+fee).
check("feeDragPts(40¢, 300bps) = 1.2 pts", Math.abs(feeDragPts(40, 300) - 1.2) < 1e-9);

// 5. Structural rules arming — armed for LIMITLESS only.
const lx = entryRulesFor("LIMITLESS");
check(`LIMITLESS arms min-touch-depth = ${MIN_TOUCH}¢`, lx.minTouchDepthCents === MIN_TOUCH);
check("LIMITLESS arms per-market cap = 50000¢", lx.perMarketPositionCapCents === 50000);
check("POLYMARKET rules not armed", entryRulesFor("POLYMARKET").minTouchDepthCents == null);
check("MANIFOLD rules not armed", entryRulesFor("MANIFOLD").perMarketPositionCapCents == null);

// 6. Acceptance table — thin-book refusal vs liquid-book entry, stated.
const min = lx.minTouchDepthCents ?? 0;
const verdict = (touch: number | null | undefined) =>
  touch == null
    ? "REFUSE (fail-closed): book depth unavailable — fail-closed, sync captured no book"
    : touch >= min
      ? `ALLOW: touch depth ${touch}¢ vs minimum ${min}¢`
      : `REFUSE: touch depth ${touch}¢ vs minimum ${min}¢`;
console.log(`      liquid entry YES → ${verdict(liquid?.yesTouchDepthCents)}`);
console.log(`      thin entry YES   → ${verdict(thin?.yesTouchDepthCents)}`);
check("thin book REFUSES entry (stated depth reason)", (thin?.yesTouchDepthCents ?? Infinity) < min);
check("liquid book ALLOWS entry", (liquid?.yesTouchDepthCents ?? 0) >= min);
check("unbooked market refuses closed (fail-closed)", unbooked?.yesTouchDepthCents == null);

// 7. Contract: paper venue order state + hard live-write block.
check("queryOrderState → NOT_FOUND (paper venue)", (await adapter.queryOrderState("whatever"))?.state === "NOT_FOUND");
let threw = "";
try {
  await adapter.placeOrder();
} catch (e) {
  threw = String(e instanceof Error ? e.message : e);
}
check("placeOrder throws LIVE_TRADING_DISABLED by contract", threw.startsWith("LIVE_TRADING_DISABLED"), threw);

console.log(failures === 0 ? "\nCONFORMANCE PASS — LIMITLESS satisfies the S-05 contract" : `\nCONFORMANCE FAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
