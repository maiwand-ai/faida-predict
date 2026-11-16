// Seed the walking skeleton: founder account, paper deposit, three robots,
// risk config, eligibility matrix, AI provider slots. Idempotent via upserts.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const SEED_MATRIX: Array<{ country: string; allowed: boolean; reason?: string; source: string }> = [
  { country: "NL", allowed: true, source: "PLATFORM" },
  { country: "DE", allowed: true, source: "PLATFORM" },
  { country: "PT", allowed: true, source: "PLATFORM" },
  { country: "ES", allowed: true, source: "PLATFORM" },
  { country: "IT", allowed: true, source: "PLATFORM" },
  { country: "PL", allowed: true, source: "PLATFORM" },
  { country: "RO", allowed: true, source: "PLATFORM" },
  { country: "GB", allowed: true, source: "PLATFORM" },
  { country: "BR", allowed: true, source: "PLATFORM" },
  { country: "MX", allowed: true, source: "PLATFORM" },
  { country: "NG", allowed: true, source: "PLATFORM" },
  { country: "IN", allowed: true, source: "PLATFORM" },
  { country: "JP", allowed: true, source: "PLATFORM" },
  { country: "VN", allowed: true, source: "PLATFORM" },
  { country: "AE", allowed: true, source: "PLATFORM" },
  { country: "US", allowed: false, reason: "Polymarket venue restriction for US persons [VERIFY]", source: "VENUE" },
  { country: "FR", allowed: false, reason: "Regulator action against event-contract venue [VERIFY]", source: "VENUE" },
  { country: "BE", allowed: false, reason: "Venue geo-block [VERIFY]", source: "VENUE" },
  { country: "SG", allowed: false, reason: "Gambling regulation block [VERIFY]", source: "VENUE" },
  { country: "TH", allowed: false, reason: "Venue geo-block [VERIFY]", source: "VENUE" },
  { country: "IR", allowed: false, reason: "Sanctioned jurisdiction (OFAC/EU) — not editable", source: "SANCTION_LIST" },
  { country: "KP", allowed: false, reason: "Sanctioned jurisdiction (OFAC/EU) — not editable", source: "SANCTION_LIST" },
  { country: "CU", allowed: false, reason: "Sanctioned jurisdiction (OFAC/EU) — not editable", source: "SANCTION_LIST" },
  { country: "SY", allowed: false, reason: "Sanctioned jurisdiction (OFAC/EU) — not editable", source: "SANCTION_LIST" },
];

const ROBOTS = [
  {
    name: "Senate Edge",
    family: "PROBABILITY_EDGE",
    status: "PAPER_ONLY",
    allocatedCents: 200000,
    maxPositionCents: 20000,
    maxOpenPositions: 4,
    config: { entryRule: "edge>=8pts", exitPolicy: "edge_disappears_or_adverse_info", schedule: "continuous" },
  },
  {
    name: "MM-Elections",
    family: "MARKET_MAKING",
    status: "PAPER_ONLY",
    allocatedCents: 150000,
    maxPositionCents: 15000,
    maxOpenPositions: 6,
    config: { spreadTargetCents: 2, refreshMs: 5000, schedule: "continuous" },
  },
  {
    name: "Fed Path Research",
    family: "AI_RESEARCH",
    status: "PAUSED_BY_USER",
    statusReason: "paused by user — pending AI key configuration",
    allocatedCents: 100000,
    maxPositionCents: 10000,
    maxOpenPositions: 3,
    config: { estimator: "AI_OR_HEURISTIC", evidenceRequired: true },
  },
];

async function main(): Promise<void> {
  const user =
    (await db.user.findUnique({ where: { email: "founder@faida.local" } })) ??
    (await db.user.create({ data: { email: "founder@faida.local", name: "Founder", country: "NL" } }));

  if ((await db.wallet.count({ where: { userId: user.id } })) === 0) {
    await db.wallet.create({
      data: {
        userId: user.id,
        address: "0xDEMO0000000000000000000000000000000fA1DA",
        label: "Founder safe (demo address — connect real wallet before Phase 7)",
      },
    });
  }

  // P-02: paper ledger opening deposit
  if ((await db.ledgerEntry.count({ where: { userId: user.id, type: "DEPOSIT" } })) === 0) {
    await db.ledgerEntry.create({
      data: {
        userId: user.id,
        mode: "PAPER",
        type: "DEPOSIT",
        amountCents: 1000000,
        balanceAfterCents: 1000000,
        memo: "Paper trading account opening balance ($10,000.00)",
      },
    });
  }

  for (const r of ROBOTS) {
    const existing = await db.robot.findFirst({ where: { userId: user.id, name: r.name } });
    const robot =
      existing ??
      (await db.robot.create({
        data: {
          userId: user.id,
          name: r.name,
          family: r.family,
          status: r.status,
          statusReason: r.statusReason ?? null,
          paperMode: true,
          allocatedCents: r.allocatedCents,
          maxPositionCents: r.maxPositionCents,
          maxOpenPositions: r.maxOpenPositions,
        },
      }));
    const hasVersion = await db.strategyVersion.findFirst({ where: { robotId: robot.id, version: 1 } });
    if (!hasVersion) {
      await db.strategyVersion.create({
        data: { robotId: robot.id, version: 1, config: JSON.stringify(r.config) },
      });
    }
  }

  // two-tier risk config (B5): platform ceilings + user defaults
  const platformDefaults: Record<string, number> = {
    DAILY_LOSS_STOP_PCT: 20,
    DRAWDOWN_STOP_PCT: 30,
    PER_EVENT_EXPOSURE_PCT: 50,
    AI_MONTHLY_BUDGET_CENTS: 20000,
  };
  const userDefaults: Record<string, number> = {
    DAILY_LOSS_STOP_PCT: 5,
    DRAWDOWN_STOP_PCT: 10,
    PER_EVENT_EXPOSURE_PCT: 40,
    AI_MONTHLY_BUDGET_CENTS: 10000,
  };
  for (const [key, valueNum] of Object.entries(platformDefaults)) {
    const exists = await db.riskConfig.findFirst({ where: { scope: "PLATFORM", key } });
    if (!exists) await db.riskConfig.create({ data: { scope: "PLATFORM", key, valueNum } });
  }
  for (const [key, valueNum] of Object.entries(userDefaults)) {
    const exists = await db.riskConfig.findFirst({ where: { scope: "USER", userId: user.id, key } });
    if (!exists) await db.riskConfig.create({ data: { scope: "USER", userId: user.id, key, valueNum } });
  }

  for (const rule of SEED_MATRIX) {
    await db.eligibilityRule.upsert({
      where: { country: rule.country },
      update: { allowed: rule.allowed, reason: rule.reason ?? null, source: rule.source },
      create: { country: rule.country, allowed: rule.allowed, reason: rule.reason ?? null, source: rule.source },
    });
  }

  // AI provider slots (A-06) — empty until the founder adds a key
  const providers = [
    { name: "GLM", model: "glm-4.6", priority: 10 },
    { name: "OPENAI", model: "gpt-4o-mini", priority: 20 },
    { name: "ANTHROPIC", model: "claude-sonnet-4-20250514", priority: 30 },
    { name: "OPENAI_COMPATIBLE", model: "", priority: 40 },
  ];
  for (const p of providers) {
    await db.aiProvider.upsert({ where: { name: p.name }, update: {}, create: { ...p, enabled: false } });
  }

  if ((await db.notification.count({ where: { userId: user.id } })) === 0) {
    await db.notification.create({
      data: {
        userId: user.id,
        severity: "INFO",
        family: "SYSTEM",
        title: "Walking skeleton initialized",
        body: "Paper mode only. Live trading stays disabled until the Phase 7 gates pass and you explicitly authorize it.",
      },
    });
  }

  console.log("seed complete:", { userId: user.id, robots: ROBOTS.length, matrix: SEED_MATRIX.length });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
