// Aggregated overview for the single-page dashboard.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await db.user.findUnique({ where: { email: "founder@faida.local" } });
  if (!user) return NextResponse.json({ error: "not seeded" }, { status: 503 });

  const [robots, lastLedger, orders, positions, traces, notifications, marketCount, providers, riskRows, wallet, outboxPending] =
    await Promise.all([
      db.robot.findMany({ orderBy: { createdAt: "asc" } }),
      db.ledgerEntry.findMany({ where: { userId: user.id, mode: "PAPER" }, orderBy: { createdAt: "desc" }, take: 1 }),
      db.order.findMany({
        where: { userId: user.id, mode: "PAPER" },
        orderBy: { createdAt: "desc" },
        take: 12,
        include: { market: { select: { question: true } } },
      }),
      db.position.findMany({
        where: { status: "OPEN" },
        include: { market: { select: { question: true, yesPriceCents: true } }, robot: { select: { name: true } } },
        orderBy: { openedAt: "desc" },
      }),
      db.decisionTrace.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { robot: { select: { name: true } }, market: { select: { question: true } } },
      }),
      db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8 }),
      db.market.count({ where: { resolvedAt: null } }),
      db.aiProvider.findMany({ orderBy: { priority: "asc" } }),
      db.riskConfig.findMany({ where: { OR: [{ scope: "PLATFORM" }, { userId: user.id }] } }),
      db.wallet.findFirst({ where: { userId: user.id } }),
      db.outboxEvent.count({ where: { status: "PENDING" } }),
    ]);

  // exposure + daily P&L (paper)
  const exposure = positions.reduce((a, p) => a + p.sizeCents, 0);
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const todayEntries = await db.ledgerEntry.findMany({
    where: { userId: user.id, mode: "PAPER", createdAt: { gte: startOfDay }, type: { in: ["FILL", "FEE", "SETTLEMENT"] } },
  });
  const balance = lastLedger[0]?.balanceAfterCents ?? 0;

  const mask = (k: string | null) => (k ? (k.length <= 8 ? "••••" : `${k.slice(0, 4)}••••${k.slice(-4)}`) : null);

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, country: user.country },
    wallet: wallet ? { address: wallet.address, signingModel: wallet.signingModel } : null,
    balanceCents: balance,
    exposureCents: exposure,
    exposureLimitPct: riskRows.find((r) => r.key === "PER_EVENT_EXPOSURE_PCT" && r.scope === "USER")?.valueNum ?? 40,
    allocatedCents: robots.reduce((a, r) => a + r.allocatedCents, 0),
    todayFlowCents: todayEntries.reduce((a, e) => a + e.amountCents, 0),
    robots,
    orders,
    positions,
    traces,
    notifications,
    marketCount,
    outboxPending,
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      model: p.model,
      enabled: p.enabled,
      priority: p.priority,
      keyMasked: mask(p.apiKey),
      hasKey: !!p.apiKey,
      monthlyBudgetCents: p.monthlyBudgetCents,
      spentCents: p.spentCents,
      baseUrl: p.baseUrl,
    })),
    risk: riskRows.map((r) => ({ scope: r.scope, key: r.key, valueNum: r.valueNum })),
  });
}
