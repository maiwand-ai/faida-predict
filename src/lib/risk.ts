// C10 / B5 — Two-tier risk configuration.
// PLATFORM rows are founder-set maximums; USER/ROBOT rows may only be stricter.
import { db } from "@/lib/db";

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

// Ordered pre-trade checks (the report's C10 order). Every check is worded,
// never silent — D-04.
export async function preTradeRiskChecks(params: {
  userId: string;
  robot: { id: string; allocatedCents: number; maxPositionCents: number; maxOpenPositions: number; dailyLossStopPct: number; drawdownStopPct: number; status: string; paperMode: boolean };
  marketId: string;
  sizeCents: number;
  balanceCents: number;
}): Promise<RiskCheckResult[]> {
  const { robot, sizeCents, balanceCents } = params;
  const effective = await getEffectiveRisk(params.userId);
  const checks: RiskCheckResult[] = [];

  checks.push({
    check: "robot_state",
    passed: ["RUNNING", "PAPER_ONLY"].includes(robot.status),
    detail: `robot status ${robot.status}`,
  });
  checks.push({
    check: "balance_sufficient",
    passed: sizeCents <= balanceCents,
    detail: `order ${sizeCents}¢ vs balance ${balanceCents}¢`,
  });
  checks.push({
    check: "max_position_cap",
    passed: sizeCents <= robot.maxPositionCents,
    detail: `order ${sizeCents}¢ ≤ cap ${robot.maxPositionCents}¢`,
  });

  const openCount = await db.position.count({ where: { robotId: robot.id, status: "OPEN" } });
  checks.push({
    check: "max_open_positions",
    passed: openCount < robot.maxOpenPositions,
    detail: `${openCount} open < limit ${robot.maxOpenPositions}`,
  });

  const perMarket = await db.position.aggregate({
    where: { robotId: robot.id, marketId: params.marketId, status: "OPEN" },
    _sum: { sizeCents: true },
  });
  const marketExposure = (perMarket._sum.sizeCents ?? 0) + sizeCents;
  const eventCap = Math.floor((robot.allocatedCents * effective.perEventExposurePct) / 100);
  checks.push({
    check: "per_event_exposure",
    passed: marketExposure <= eventCap,
    detail: `cluster exposure ${marketExposure}¢ ≤ ${effective.perEventExposurePct}% of allocation (${eventCap}¢)`,
  });

  // Daily loss = realized settlement losses today + mark-to-market on open
  // positions (paper book prices). Cash outflows on fills are NOT losses.
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

  return checks;
}
