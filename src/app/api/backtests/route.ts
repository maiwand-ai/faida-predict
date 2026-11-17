// A-05 — Backtest API: run a replay of a strategy version over recorded
// ticks with the fill model, and list/read runs (B10 live-gate evidence).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runBacktest } from "@/lib/engine/backtest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const robotId = url.searchParams.get("robotId");
  if (id) {
    const run = await db.backtestRun.findUnique({
      where: { id },
      include: { robot: { select: { name: true } }, market: { select: { question: true } } },
    });
    if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
    return NextResponse.json({
      id: run.id,
      status: run.status,
      params: JSON.parse(run.params),
      stats: JSON.parse(run.stats),
      curve: JSON.parse(run.equityCurve),
      trades: JSON.parse(run.trades),
      tickCount: run.tickCount,
      dataSource: run.dataSource,
      createdAt: run.createdAt,
      robotName: run.robot.name,
      marketQuestion: run.market.question,
    });
  }
  const where = robotId ? { robotId } : {};
  const runs = await db.backtestRun.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 12,
    include: { robot: { select: { name: true } }, market: { select: { question: true } } },
  });
  return NextResponse.json({
    runs: runs.map((r) => ({
      id: r.id,
      robotName: r.robot.name,
      marketQuestion: r.market.question,
      stats: JSON.parse(r.stats),
      dataSource: r.dataSource,
      tickCount: r.tickCount,
      createdAt: r.createdAt,
    })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    robotId?: string;
    marketId?: string;
    versionId?: string;
    slippageCents?: number;
    feeBps?: number;
    perTradeCents?: number;
    minEdgePts?: number;
    holdTicksMax?: number;
  };
  if (!body.robotId) return NextResponse.json({ error: "robotId required" }, { status: 400 });

  const robot = await db.robot.findUnique({ where: { id: body.robotId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!robot) return NextResponse.json({ error: "robot not found" }, { status: 404 });
  const version = body.versionId
    ? await db.strategyVersion.findUnique({ where: { id: body.versionId } })
    : robot.versions[0] ?? null;
  if (!version || version.robotId !== robot.id) {
    return NextResponse.json({ ok: false, error: "no strategy version available — create one first" }, { status: 422 });
  }

  // market: explicit, else the most liquid tradeable market ON THE ROBOT'S
  // VENUE (B11 — evidence must name the venue it belongs to; a cross-venue
  // replay would be meaningless for the robot being evaluated). Among venue
  // candidates, prefer one with enough recorded history (A-05 needs ≥20 ticks)
  // so a default backtest runs instead of failing on an empty book of ticks.
  let market = body.marketId
    ? await db.market.findUnique({ where: { id: body.marketId } })
    : null;
  if (!market) {
    const candidates = await db.market.findMany({
      where: { venue: robot.venue, ambiguityFlag: false, resolvedAt: null, yesPriceCents: { not: null } },
      orderBy: { volumeCents: "desc" },
      take: 6,
    });
    const counts = candidates.length
      ? await db.marketPriceTick.groupBy({
          by: ["marketId"],
          _count: true,
          where: { marketId: { in: candidates.map((c) => c.id) } },
        })
      : [];
    const countMap = new Map(counts.map((c) => [c.marketId, c._count]));
    market =
      candidates.find((c) => (countMap.get(c.id) ?? 0) >= 20) ?? candidates[0] ?? null;
  }
  if (!market) return NextResponse.json({ ok: false, error: `no tradeable market available on ${robot.venue} for this backtest` }, { status: 422 });

  try {
    const result = await runBacktest(robot.id, market.id, version.id, {
      slippageCents: body.slippageCents,
      feeBps: body.feeBps,
      perTradeCents: body.perTradeCents,
      minEdgePts: body.minEdgePts,
      holdTicksMax: body.holdTicksMax,
    });
    return NextResponse.json({ ok: true, ...result, robotName: robot.name, version: version.version });
  } catch (e) {
    const msg = String(e).replace(/^Error: /, "");
    await db.backtestRun.create({
      data: {
        robotId: robot.id,
        strategyVersionId: version.id,
        marketId: market.id,
        status: "FAILED",
        params: "{}",
        stats: "{}",
        equityCurve: "[]",
        trades: "[]",
        dataSource: "SYNTHETIC",
      },
    }).catch(() => undefined);
    return NextResponse.json({ ok: false, error: msg }, { status: 422 });
  }
}
