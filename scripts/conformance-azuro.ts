// S-05 venue conformance contract test — AZURO (Phase 8).
// Runs the adapter's PURE mapping (mapAzuroFeed) against RECORDED FIXTURES
// (tests/fixtures/azuro) so the venue contract is reproducible offline —
// standing rule §3.4. Same pattern as conformance-limitless.ts.
//
//   bun run conformance:azuro
//   bun scripts/record-fixtures-azuro.ts   ← record from the live feed first
//
// HONEST SKIP (not a fake pass): when fixtures are absent, this script says
// so, states the dated blocker, and exits 0 — the venue's S-05 state is
// "conformance owed", never "conformance passed". The phase smoke asserts
// the SKIP notice itself.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mapAzuroFeed, decimalOddsToCents, azuroTakerBps, type AzuroGame, type AzuroCondition } from "../src/lib/venue/azuro";

const FX = join(fileURLToPath(new URL(".", import.meta.url)), "..", "tests", "fixtures", "azuro");

const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  const ok = Boolean(cond);
  if (!ok) failures.push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}

if (!existsSync(join(FX, "recorded.json"))) {
  console.log("SKIP  azuro conformance — no recorded fixtures (tests/fixtures/azuro absent).");
  console.log("      Dated blocker 2026-11-18: Azuro feed hosts unreachable from the sandbox");
  console.log("      (origin-level 404 — evidence in the S-05 compliance row, src/lib/venue/types.ts).");
  console.log("      Record from an unblocked vantage: bun scripts/record-fixtures-azuro.ts");
  console.log("      The venue stays PENDING until then — no self-approved flip (S-05 §3.4).");
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(join(FX, "recorded.json"), "utf8"));
const page = JSON.parse(readFileSync(join(FX, "games-page1.json"), "utf8")) as { games?: AzuroGame[] };
const conditionsBody = JSON.parse(readFileSync(join(FX, "conditions.json"), "utf8")) as { conditions?: AzuroCondition[] };

const games = (page.games ?? []).filter((g) => g.state === "Prematch");
const conditions = conditionsBody.conditions ?? [];
check("manifest has provenance (recordedAt/base/environment)", !!manifest.recordedAt && !!manifest.base && !!manifest.environment);
check("recorded games exist", games.length > 0, "fixture has no prematch games");
check("recorded conditions exist", conditions.length > 0, "fixture has no conditions");

const mapped = mapAzuroFeed(games, conditions, 100);
check("mapping produces markets", mapped.length > 0, "no binary conditions mapped — check fixture content");

// Every mapped market satisfies the VenueMarket contract invariants.
let allValid = true;
for (const m of mapped) {
  const ok =
    m.venueSymbol.startsWith("az:") &&
    !!m.question && m.question.includes("—") &&
    m.yesPriceCents != null && m.yesPriceCents >= 1 && m.yesPriceCents <= 99 &&
    m.noPriceCents != null && m.noPriceCents >= 1 && m.noPriceCents <= 99 &&
    typeof m.eventKey === "string" && m.eventKey.startsWith("az:game:") &&
    !!m.resolutionSource && m.resolutionSource.includes("Azuro") &&
    m.closeDate != null && !Number.isNaN(new Date(m.closeDate).getTime());
  if (!ok) { allValid = false; break; }
}
check("all mapped markets carry venue-scoped symbol/question/eventKey/closeDate/resolution", allValid);

// Odds→cents is the venue's own number: verify on the first binary condition.
const binary = conditions.find(
  (c) => c.state === "Active" && (c.outcomes ?? []).filter((o) => o.state === "Active" && o.hidden !== true).length === 2,
);
if (binary) {
  const outs = (binary.outcomes ?? []).filter((o) => o.state === "Active" && o.hidden !== true);
  const expectedYes = decimalOddsToCents(outs[0].odds);
  const expectedNo = decimalOddsToCents(outs[1].odds);
  const sym = `az:${binary.game?.gameId}:${binary.conditionId ?? binary.id}`;
  const row = mapped.find((m) => m.venueSymbol === sym);
  check("odds→cents mapping matches the recorded odds (venue's own number)", !!row && row.yesPriceCents === expectedYes && row.noPriceCents === expectedNo);
  const fee = azuroTakerBps(binary, [outs[0].odds, outs[1].odds]);
  check("fee bps derived from the condition margin/overround (0 when unknown)", Number.isFinite(fee) && fee >= 0);
}

// A-04: all conditions of one game share the eventKey.
const keys = new Set(mapped.map((m) => m.eventKey));
const distinctGames = new Set(mapped.map((m) => m.venueSymbol.split(":")[1]));
check("eventKey == az:game:<gameId> and clusters per game", keys.size === distinctGames.size);

// Sports shape: closeDate = startsAt within a sane window (0 < Δ ≤ 400 days).
let closeShapeOk = true;
for (const m of mapped) {
  const d = new Date(m.closeDate as string).getTime();
  if (!(d > Date.now() - 6 * 3600e3 && d < Date.now() + 400 * 864e5)) { closeShapeOk = false; break; }
}
check("closeDate reflects the sports shape (game start, sane window)", closeShapeOk);

console.log("");
if (failures.length) {
  console.log(`CONFORMANCE FAIL — ${failures.length} check(s) failed`);
  process.exit(1);
} else {
  console.log(`CONFORMANCE PASS — ${mapped.length} markets replayed from recorded fixtures`);
}
