// C10 / B5 — Two-tier risk configuration.
// PLATFORM rows are founder-set maximums; USER/ROBOT rows may only be stricter.
// Phase 4 — venue structural entry rules (S-05) + A-04 event clustering:
// the engine stays venue-blind; it applies whatever the venue's rules module
// declares (src/lib/venue/rules.ts) and sums related markets via eventKey.
import { db } from "@/lib/db";
import { entryRulesFor } from "@/lib/venue/rules";

export const RISK_KEYS = {
  DAILY_LOSS_STOP_PCT: "DAILY_LOSS_STOP_PCT",
  DRAWDOWN_STOP_PCT: "DRAWDOWN_STOP_PCT",
  PER_EVENT_EXPOSURE_PCT: "PER_EVENT_EXPOSURE_PCT",
  AI_MONTHLY_BUDGET_CENTS: "AI_MONTHLY_BUDGET_CENTS",
} as const;

// Founder-set defaults (B5 table from the report; ships as config, not code).
export const PLATFORM_DEFAULTS: Record<string, number> = {
  DAILY_LOSS_STOP_PCT: 20, // platform ceiling; users default stricter (5)
  DRAWDOWN_STOP_PCT: 30, // ceiling; user default 10
  PER_EVENT_EXPOSURE_PCT: 50, // ceiling; user default 40
  AI_MONTHLY_BUDGET_CENTS: 20000, // ceiling; user default 10000 ($100)
};

export const USER_DEFAULTS: Record<string, number> = {
  DAILY_LOSS_STOP_PCT: 5,
  DRAWDOWN_STOP_PCT: 10,
  PER_EVENT_EXPOSURE_PCT: 40,
  AI_MONTHLY_BUDGET_CENTS: 10000,
};

export interface EffectiveRisk {
  dailyLossStopPct: number;
  drawdownStopPct: number;
  perEventExposurePct: number;
  aiMonthlyBudgetCents: number;
}

export async function getPlatformMax(key: string): Promise<number> {
  const row = await db.riskConfig.findFirst({ where: { scope: "PLATFORM", key } });
  return row?.valueNum ?? PLATFORM_DEFAULTS[key] ?? 0;
}

export async function getEffectiveRisk(userId: string): Promise<EffectiveRisk> {
  const rows = await db.riskConfig.findMany({ where: { userId } });
  const userVals = new Map(rows.filter((r) => r.scope === "USER").map((r) => [r.key, r.valueNum]));
  const robotVals = new Map(rows.filter((r) => r.scope === "ROBOT").map((r) => [r.key, r.valueNum]));
  const pick = (key: string, userDefault: number) => {
    const platformMax = PLATFORM_DEFAULTS[key] ?? 100;
    const robot = robotVals.get(key);
    const user = userVals.get(key);
    const chosen = robot ?? user ?? userDefault;
    return Math.min(chosen, platformMax); // may only be stricter, never looser
  };
  return {
    dailyLossStopPct: pick(RISK_KEYS.DAILY_LOSS_STOP_PCT, USER_DEFAULTS.DAILY_LOSS_STOP_PCT),
    drawdownStopPct: pick(RISK_KEYS.DRAWDOWN_STOP_PCT, USER_DEFAULTS.DRAWDOWN_STOP_PCT),
    perEventExposurePct: pick(RISK_KEYS.PER_EVENT_EXPOSURE_PCT, USER_DEFAULTS.PER_EVENT_EXPOSURE_PCT),
    aiMonthlyBudgetCents: pick(RISK_KEYS.AI_MONTHLY_BUDGET_CENTS, USER_DEFAULTS.AI_MONTHLY_BUDGET_CENTS),
  };
}

// Set a user-level limit. Silently clamps to the platform maximum (stricter-only).
export async function setUserRisk(userId: string, key: string, value: number): Promise<number> {
  const max = await getPlatformMax(key);
  const clamped = Math.max(0, Math.min(value, max));
  const existing = await db.riskConfig.findFirst({ where: { scope: "USER", userId, key } });
  if (existing) {
    await db.riskConfig.update({ where: { id: existing.id }, data: { valueNum: clamped } });
  } else {
    await db.riskConfig.create({ data: { scope: "USER", userId, key, valueNum: clamped } });
  }
  return clamped;
}

export interface RiskCheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

// Robot-scoped fields preTradeRiskChecks needs (works for the full Prisma row
// and for the cycle engine's selected shape alike).
export interface RiskRobotLike {
  id: string;
  venue: string;
  allocatedCents: number;
  maxPositionCents: number;
  maxOpenPositions: number;
  dailyLossStopPct: number;
  drawdownStopPct: number;
  status: string;
  paperMode: boolean;
}

// Ordered pre-trade checks (the report's C10 order). Every check is worded,
// never silent — D-04. `robot` is null for manual tickets: robot-scoped checks
// are skipped, but the venue's STRUCTURAL entry rules still apply — a thin
// book refuses humans and robots alike (Phase 4, S-05).
export async function preTradeRiskChecks(params: {
  userId: string;
  robot: RiskRobotLike | null;
  marketId: string;
  side: "BUY_YES" | "BUY_NO";
  sizeCents: number;
  balanceCents: number;
}): Promise<RiskCheckResult[]> {
  const { sizeCents, balanceCents } = params;
  const robot = params.robot;
  const effective = await getEffectiveRisk(params.userId);
  const checks: RiskCheckResult[] = [];

  const market = await db.market.findUnique({
    where: { id: params.marketId },
    select: {
      venue: true,
      eventKey: true,
      yesTouchDepthCents: true,
      noTouchDepthCents: true,
      closeDate: true,
    },
  });
  const venue = market?.venue ?? robot?.venue ?? "UNKNOWN";
  const rules = entryRulesFor(venue); // structural rules the venue declares

  checks.push({
    check: "robot_state",
    passed: robot ? ["RUNNING", "PAPER_ONLY"].includes(robot.status) : true, // manual ticket — B8 keeps humans in the loop
    detail: robot ? `robot status ${robot.status}` : "manual ticket (no robot)",
  });
  checks.push({
    check: "balance_sufficient",
    passed: sizeCents <= balanceCents,
    detail: `order ${sizeCents}¢ vs balance ${balanceCents}¢`,
  });
  checks.push({
    check: "max_position_cap",
    passed: robot ? sizeCents <= robot.maxPositionCents : true,
    detail: robot ? `order ${sizeCents}¢ ≤ cap ${robot.maxPositionCents}¢` : "manual ticket — robot cap n/a",
  });

  if (robot) {
    const openCount = await db.position.count({ where: { robotId: robot.id, status: "OPEN" } });
    checks.push({
      check: "max_open_positions",
      passed: openCount < robot.maxOpenPositions,
      detail: `${openCount} open < limit ${robot.maxOpenPositions}`,
    });
  }

  // ── A-04 event clustering: related markets share an eventKey, and their ──
  //    open exposure STACKS in the per-event check (complementary positions
  //    on candidates of one event can never hide apart). Without a cluster
  //    key the check degrades to the single-market sum (Phase ≤3 behavior).
  if (robot) {
    let marketExposure = 0;
    let exposureScope: string;
    if (market?.eventKey) {
      const clusterMarkets = await db.market.findMany({
        where: { eventKey: market.eventKey },
        select: { id: true },
      });
      const clusterIds = clusterMarkets.map((m) => m.id);
      const clusterSum = await db.position.aggregate({
        where: { robotId: robot.id, status: "OPEN", marketId: { in: clusterIds } },
        _sum: { sizeCents: true },
      });
      marketExposure = clusterSum._sum.sizeCents ?? 0;
      const clusterCount = new Set(
        (
          await db.position.findMany({
            where: { robotId: robot.id, status: "OPEN", marketId: { in: clusterIds } },
            select: { marketId: true },
          })
        ).map((p) => p.marketId),
      ).size;
      exposureScope = `A-04 cluster ${market.eventKey}: ${clusterCount} market${clusterCount === 1 ? "" : "s"}, open exposure ${marketExposure}¢`;
    } else {
      const perMarket = await db.position.aggregate({
        where: { robotId: robot.id, marketId: params.marketId, status: "OPEN" },
        _sum: { sizeCents: true },
      });
      marketExposure = perMarket._sum.sizeCents ?? 0;
      exposureScope = `market ${params.marketId.slice(0, 10)} open exposure ${marketExposure}¢`;
    }
    marketExposure += sizeCents;
    const eventCap = Math.floor((robot.allocatedCents * effective.perEventExposurePct) / 100);
    checks.push({
      check: "per_event_exposure",
      passed: marketExposure <= eventCap,
      detail: `${exposureScope} + this order ${sizeCents}¢ = ${marketExposure}¢ ≤ ${effective.perEventExposurePct}% of allocation (${eventCap}¢)`,
    });
  }

  // ── (c) per-market position cap — venue structural rule (LIMITLESS) ──────
  //    Market-wide across the user's robots: thin books make big exits costly.
  //    Applies to robots AND manual tickets — structural means structural.
  if (rules.perMarketPositionCapCents != null) {
    // market-wide = all the user's robot positions plus manual positions
    // on this market (linked through Robot.userId).
    const perMarketUser = await db.position.aggregate({
      where: { OR: [{ robot: { userId: params.userId } }, { userId: params.userId }], marketId: params.marketId, status: "OPEN" },
      _sum: { sizeCents: true },
    });
    const marketTotal = (perMarketUser._sum?.sizeCents ?? 0) + sizeCents;
    checks.push({
      check: "per_market_position_cap",
      passed: marketTotal <= rules.perMarketPositionCapCents,
      detail: `${venue} rule (c): market total ${marketTotal}¢ ≤ cap ${rules.perMarketPositionCapCents}¢ (all robots, this market)`,
    });
  }

  // ── (a) min-touch-depth refusal — venue structural rule (LIMITLESS) ──────
  //    The touch is the USDC notional absorbable at best ask (YES entry) or
  //    best bid complement (NO entry) at last sync. Missing book → fail-closed.
  if (rules.minTouchDepthCents != null) {
    const touchDepth = params.side === "BUY_YES" ? market?.yesTouchDepthCents : market?.noTouchDepthCents;
    checks.push({
      check: "touch_depth",
      passed: touchDepth != null && touchDepth >= rules.minTouchDepthCents,
      detail:
        touchDepth == null
          ? `${venue} rule (a): book depth unavailable for the ${params.side === "BUY_YES" ? "YES" : "NO"} touch — fail-closed, sync captured no book`
          : `${venue} rule (a): ${params.side === "BUY_YES" ? "YES" : "NO"} touch depth ${touchDepth}¢ vs minimum ${rules.minTouchDepthCents}¢`,
    });
  }

  // ── (d) close-time window — venue structural rule (AZURO, sports shape) ──
  //    Refuse entries inside the final N minutes before closeDate (kickoff);
  //    fail-closed when closeDate is missing on a venue that arms the rule.
  if (rules.minMinutesBeforeClose != null) {
    const closeMs = market?.closeDate ? new Date(market.closeDate).getTime() : null;
    const minutesLeft = closeMs != null ? (closeMs - Date.now()) / 60000 : null;
    checks.push({
      check: "close_time_window",
      passed: minutesLeft != null && minutesLeft >= rules.minMinutesBeforeClose,
      detail:
        minutesLeft == null
          ? `${venue} rule (d): close date missing — fail-closed (sports odds inside the closing window are unstable)`
          : `${venue} rule (d): ${minutesLeft.toFixed(1)} min until close vs minimum ${rules.minMinutesBeforeClose} min window`,
    });
  }

  // Daily loss = realized settlement losses today + mark-to-market on open
  // positions (paper book prices). Cash outflows on fills are NOT losses.
  if (robot) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const settlementsToday = await db.ledgerEntry.findMany({
      where: { userId: params.userId, mode: "PAPER", type: "SETTLEMENT", createdAt: { gte: startOfDay } },
    });
    const realizedToday = settlementsToday.reduce((a, e) => a + Math.min(0, e.amountCents), 0);
    const openPositions = await db.position.findMany({
      where: { robotId: robot.id, status: "OPEN" },
      include: { market: { select: { yesPriceCents: true, noPriceCents: true } } },
    });
    let unrealized = 0;
    for (const p of openPositions) {
      const current = p.side === "YES" ? p.market.yesPriceCents : p.market.noPriceCents;
      if (current != null && p.avgPriceCents > 0) {
        unrealized += Math.round(((current - p.avgPriceCents) / p.avgPriceCents) * p.sizeCents);
      }
    }
    const dailyLossCapCents = Math.floor((robot.allocatedCents * effective.dailyLossStopPct) / 100);
    const dailyLoss = Math.max(0, -(realizedToday + unrealized));
    checks.push({
      check: "daily_loss_stop",
      passed: dailyLoss < dailyLossCapCents,
      detail: `daily loss ${dailyLoss}¢ (realized ${Math.abs(Math.min(0, realizedToday))}¢ + unrealized ${Math.min(0, unrealized)}¢) / stop ${dailyLossCapCents}¢ (${effective.dailyLossStopPct}%)`,
    });
  }

  return checks;
}
