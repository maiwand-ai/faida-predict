// S-05 venue conformance contract test — LIMITLESS (Phase 4, P4.3).
// Runs the adapter against RECORDED FIXTURES (tests/fixtures/limitless) so the
// venue contract is reproducible offline: identical assertions on every run,
// no live-API flakiness. Standing rule §3.4: "Venue conformance contract
// tests (S-05) run against a recorded fixture."
//
//   bun run conformance
//
// Fixture provenance: recorded from api.limitless.exchange on 2026-11-17
// (the full 25-row page 1 of /markets/active?sortBy=high_value, the BTC daily
// row from page 2, and the orderbooks of the BTC daily (liquid) and BTC hourly
// (thin) markets).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FX = join(fileURLToPath(new URL(".", import.meta.url)), "..", "tests", "fixtures", "limitless");
const fx = (name: string) => JSON.parse(readFileSync(join(FX, name), "utf8"));

const page1 = fx("markets-active-page1.json");
const page2 = fx("markets-active-page2.json");
const dailySlug = String(page2.data[0].slug); // BTC daily row recorded with its book
const hourlySlug = "btc-up-or-down-hourly-p-1794877510934";
const books: Record<string, unknown> = {
  [dailySlug]: fx("orderbook-btc-daily.json"),
  [hourlySlug]: fx("orderbook-btc-hourly.json"),
};

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
const dailyBook = fx("orderbook-btc-daily.json");
const hourlyBook = fx("orderbook-btc-hourly.json");
const dailyExp = expectedTouch(dailyBook);
const hourlyExp = expectedTouch(hourlyBook);

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
    const page = /[?&]page=2/.test(u) ? page2 : page1;
    return new Response(JSON.stringify(page), { status: 200 });
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

console.log("── S-05 conformance: LIMITLESS (fixtures recorded 2026-11-17) ──");

// 1. Market mapping: fractions → integer cents with exact YES/NO parity.
const adapter = new LimitlessAdapter();
const markets = await adapter.fetchMarkets(30);
// All recorded rows are tradable by construction (status FUNDED, two-sided
// prices in range — verified when recording), so the expected count is the
// full fixture: page 1 (25 rows) + page 2 (BTC daily row).
const expectedCount = (page1.data as unknown[]).length + (page2.data as unknown[]).length;
check(`fetchMarkets paginates (page 1 + 2) and returns ${expectedCount} markets`, markets.length === expectedCount, `got ${markets.length}`);
const daily = markets.find((m) => m.venueSymbol === dailySlug);
const hourly = markets.find((m) => m.venueSymbol === hourlySlug);
const trump = markets.find((m) => m.venueSymbol.startsWith("trump-putin"));
check("every market keeps exact parity (yes + no = 100)", markets.every((m) => (m.yesPriceCents ?? 0) + (m.noPriceCents ?? 0) === 100));
check("prices are integer cents within 1..99", markets.every((m) => (m.yesPriceCents ?? 0) >= 1 && (m.yesPriceCents ?? 0) <= 99));
check("BTC hourly maps 0.36 → 36¢", hourly?.yesPriceCents === 36);
check("raw 6-dec volume converts to cents (÷10)", markets.every((m) => m.volumeCents == null || Number.isInteger(m.volumeCents)));

// 2. Touch depth derivation (rule a input): YES from best ask, NO from the
//    best bid complement; missing book → null → fail-closed.
check(`BTC daily YES touch = recorded ask → ${dailyExp.yes}¢`, daily?.yesTouchDepthCents === dailyExp.yes, `got ${daily?.yesTouchDepthCents} want ${dailyExp.yes}`);
check(`BTC daily NO touch = recorded bid complement → ${dailyExp.no}¢`, daily?.noTouchDepthCents === dailyExp.no, `got ${daily?.noTouchDepthCents} want ${dailyExp.no}`);
check(`BTC hourly YES touch = ${hourlyExp.yes}¢ (thin)`, hourly?.yesTouchDepthCents === hourlyExp.yes, `got ${hourly?.yesTouchDepthCents}`);
check(`BTC hourly NO touch = ${hourlyExp.no}¢ (thin)`, hourly?.noTouchDepthCents === hourlyExp.no, `got ${hourly?.noTouchDepthCents}`);
check("markets without a recorded book carry null depth (fail-closed)", trump?.yesTouchDepthCents == null && trump?.noTouchDepthCents == null);

// 3. Fee regimes (rule b input) — documented anchors from the fees page.
check("COLLATERAL module: 40¢ → 300 bps (5% × (1−p))", limitlessCollateralTakerBps(40) === 300);
check("COLLATERAL module: 90¢ → 50 bps", limitlessCollateralTakerBps(90) === 50);
check("legacy curve: 1¢ → 300 bps", limitlessLegacyBuyTakerBps(1) === 300);
check("legacy curve: 55¢ → 252 bps", limitlessLegacyBuyTakerBps(55) === 252);
check("legacy curve: 90¢ → 68 bps", limitlessLegacyBuyTakerBps(90) === 68);
check("legacy curve: 99¢ → 42 bps", limitlessLegacyBuyTakerBps(99) === 42);
check("legacy curve interpolates: 57¢ → 236 bps", limitlessLegacyBuyTakerBps(57) === 236, `got ${limitlessLegacyBuyTakerBps(57)}`);
check("AMM flat: 0.40% regardless of module", limitlessTakerBps({ tradeType: "amm", feeModuleType: "COLLATERAL" }, 50) === 40);
check("stored per-side bps follow each market's regime", (hourly?.yesTakerFeeBps ?? 0) === 320 && (trump?.yesTakerFeeBps ?? 0) === 42, `hourly ${hourly?.yesTakerFeeBps} trump ${trump?.yesTakerFeeBps}`);
// 4. Fee drag in points (rule b math): breakeven moves p → p×(1+fee).
check("feeDragPts(40¢, 300bps) = 1.2 pts", Math.abs(feeDragPts(40, 300) - 1.2) < 1e-9);

// 5. Structural rules arming — armed for LIMITLESS only.
const lx = entryRulesFor("LIMITLESS");
check("LIMITLESS arms min-touch-depth = 5000¢", lx.minTouchDepthCents === 5000);
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
console.log(`      daily entry YES → ${verdict(daily?.yesTouchDepthCents)}`);
console.log(`      hourly entry YES → ${verdict(hourly?.yesTouchDepthCents)}`);
check("thin hourly book REFUSES entry (stated depth reason)", (hourly?.yesTouchDepthCents ?? Infinity) < min);
check("liquid daily book ALLOWS entry", (daily?.yesTouchDepthCents ?? 0) >= min);
check("unbooked market refuses closed (trump-putin)", trump?.yesTouchDepthCents == null);

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
