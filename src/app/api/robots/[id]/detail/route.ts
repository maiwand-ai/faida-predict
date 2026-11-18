// Phase 11 (redesign ratification) — per-robot detail payload for the Robot
// detail screen. Everything the workspace needs in ONE request, all of it
// ledger-driven — nothing on the screen is mock:
//   robot identity + risk caps (Robot row)
//   open positions with the same paper-mark P&L formula as the risk engine
//   recent orders + decision traces (A-08) scoped to this robot
//   the B10 edge gate report (Path to live trading, real checks)
//   a realized paper-flow series bucketed per UTC day from the P-02 ledger
//     (FILL debits + FEE debits + SETTLEMENT credits attributed to this
//     robot's orders via LedgerEntry.refId → Order.id). Cumulative net of
//     that series IS the robot's realized paper P&L curve — open marks are
//     reported separately and never smeared into history.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveAuth } from "@/lib/auth";
import { edgeGateReport } from "@/lib/probability/edgeGate";

export const dynamic = "force-dynamic";

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

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = auth.ctx.user;
  const { id } = await ctx.params;

  const robot = await db.robot.findUnique({ where: { id } });
  if (!robot) return NextResponse.json({ error: "robot not found" }, { status: 404 });
  // Phase 10 scoping: members read their own robots; the operator may read any.
  if (user.role !== "OPERATOR" && robot.userId !== user.id) {
    return NextResponse.json({ error: "not your robot" }, { status: 403 });
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30); // flow window: 30 days
  cutoff.setUTCHours(0, 0, 0, 0);

  const [positions, orders, traces, gate, robotOrders, lastLedger] = await Promise.all([
    db.position.findMany({
      where: { robotId: id, status: "OPEN" },
      include: {
        market: { select: { question: true, venue: true, yesPriceCents: true, noPriceCents: true, eventKey: true } },
      },
      orderBy: { openedAt: "desc" },
    }),
    db.order.findMany({
      where: { robotId: id },
      include: { market: { select: { question: true, venue: true } } },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    db.decisionTrace.findMany({
      where: { robotId: id },
      include: { market: { select: { question: true, venue: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    edgeGateReport(id),
    // order ids feed the ledger join below; scoped to the flow window is not
    // possible on Order (the ledger entry carries the timestamp), so take the
    // robot's full order id set — bounded by platform volume.
    db.order.findMany({ where: { robotId: id }, select: { id: true } }),
    db.ledgerEntry.findFirst({ where: { userId: user.id, mode: "PAPER" }, orderBy: { createdAt: "desc" }, select: { balanceAfterCents: true } }),
  ]);

  // Realized paper flow per UTC day, attributed to THIS robot via its orders.
  const orderIds = robotOrders.map((o) => o.id);
  const ledger = orderIds.length
    ? await db.ledgerEntry.findMany({
        where: { userId: user.id, mode: "PAPER", type: { in: ["FILL", "FEE", "SETTLEMENT"] }, refId: { in: orderIds }, createdAt: { gte: cutoff } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const byDay = new Map<string, { fill: number; fee: number; settle: number; net: number }>();
  for (const e of ledger) {
    const day = e.createdAt.toISOString().slice(0, 10);
    const b = byDay.get(day) ?? { fill: 0, fee: 0, settle: 0, net: 0 };
    if (e.type === "FILL") { b.fill += -e.amountCents; } // buying is not realized P&L
    else if (e.type === "FEE") { b.fee += -e.amountCents; b.net += e.amountCents; }
    else { b.settle += e.amountCents; b.net += e.amountCents; }
    byDay.set(day, b);
  }

  // dense day axis from cutoff → today so the chart never skips calendar days
  const flow: Array<{ day: string; fillCents: number; feeCents: number; settleCents: number; netCents: number; cumCents: number }> = [];
  let cum = 0;
  for (let d = new Date(cutoff); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const b = byDay.get(day);
    cum += b?.net ?? 0;
    flow.push({ day, fillCents: b?.fill ?? 0, feeCents: b?.fee ?? 0, settleCents: b?.settle ?? 0, netCents: b?.net ?? 0, cumCents: cum });
  }

  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const todayNet = flow.find((f) => f.day === startOfToday.toISOString().slice(0, 10))?.netCents ?? 0;
  const unrealized = positions.reduce((a, p) => a + (positionPnl(p) ?? 0), 0);
  const anyUnmarkable = positions.some((p) => positionPnl(p) === null);

  return NextResponse.json({
    robot: {
      id: robot.id,
      name: robot.name,
      family: robot.family,
      venue: robot.venue,
      status: robot.status,
      statusReason: robot.statusReason,
      paperMode: robot.paperMode,
      mode: robot.mode,
      allocatedCents: robot.allocatedCents,
      maxPositionCents: robot.maxPositionCents,
      maxOpenPositions: robot.maxOpenPositions,
      dailyLossStopPct: robot.dailyLossStopPct,
      drawdownStopPct: robot.drawdownStopPct,
      activeVersion: robot.activeVersion,
      createdAt: robot.createdAt.toISOString(),
    },
    positions: positions.map((p) => ({ ...p, unrealizedCents: positionPnl(p) })),
    orders,
    traces,
    gate,
    flow,
    todayNetCents: todayNet,
    unrealizedCents: positions.length === 0 ? null : anyUnmarkable ? null : unrealized,
    balanceCents: lastLedger?.balanceAfterCents ?? 0,
  });
}
