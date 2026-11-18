// S-05 fixture recorder — KALSHI (Phase 9).
// Records the offline conformance fixtures from the LIVE production Trade API
// so the S-05 contract test is reproducible without network flakiness:
//
//   bun scripts/record-fixtures-kalshi.ts
//
// Recipe (mirrors the adapter's fetchMarkets flow — §3 standing rule
// "conformance tests run against a recorded fixture"):
//   1. GET /events?status=open&limit=200&with_sub_markets=false (≤3 pages —
//      the events endpoint EXCLUDES multivariate events; the newest-1000
//      /markets page is dominated by MVE combo legs, observed 2026-11-18)
//   2. Stratified sample of 45 events → GET /markets?event_ticker=X
//   3. Rank mappable rows by contract volume → top 30 targets
//   4. GET /series/{ticker} for the distinct series
//   5. GET /markets/{ticker}/orderbook for the targets
//   6. Write fixtures + a provenance manifest (recorded.json)
//
// Unlike Azuro (blocked at the origin from the sandbox), the Kalshi API
// answers from here — dated [VERIFY] probes in the S-05 compliance row
// (src/lib/venue/types.ts) — so REAL fixtures are recorded. No synthetic
// fixtures: a fixture that never touched the real feed would be a lie (D-03).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stratifiedSampleEvents, selectKalshiTargets, type KalshiEvent, type KalshiMarket, type KalshiSeries, type KalshiOrderbook } from "../src/lib/venue/kalshi";

const BASE = "https://api.elections.kalshi.com/trade-api/v2";
const UA = "faida-predict/phase9 (S-05 fixture recording)";
const FX = join(fileURLToPath(new URL(".", import.meta.url)), "..", "tests", "fixtures", "kalshi");
const SPACING_MS = 130;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`kalshi api ${res.status} for ${new URL(url).pathname}`);
  return (await res.json()) as T;
}

async function main() {
  console.log(`Recording Kalshi fixtures from ${BASE} …`);
  // 1) open events (≤3 pages)
  const events: KalshiEvent[] = [];
  let cursor = "";
  for (let page = 0; page < 3; page++) {
    const body = await fetchJson<{ events?: KalshiEvent[]; cursor?: string }>(
      `${BASE}/events?status=open&limit=200&with_sub_markets=false${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    events.push(...(body.events ?? []));
    cursor = body.cursor ?? "";
    if (!cursor) break;
  }
  console.log(`open events scanned: ${events.length}`);
  const sampled = stratifiedSampleEvents(events, 45);
  if (!sampled.length) throw new Error("feed reachable but returned no open events — refusing to record empty fixtures");

  // 2) markets per sampled event
  const rows: KalshiMarket[] = [];
  for (const ev of sampled) {
    await new Promise((r) => setTimeout(r, SPACING_MS));
    try {
      const body = await fetchJson<{ markets?: KalshiMarket[] }>(
        `${BASE}/markets?event_ticker=${encodeURIComponent(ev.event_ticker ?? "")}`,
      );
      rows.push(...(body.markets ?? []));
    } catch { /* one event failing must not block the recording */ }
  }
  const targets = selectKalshiTargets(rows, 30);
  if (!targets.length) throw new Error("feed reachable but returned no mappable binary markets — refusing to record empty fixtures");
  console.log(`mappable targets: ${targets.length} of ${rows.length} raw rows`);

  // 3) series for the distinct series of the targets
  const seriesTickers = [...new Set(targets.map((m) => (m.ticker as string).split("-")[0]))].slice(0, 25);
  const series: Record<string, unknown> = {};
  for (const st of seriesTickers) {
    await new Promise((r) => setTimeout(r, SPACING_MS));
    try {
      series[st] = (await fetchJson<{ series?: KalshiSeries }>(`${BASE}/series/${st}`)).series ?? null;
    } catch {
      series[st] = null; // honest gap — the adapter falls back to the general schedule
    }
  }

  // 4) books for the targets
  const books: Record<string, unknown> = {};
  for (const m of targets) {
    await new Promise((r) => setTimeout(r, SPACING_MS));
    try {
      books[m.ticker as string] = await fetchJson<unknown>(`${BASE}/markets/${m.ticker}/orderbook`);
    } catch {
      // absent → depth null → fail-closed depth rule
    }
  }

  mkdirSync(FX, { recursive: true });
  writeFileSync(join(FX, "markets.json"), JSON.stringify({ markets: targets }, null, 2));
  writeFileSync(join(FX, "series.json"), JSON.stringify(series, null, 2));
  writeFileSync(join(FX, "orderbooks.json"), JSON.stringify(books, null, 2));
  writeFileSync(
    join(FX, "recorded.json"),
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        base: BASE,
        endpoints: [
          "GET /events?status=open&limit=200&with_sub_markets=false (≤3 pages, stratified sample of 45)",
          "GET /markets?event_ticker={ticker} (per sampled event)",
          "GET /series/{ticker} (distinct series of the targets)",
          "GET /markets/{ticker}/orderbook",
        ],
        contractSource: "docs.kalshi.com markdown API reference (fetched 2026-11-18)",
        eventsScanned: events.length,
        eventsSampled: sampled.length,
        marketsRecorded: targets.length,
        seriesRecorded: Object.keys(series).length,
        booksRecorded: Object.keys(books).length,
        recorder: "scripts/record-fixtures-kalshi.ts",
      },
      null,
      2,
    ),
  );
  console.log(`OK — ${targets.length} markets, ${Object.keys(series).length} series, ${Object.keys(books).length} books → ${FX}`);
  console.log("Next: bun run conformance:kalshi");
}

main().catch((e) => {
  console.error("REFUSED to record fixtures — the recording must be real (D-03):");
  console.error(`  ${String(e instanceof Error ? e.message : e)}`);
  process.exit(1);
});
