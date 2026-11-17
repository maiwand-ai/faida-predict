// S-05 fixture recorder — LIMITLESS (Phase 4, P4.3).
// Records the offline conformance fixtures from the LIVE public API so the
// S-05 contract test is reproducible without network flakiness:
//
//   bun scripts/record-fixtures-limitless.ts
//
// Recipe (matches the §3 standing rule "conformance tests run against a
// recorded fixture"):
//   1. GET /markets/active?page=1&limit=25&sortBy=high_value  (page cap 25)
//   2. GET /markets/active?page=2&limit=25&sortBy=high_value
//   3. Keep only rows the adapter considers tradable (status FUNDED, not
//      expired/hidden, two-sided price in range) — conformance counts rows
//      from the fixtures themselves, so every kept row must map cleanly.
//   4. Fetch orderbooks for the BTC daily + BTC hourly markets (the fixture
//      pair: one liquid, one thin), plus a few extra candidates for robustness.
//   5. Pick the LIQUID fixture (yes-touch ≥ min) and the THIN fixture
//      (< min) from the recorded books, preferring the BTC daily / hourly pair.
//   6. Write fixtures + a provenance manifest with measured touches.
//
// The manifest (recorded.json) is the provenance record: what was recorded,
// when, from which endpoints, and the measured touch depths at recording time.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api.limitless.exchange";
const UA = "faida-predict/phase4 (S-05 fixture recording)";
const FX = join(fileURLToPath(new URL(".", import.meta.url)), "..", "tests", "fixtures", "limitless");

interface LxMarket {
  slug?: string;
  title?: string;
  prices?: number[];
  status?: string;
  expired?: boolean;
  hidden?: boolean;
  tradeType?: string;
  venue?: { feeModuleType?: string | null } | null;
}
interface LxBook {
  asks?: Array<{ price: number; size: number }>;
  bids?: Array<{ price: number; size: number }>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`limitless api ${res.status} for ${url}`);
  return (await res.json()) as T;
}

// Mirror of the adapter's tradable filter — a fixture row that would be
// filtered out would break the conformance count assertion.
function tradable(m: LxMarket): boolean {
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

function yesTouch(book: LxBook | null): number | null {
  const a = book?.asks?.[0];
  return a && Number.isFinite(a.price) && Number.isFinite(a.size)
    ? Math.round((a.size / 1e6) * a.price * 100)
    : null;
}
function noTouch(book: LxBook | null): number | null {
  const b = book?.bids?.[0];
  return b && Number.isFinite(b.price) && Number.isFinite(b.size)
    ? Math.round((b.size / 1e6) * (1 - b.price) * 100)
    : null;
}

async function fetchBook(slug: string): Promise<LxBook | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchJson<LxBook>(`${BASE}/markets/${encodeURIComponent(slug)}/orderbook`);
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 900));
    }
  }
  return null;
}

const MIN_TOUCH = 5000; // must match VENUE_ENTRY_RULES.LIMITLESS.minTouchDepthCents

async function main() {
  console.log("recording Limitless conformance fixtures…");
  const page1 = await fetchJson<{ data?: LxMarket[] }>(`${BASE}/markets/active?page=1&limit=25&sortBy=high_value`);
  await new Promise((r) => setTimeout(r, 300));
  const page2Raw = await fetchJson<{ data?: LxMarket[] }>(`${BASE}/markets/active?page=2&limit=25&sortBy=high_value`);

  const p1 = (page1.data ?? []).filter(tradable);
  const p2 = (page2Raw.data ?? []).filter(tradable);
  const all = [...p1, ...p2];
  if (all.length < 3) throw new Error(`only ${all.length} tradable rows — refusing to record a degenerate fixture`);
  console.log(`tradable rows: page1 ${p1.length}, page2 ${p2.length}`);

  const btcDaily = all.find(
    (m) => /btc/i.test(`${m.slug} ${m.title}`) && /daily/i.test(`${m.slug} ${m.title}`),
  );
  const btcHourly = all.find(
    (m) => /btc/i.test(`${m.slug} ${m.title}`) && /hourly/i.test(`${m.slug} ${m.title}`),
  );
  console.log(`btc daily: ${btcDaily?.slug ?? "NOT FOUND"} | btc hourly: ${btcHourly?.slug ?? "NOT FOUND"}`);

  // Books: the BTC pair first, then a few extra candidates for robustness.
  const extra = all.filter((m) => m !== btcDaily && m !== btcHourly).slice(0, 5);
  const candidates = [btcDaily, btcHourly, ...extra].filter(Boolean) as LxMarket[];
  const books = new Map<string, LxBook | null>();
  for (const m of candidates) {
    books.set(String(m.slug), await fetchBook(String(m.slug)));
    await new Promise((r) => setTimeout(r, 250));
  }

  // Pick the liquid + thin fixtures. Prefer the canonical BTC pair when it
  // qualifies; otherwise take the extremes across recorded books.
  const touchOf = (m: LxMarket) => yesTouch(books.get(String(m.slug)) ?? null);
  let liquid = btcDaily && (touchOf(btcDaily) ?? 0) >= MIN_TOUCH ? btcDaily : undefined;
  let thin = btcHourly && (touchOf(btcHourly) ?? Infinity) < MIN_TOUCH ? btcHourly : undefined;
  if (!liquid) {
    for (const m of candidates) if ((touchOf(m) ?? -1) >= MIN_TOUCH && (!liquid || (touchOf(m) ?? 0) > (touchOf(liquid) ?? 0))) liquid = m;
  }
  if (!thin) {
    for (const m of candidates) {
      const t = touchOf(m);
      if (t != null && t < MIN_TOUCH && (!thin || t < (touchOf(thin) ?? Infinity))) thin = m;
    }
  }
  if (!liquid || !thin) {
    throw new Error(
      `no qualifying fixture pair (liquid ≥ ${MIN_TOUCH}¢, thin < ${MIN_TOUCH}¢). ` +
        `measured: ${candidates.map((m) => `${m.slug}=${touchOf(m)}¢`).join(", ")}`,
    );
  }
  console.log(`liquid fixture: ${liquid.slug} (YES touch ${touchOf(liquid)}¢)`);
  console.log(`thin fixture:   ${thin.slug} (YES touch ${touchOf(thin)}¢)`);

  mkdirSync(FX, { recursive: true });
  writeFileSync(join(FX, "markets-active-page1.json"), JSON.stringify(page1, null, 2));
  writeFileSync(join(FX, "markets-active-page2.json"), JSON.stringify(page2Raw, null, 2));
  writeFileSync(join(FX, "orderbook-liquid.json"), JSON.stringify(books.get(String(liquid.slug)), null, 2));
  writeFileSync(join(FX, "orderbook-thin.json"), JSON.stringify(books.get(String(thin.slug)), null, 2));
  const manifest = {
    recordedAt: new Date().toISOString(),
    source: "api.limitless.exchange (public REST, no key)",
    endpoints: [
      "/markets/active?page=1&limit=25&sortBy=high_value",
      "/markets/active?page=2&limit=25&sortBy=high_value",
      `/markets/{slug}/orderbook (liquid, thin)`,
    ],
    liquidSlug: liquid.slug,
    liquidQuestion: liquid.title,
    liquidYesTouchCents: touchOf(liquid),
    thinSlug: thin.slug,
    thinQuestion: thin.title,
    thinYesTouchCents: touchOf(thin),
    minTouchDepthCents: MIN_TOUCH,
    rowFilters: "status FUNDED, not expired/hidden, two-sided price in (0.005, 0.995)",
    note: "Fixtures feed scripts/conformance-limitless.ts (bun run conformance). Raw API responses are kept verbatim.",
  };
  writeFileSync(join(FX, "recorded.json"), JSON.stringify(manifest, null, 2));
  console.log(`fixtures written to ${FX}`);
}

main().catch((e) => {
  console.error("recording failed:", e);
  process.exit(1);
});
