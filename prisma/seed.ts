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

  // Phase 5 (A-01/A-03): the model registry. The baseline heuristic is the
  // floor every model must beat; the keyless GLM slot registers as a CANDIDATE
  // that must earn promotion through calibration evidence. An unproven model
  // never drives decisions — that is the Phase 5 hardening contract.
  const { BASELINE_KEY } = { BASELINE_KEY: "heuristic-contrarian-v1" }; // keep seed standalone (mirrors src/lib/probability/baseline.ts)
  await db.probabilityModel.upsert({
    where: { key: BASELINE_KEY },
    update: {},
    create: {
      key: BASELINE_KEY,
      kind: "HEURISTIC",
      status: "ACTIVE",
      notes: "A-03 baseline (v1): est = clamp(p + round((50 − p) × 25 / 100), 2, 98) — contrarian fade toward 50; recorded in DECISIONS.md",
    },
  });
  for (const p of providers) {
    if (p.name === "OPENAI_COMPATIBLE") continue; // no concrete model until configured
    await db.probabilityModel.upsert({
      where: { key: `ai:${p.name}/${p.model}` },
      update: {},
      create: {
        key: `ai:${p.name}/${p.model}`,
        kind: "AI",
        providerName: p.name,
        providerModel: p.model,
        status: "CANDIDATE",
        notes: "registered from the provider lineup — accumulates calibration evidence; promotion is a founder action (B8)",
      },
    });
  }
  await db.platformControl.upsert({
    where: { key: "MODEL_BASELINE" },
    update: {},
    create: {
      key: "MODEL_BASELINE",
      value: JSON.stringify({
        key: BASELINE_KEY,
        version: 1,
        formula: "est = clamp(p + round((50 - p) * tilt / 100), 2, 98) — contrarian fade of the YES book toward 50%",
        tiltPct: 25,
        kind: "HEURISTIC",
        recordedIn: "DECISIONS.md (A-03 baseline definition, Phase 5)",
      }),
    },
  });
  await db.platformControl.upsert({
    where: { key: "MODEL_KNOBS" },
    update: {},
    create: { key: "MODEL_KNOBS", value: JSON.stringify({ minSamples: 30, promotionMarginPct: 5, demotionTolerancePct: 5 }) },
  });
  await db.platformControl.upsert({
    where: { key: "AI_CACHE_TTL_S" },
    update: {},
    create: { key: "AI_CACHE_TTL_S", value: JSON.stringify(21600) }, // 6 h
  });

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

  // A-05 recorder: SYNTHETIC-labeled tick history for the top tradeable markets,
  // so backtests work immediately (live syncs and cycles append real ticks).
  // Deterministic walk (seeded RNG) around each market's current price —
  // clearly labeled SYNTHETIC, never passed off as live data (D-03).
  const tickMarkets = await db.market.findMany({
    where: {
      ambiguityFlag: false,
      resolvedAt: null,
      yesPriceCents: { gte: 2, lte: 98 },
      noPriceCents: { gte: 2, lte: 98 },
    },
    orderBy: { volumeCents: "desc" },
    take: 3,
  });
  let seededTicks = 0;
  for (const m of tickMarkets) {
    const existing = await db.marketPriceTick.count({ where: { marketId: m.id } });
    if (existing >= 100) continue; // already has history (live or prior seed)
    let state = 42 + m.venueSymbol.length; // deterministic per-market seed
    const rand = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const anchor = m.yesPriceCents ?? 50;
    let yes = anchor;
    const base = new Date(Date.now() - 120 * 5 * 60 * 1000);
    const rows: Array<{ marketId: string; yesCents: number; noCents: number; source: string; capturedAt: Date }> = [];
    for (let i = 0; i < 120; i++) {
      // mean-reverting walk with small drift toward the anchor
      const pull = (anchor - yes) * 0.12;
      const shock = (rand() - 0.5) * 6;
      yes = Math.max(2, Math.min(98, Math.round(yes + pull + shock)));
      const no = Math.max(2, Math.min(98, 100 - yes + (rand() < 0.3 ? 1 : 0)));
      rows.push({
        marketId: m.id,
        yesCents: yes,
        noCents: no,
        source: "SYNTHETIC",
        capturedAt: new Date(base.getTime() + i * 5 * 60 * 1000),
      });
    }
    await db.marketPriceTick.createMany({ data: rows });
    seededTicks += rows.length;
  }

  console.log("seed complete:", { userId: user.id, robots: ROBOTS.length, matrix: SEED_MATRIX.length, syntheticTicks: seededTicks });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
