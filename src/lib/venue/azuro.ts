// Azuro adapter — venue #5 (B9), Phase 8.
//
// CONTRACT SOURCE (S-05 [VERIFY] evidence, 2026-11-18): the official
// @azuro-org/toolkit v7.2.0 (published 2026-10-10, npm) — its `dist` types
// pin the exact V3 feed contract. Protocol is alive (azuro.org + docs active,
// toolkit shipped five weeks before this phase).
//
//   Production REST : https://api.onchainfeed.org/api/v1/public
//   GET  /market-manager/games-by-filters
//        ?environment=PolygonUSDT&gameState=Prematch
//        &orderBy=StartsAt&orderDirection=Asc&perPage=100&page=1
//        → PaginatedGamesResponse { games: GameData[], page, perPage, total, totalPages }
//   POST /market-manager/conditions-by-game-ids  { gameIds, environment, extended }
//        → { conditions: ConditionDetailedData[] }
//
//   GameData     { id, gameId, slug, title, startsAt (unix SEC string),
//                  state: "Prematch"|"Live"|"Stopped"|"Finished"|"Canceled",
//                  turnover (raw string), sport {slug, name, sporthub},
//                  league {slug, name, isTopLeague}, country {slug, name},
//                  participants [{name}] }
//   ConditionDetailedData { id, conditionId, state: "Active"|"Stopped",
//                  title, isPrematchEnabled, hidden?, margin (string),
//                  outcomes [{title, outcomeId, odds (decimal string),
//                  state: "Active"|"Canceled"|"Stopped", hidden}],
//                  category, game {gameId} }
//
// Sports shape (§3 Azuro notes): shorter closes (closeDate = game startsAt),
// different resolution sources (league + the Azuro data provider — recorded
// on every market), categories are SPORTS (soccer, basketball, ...). The A-04
// eventKey is the GAME — every condition of one match stacks as related
// exposure (betting both halves of a game is one economic bet).
//
// Fee regime: the feed applies the venue margin to every outcome's odds
// (toolkit ODDS_DECIMALS=12; global margin switch MARGIN_APPLIED_AT, and
// every condition carries its own `margin` string). The per-side taker fee
// is therefore EMBEDDED in the quoted odds: we derive per-side bps from the
// condition margin (half the book margin per side), so edge-after-fees stays
// structurally honest even though the book never shows a separate fee.
//
// [VERIFY-UNREACHABLE-FROM-SANDBOX 2026-11-18] — every Azuro feed host
// (api.onchainfeed.org, dev-api.onchainfeed.org, preprod-api.azuro.org,
// api.azuro.org, streams.onchainfeed.org) returns origin-level 404 for ALL
// paths from this sandbox, and thegraph.onchainfeed.org does not resolve —
// across HTTP versions, methods and headers, while Gamma/Manifold/Limitless/
// CLOB endpoints all answer from the same vantage. VERDICT (Drift precedent,
// applied proportionately): the adapter is IMPLEMENTED against the verified
// contract, the venue stays PENDING — robots refuse 422 — until conformance
// fixtures are RECORDED from an unblocked vantage (founder host):
//   bun scripts/record-fixtures-azuro.ts   # writes tests/fixtures/azuro
//   bun run conformance:azuro              # replays fixtures offline
// A recorded fixture is the S-05 standing rule — no flip is self-approved.
//
// Mapping scope (honest): BINARY conditions only (exactly 2 active, visible
// outcomes). Multi-way sports markets (1X2, totals with lines) need
// multi-outcome positions — future engine work, recorded here as scope.
import type { VenueAdapter, VenueMarket, OrderStateGuess, LiveOrderRequest, LiveOrderOutcome } from "./types";

const AZURO_BASE = "https://api.onchainfeed.org/api/v1/public";
const AZURO_ENVIRONMENT = "PolygonUSDT"; // chainId 137 — Polygon, USDT collateral
const UA = "faida-predict/phase8 (paper market-data adapter)";
const FEED_SPACING_MS = 150; // modest pacing — no documented public rate limit

// ── SDK-verified wire shapes (subset the adapter consumes) ──────────────────
export interface AzuroGame {
  id?: string;
  gameId?: string;
  slug?: string;
  title?: string;
  startsAt?: string; // unix seconds, string per SDK ("1771707600")
  state?: string; // "Prematch" | "Live" | "Stopped" | "Finished" | "Canceled"
  turnover?: string;
  sport?: { slug?: string; name?: string } | null;
  league?: { slug?: string; name?: string; isTopLeague?: boolean } | null;
  country?: { slug?: string; name?: string } | null;
  participants?: Array<{ name?: string }>;
}

export interface AzuroOutcome {
  title?: string;
  outcomeId?: string;
  odds?: string; // decimal odds, e.g. "1.850000000000"
  state?: string; // "Active" | "Canceled" | "Stopped"
  hidden?: boolean;
}

export interface AzuroCondition {
  id?: string;
  conditionId?: string;
  state?: string; // "Active" | "Stopped"
  title?: string;
  isPrematchEnabled?: boolean;
  hidden?: boolean;
  margin?: string; // venue-declared book margin, e.g. "0.05"
  outcomes?: AzuroOutcome[];
  category?: string | null;
  game?: { gameId?: string } | null;
}

export interface AzuroGamesPage {
  games?: AzuroGame[];
  total?: number;
  totalPages?: number;
}

export interface AzuroConditionsResponse {
  conditions?: AzuroCondition[];
}

// ── Decimal odds → cents (the venue's own numbers, no invented prices) ──────
/** Decimal odds d → implied probability in cents (1..99), null when degenerate. */
export function decimalOddsToCents(odds: string | number | undefined): number | null {
  const d = typeof odds === "number" ? odds : parseFloat(String(odds ?? ""));
  if (!Number.isFinite(d) || d <= 1.0001) return null; // odds ≤ 1 are degenerate
  const cents = Math.round(100 / d);
  if (cents < 1 || cents > 99) return null;
  return cents;
}

/**
 * Per-side embedded taker fee bps from the condition's own margin: the feed
 * folds the venue fee into every outcome's odds, so the honest per-side fee
 * is half the book margin (two-way market), in bps of notional. Null margin
 * → derived from the odds overround instead; both fail to a conservative
 * null only when the numbers are unusable (fee stays unknown → 0 charged,
 * stated in the sync provenance).
 */
export function azuroTakerBps(condition: AzuroCondition, odds: [string | number | undefined, string | number | undefined]): number {
  const marginRaw = parseFloat(String(condition.margin ?? ""));
  if (Number.isFinite(marginRaw) && marginRaw > 0 && marginRaw < 1) {
    return Math.round((marginRaw / 2) * 10000);
  }
  // Derive from the overround: S = 1/d1 + 1/d2; margin = S − 1.
  const d1 = typeof odds[0] === "number" ? odds[0] : parseFloat(String(odds[0] ?? ""));
  const d2 = typeof odds[1] === "number" ? odds[1] : parseFloat(String(odds[1] ?? ""));
  if (Number.isFinite(d1) && Number.isFinite(d2) && d1 > 1.0001 && d2 > 1.0001) {
    const overround = 1 / d1 + 1 / d2 - 1;
    if (overround > 0 && overround < 1) return Math.round((overround / 2) * 10000);
  }
  return 0; // unknown fee — honest: no fee charged, edge gate sees raw prices
}

/**
 * PURE mapping — games + their conditions → VenueMarket rows. Exported for
 * the S-05 conformance harness (replays recorded fixtures offline).
 * Binary Active prematch conditions only; sports-shape provenance everywhere.
 */
export function mapAzuroFeed(games: AzuroGame[], conditions: AzuroCondition[], limit = 30): VenueMarket[] {
  const gameById = new Map<string, AzuroGame>();
  for (const g of games) {
    const key = String(g.gameId ?? g.id ?? "");
    if (key) gameById.set(key, g);
  }

  const out: VenueMarket[] = [];
  for (const c of conditions) {
    const gameId = String(c.game?.gameId ?? "");
    const game = gameById.get(gameId);
    if (!game) continue; // condition without its game — cannot provenance it
    if (c.state !== "Active") continue;
    if (c.isPrematchEnabled === false) continue;
    if (c.hidden === true) continue;
    const outcomes = (c.outcomes ?? []).filter((o) => o.state === "Active" && o.hidden !== true && !!o.outcomeId);
    if (outcomes.length !== 2) continue; // binary scope (1X2/totals = future work)
    const odds: [string | undefined, string | undefined] = [outcomes[0].odds, outcomes[1].odds];
    const yes = decimalOddsToCents(odds[0]);
    const no = decimalOddsToCents(odds[1]);
    if (yes == null || no == null) continue; // degenerate book — never mapped

    // Sports shape: close = game startsAt (unix seconds string).
    const startsAtSec = Number.parseInt(String(game.startsAt ?? ""), 10);
    const closeDate = Number.isFinite(startsAtSec) && startsAtSec > 0
      ? new Date(startsAtSec * 1000).toISOString()
      : null;

    const leagueName = game.league?.name ?? null;
    const countryName = game.country?.name ?? null;
    const sportName = game.sport?.name ?? game.sport?.slug ?? "sports";
    const conditionId = String(c.conditionId ?? c.id ?? "");
    const venueSymbol = `az:${gameId}:${conditionId}`;
    const feeBps = azuroTakerBps(c, odds);

    out.push({
      venueSymbol,
      question: `${game.title ?? `Game ${gameId}`} — ${c.title ?? outcomes[0].title ?? "market"}`,
      category: (game.sport?.slug ?? "sports").toLowerCase(),
      yesPriceCents: yes,
      noPriceCents: no,
      liquidityCents: null, // feed exposes no depth — entry rules never arm on depth here
      volumeCents: azuroTurnoverToCents(game.turnover),
      closeDate,
      // Different resolution sources (§3): league + sport + the Azuro data
      // provider — recorded verbatim so C16 can surface it.
      resolutionSource: `${sportName}${leagueName ? ` · ${leagueName}` : ""}${countryName ? ` · ${countryName}` : ""} — resolved by the Azuro protocol data provider (V3 unified feed)`,
      yesTouchDepthCents: null,
      noTouchDepthCents: null,
      yesTakerFeeBps: feeBps,
      noTakerFeeBps: feeBps,
      eventKey: `az:game:${gameId}`, // A-04: all conditions of one game stack
    });
    if (out.length >= limit) break;
  }
  return out;
}

// Turnover decimals are not documented for the V3 feed (legacy subgraph used
// 6-dec collateral raw). Parse defensively: treat as 6-dec raw, reject
// absurd results (>$10B) as unknown — honesty over guessed precision.
function azuroTurnoverToCents(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 0) return null;
  const cents = Math.round(n / 1e4); // raw 6-dec → dollars → cents
  if (cents > 1e12) return null;
  return cents;
}

export class AzuroAdapter implements VenueAdapter {
  readonly venue = "AZURO";

  private async fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: { "user-agent": UA, accept: "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`azuro api ${res.status} (${new URL(url).pathname})`);
    return (await res.json()) as T;
  }

  async fetchMarkets(limit = 30): Promise<VenueMarket[]> {
    // 1) Prematch games, soonest first (sports shape = shortest closes matter).
    const perPage = Math.min(50, Math.max(10, limit));
    const page = await this.fetchJson<AzuroGamesPage>(
      `${AZURO_BASE}/market-manager/games-by-filters?environment=${AZURO_ENVIRONMENT}&gameState=Prematch&orderBy=StartsAt&orderDirection=Asc&perPage=${perPage}&page=1`,
    );
    const games = (page.games ?? []).filter((g) => g.state === "Prematch" && !!g.title);
    if (!games.length) return [];

    // 2) Conditions per game — paced, one batch call (the SDK does the same).
    await new Promise((r) => setTimeout(r, FEED_SPACING_MS));
    const gameIds = games.map((g) => String(g.gameId ?? g.id ?? "")).filter(Boolean).slice(0, 25);
    const body = await this.fetchJson<AzuroConditionsResponse>(
      `${AZURO_BASE}/market-manager/conditions-by-game-ids`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameIds, environment: AZURO_ENVIRONMENT, extended: false }),
      },
    );
    return mapAzuroFeed(games, body.conditions ?? [], limit);
  }

  // Paper venue orders are resolvable locally; the V3 write path is out of
  // scope until the Phase 7 gates + fixtures + founder authorization. The
  // honest answer for reconciliation inputs is NOT_FOUND.
  async queryOrderState(_venueOrderId: string): Promise<{ state: OrderStateGuess } | null> {
    return { state: "NOT_FOUND" };
  }

  async placeOrder(_req: LiveOrderRequest): Promise<LiveOrderOutcome> {
    // Hard block by design (B10): only POLYMARKET carries a live write path,
    // and even that is behind the DRY-RUN send armor until the founder arms.
    throw new Error("LIVE_TRADING_DISABLED: Azuro write path does not exist; paper mode only");
  }
}

export const azuro = new AzuroAdapter();
