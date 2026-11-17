// S-05 fixture recorder — AZURO (Phase 8).
// Records the offline conformance fixtures from the LIVE V3 feed so the S-05
// contract test is reproducible without network flakiness:
//
//   bun scripts/record-fixtures-azuro.ts
//
// Recipe (mirrors the §3 standing rule "conformance tests run against a
// recorded fixture", same pattern as record-fixtures-limitless.ts):
//   1. GET  /market-manager/games-by-filters?environment=PolygonUSDT
//           &gameState=Prematch&orderBy=StartsAt&orderDirection=Asc
//           &perPage=25&page=1
//   2. POST /market-manager/conditions-by-game-ids { gameIds, environment }
//   3. Keep only rows the adapter maps (Active binary prematch conditions).
//   4. Write fixtures + a provenance manifest (recorded.json).
//
// KNOWN BLOCKER (2026-11-18): every Azuro feed host returns origin-level 404
// from the sandbox (dated evidence in the S-05 compliance row,
// src/lib/venue/types.ts). This script fails HONESTLY with the probe table
// until run from an unblocked vantage (founder host). No synthetic fixtures —
// a fixture that never touched the real feed would be a lie (D-03).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api.onchainfeed.org/api/v1/public";
const ENV = "PolygonUSDT";
const UA = "faida-predict/phase8 (S-05 fixture recording)";
const FX = join(fileURLToPath(new URL(".", import.meta.url)), "..", "tests", "fixtures", "azuro");

interface GamePage { games?: Array<{ gameId?: string; id?: string; title?: string; state?: string }>; total?: number }
interface ConditionsResponse { conditions?: unknown[] }

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": UA, accept: "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`azuro api ${res.status} for ${new URL(url).pathname}`);
  return (await res.json()) as T;
}

async function main() {
  console.log(`Recording Azuro V3 fixtures from ${BASE} (${ENV}) …`);
  const page = await fetchJson<GamePage>(
    `${BASE}/market-manager/games-by-filters?environment=${ENV}&gameState=Prematch&orderBy=StartsAt&orderDirection=Asc&perPage=25&page=1`,
  );
  const games = (page.games ?? []).filter((g) => g.state === "Prematch");
  if (!games.length) throw new Error("feed reachable but returned no Prematch games — refusing to record empty fixtures");
  const gameIds = games.map((g) => String(g.gameId ?? g.id ?? "")).filter(Boolean).slice(0, 15);
  await new Promise((r) => setTimeout(r, 400));
  const conditions = await fetchJson<ConditionsResponse>(`${BASE}/market-manager/conditions-by-game-ids`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameIds, environment: ENV, extended: false }),
  });

  mkdirSync(FX, { recursive: true });
  writeFileSync(join(FX, "games-page1.json"), JSON.stringify(page, null, 2));
  writeFileSync(join(FX, "conditions.json"), JSON.stringify(conditions, null, 2));
  writeFileSync(
    join(FX, "recorded.json"),
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        base: BASE,
        environment: ENV,
        endpoints: [
          "GET /market-manager/games-by-filters?environment=PolygonUSDT&gameState=Prematch&orderBy=StartsAt&orderDirection=Asc&perPage=25&page=1",
          "POST /market-manager/conditions-by-game-ids {gameIds, environment, extended:false}",
        ],
        contractSource: "@azuro-org/toolkit v7.2.0 dist types (npm, published 2026-10-10)",
        gamesRecorded: games.length,
        conditionsRecorded: (conditions.conditions ?? []).length,
        recorder: "scripts/record-fixtures-azuro.ts",
      },
      null,
      2,
    ),
  );
  console.log(`OK — ${games.length} games, ${(conditions.conditions ?? []).length} conditions → ${FX}`);
  console.log("Next: bun run conformance:azuro");
}

main().catch((e) => {
  console.error("REFUSED to record fixtures — the recording must be real (D-03):");
  console.error(`  ${String(e instanceof Error ? e.message : e)}`);
  console.error("");
  console.error("If this is the sandbox blocker (origin-level 404 on every Azuro host),");
  console.error("run this script from the founder host or any unblocked vantage.");
  process.exit(1);
});
