// Aggregated overview for the single-page dashboard.
// Phase 10: request-scoped auth — robots/positions/traces scope to the acting
// user; market counts and platform state stay shared.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getAutopilotState, getPauseState } from "@/lib/control";
import { ensureAutopilotTimer } from "@/lib/engine/autopilot";
import { VENUES } from "@/lib/venues";
import { resolveAuth } from "@/lib/auth";

// Unrealized P/L for one open position, mark-to-market on the venue's last
// synced price. SAME formula as the risk engine (src/lib/risk.ts) so the
// dashboard can never disagree with the risk checks.
function positionPnl(p: {
  side: string;
  sizeCents: number;
  avgPriceCents: number;
  market: { yesPriceCents: number | null; noPriceCents: number | null };
}): number | null {
  const current = p.side === "YES" ? p.market.yesPriceCents : p.market.noPriceCents;
  if (current == null || p.avgPriceCents <= 0) return null;
  return Math.round(((current - p.avgPriceCents) / p.avgPriceCents) * p.sizeCents);
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = auth.ctx.user;
  await ensureAutopilotTimer(); // self-heal the loop after a process restart

  const [robots, lastLedger, orders, positions, traces, notifications, marketCount, providers, riskRows, wallet, outboxPending, pause, autopilot, marketGroups, openAlerts] =
    await Promise.all([
      db.robot.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
      db.ledgerEntry.findMany({ where: { userId: user.id, mode: "PAPER" }, orderBy: { createdAt: "desc" }, take: 1 }),
      db.order.findMany({
        where: { userId: user.id, mode: "PAPER" },
        orderBy: { createdAt: "desc" },
        take: 12,
        include: { market: { select: { question: true, venue: true } } },
      }),
      db.position.findMany({
        where: { status: "OPEN", robot: { userId: user.id } },
        include: {
          market: { select: { question: true, venue: true, yesPriceCents: true, noPriceCents: true, eventKey: true } },
          robot: { select: { name: true } },
        },
        orderBy: { openedAt: "desc" },
      }),
      db.decisionTrace.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        where: { robot: { userId: user.id } },
        include: { robot: { select: { name: true } }, market: { select: { question: true, venue: true } } },
      }),
      db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8 }),
      db.market.count({ where: { resolvedAt: null } }),
      db.aiProvider.findMany({ orderBy: { priority: "asc" } }),
      db.riskConfig.findMany({ where: { OR: [{ scope: "PLATFORM" }, { userId: user.id }] } }),
      db.wallet.findFirst({ where: { userId: user.id } }),
      db.outboxEvent.count({ where: { status: "PENDING" } }),
      getPauseState(),
      getAutopilotState(),
      db.market.groupBy({ by: ["venue"], where: { resolvedAt: null }, _count: { venue: true } }),
      db.notification.count({ where: { userId: user.id, severity: { in: ["CRITICAL", "WARNING"] } } }),
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

  // Per-venue rollup (B9/B11): the venue grid on the dashboard is driven by
  // the registry so a venue can never appear or vanish from the UI by accident.
  const venues = VENUES.map((v) => {
    const vPositions = positions.filter((p) => p.market.venue === v.id);
    const vRobots = robots.filter((r) => r.venue === v.id);
    return {
      venue: v.id,
      markets: marketGroups.find((g) => g.venue === v.id)?._count.venue ?? 0,
      robotsTotal: vRobots.length,
      robotsActive: vRobots.filter((r) => r.status === "RUNNING").length,
      openPositions: vPositions.length,
      exposureCents: vPositions.reduce((a, p) => a + p.sizeCents, 0),
      unrealizedCents: vPositions.reduce((a, p) => a + (positionPnl(p) ?? 0), 0),
    };
  });

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, country: user.country },
    wallet: wallet ? { address: wallet.address, signingModel: wallet.signingModel } : null,
    balanceCents: balance,
    exposureCents: exposure,
    exposureLimitPct: riskRows.find((r) => r.key === "PER_EVENT_EXPOSURE_PCT" && r.scope === "USER")?.valueNum ?? 40,
    allocatedCents: robots.reduce((a, r) => a + r.allocatedCents, 0),
    todayFlowCents: todayEntries.reduce((a, e) => a + e.amountCents, 0),
    openAlerts,
    venues,
    robots,
    orders,
    positions: positions.map((p) => ({ ...p, unrealizedCents: positionPnl(p) })),
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
    control: { pause, autopilot },
  });
}
