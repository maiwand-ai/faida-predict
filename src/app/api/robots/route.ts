// Robots: create (Robot Studio wizard) and status transitions (C26 states).
// Phase 10: request-scoped auth (session cookie; founder fallback outside
// strict mode) + per-user ownership on mutations + RobotSession recording
// (exit-bar item 8: member sessions are MEASURED at creation time).
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { enqueueOutbox } from "@/lib/outbox";
import { notifyUser } from "@/lib/notifications";
import { isVenue, isLiveVenue, VENUE_IDS, VENUE_LABEL } from "@/lib/venues";
import { resolveAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const FAMILIES = ["PROBABILITY_EDGE", "MARKET_MAKING", "AI_RESEARCH", "ARBITRAGE"];
const STATUS_TRANSITIONS: Record<string, string[]> = {
  RUNNING: ["PAUSED_BY_USER", "PAUSED_BY_RISK", "STOPPED", "ERROR"],
  PAPER_ONLY: ["PAUSED_BY_USER", "STOPPED", "RUNNING"],
  PAUSED_BY_USER: ["PAPER_ONLY", "STOPPED"],
  PAUSED_BY_RISK: ["PAPER_ONLY", "STOPPED"], // resuming a risk pause requires review: explicit user action
  ERROR: ["PAPER_ONLY", "STOPPED"],
  STOPPED: [],
};

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = auth.ctx.user;
  const robots = await db.robot.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: { versions: { orderBy: { version: "desc" }, take: 3 } },
  });
  return NextResponse.json({ robots });
}

export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = auth.ctx.user;
  const body = (await req.json()) as {
    name?: string;
    family?: string;
    venue?: string;
    allocatedCents?: number;
    maxPositionCents?: number;
    maxOpenPositions?: number;
    dailyLossStopPct?: number;
    drawdownStopPct?: number;
    config?: Record<string, unknown>;
    templateId?: string;
    wizard?: boolean;
  };

  if (!body.name || !body.family || !FAMILIES.includes(body.family)) {
    return NextResponse.json({ error: "name and a valid family are required" }, { status: 400 });
  }

  // B11: robots are venue-scoped. Unknown venue → 400; venue without a live
  // adapter → 422 with a pointer at the roadmap (B9) so the UI can explain why.
  const venue = body.venue ?? "POLYMARKET";
  if (!isVenue(venue)) {
    return NextResponse.json({ error: `unknown venue "${venue}" — allowed: ${VENUE_IDS.join(", ")}` }, { status: 400 });
  }
  if (!isLiveVenue(venue)) {
    return NextResponse.json(
      { error: `${VENUE_LABEL[venue]} adapter is not live yet (roadmap B9) — robots can only be scoped to venues with a live adapter` },
      { status: 422 },
    );
  }
  const allocated = Math.max(0, Math.floor(body.allocatedCents ?? 100000));
  const maxPos = Math.max(0, Math.floor(body.maxPositionCents ?? allocated / 10));
  const maxOpen = Math.max(1, Math.floor(body.maxOpenPositions ?? 4));
  // Phase 10: the creation flow IS a robot session (exit-bar item 8 counts
  // these); kind derives from how the wizard submitted the request.
  const sessionKind = body.wizard ? "WIZARD" : body.templateId ? "TEMPLATE" : "MANUAL";

  // C5: activation never happens at creation — every robot starts PAPER_ONLY.
  // Phase 7.5 hardening (B5 load finding): Robot + StrategyVersion v1 +
  // notification + outbox are ONE interactive transaction. The previous
  // four-step version left orphaned robots (no strategy version, no journal)
  // whenever SQLite write queueing pushed a later step past the 5 s default
  // transaction timeout (P2028) — a robot that can never tick, silently.
  const robot = await db.$transaction(
    async (tx) => {
      const r = await tx.robot.create({
        data: {
          userId: user.id,
          name: body.name!.slice(0, 60),
          family: body.family!,
          venue,
          status: "PAPER_ONLY",
          statusReason: "created in Robot Studio — live activation requires Phase 7 gates",
          paperMode: true,
          allocatedCents: allocated,
          maxPositionCents: Math.min(maxPos, allocated),
          maxOpenPositions: maxOpen,
          dailyLossStopPct: Math.max(1, Math.min(50, Math.floor(body.dailyLossStopPct ?? 5))),
          drawdownStopPct: Math.max(1, Math.min(60, Math.floor(body.drawdownStopPct ?? 10))),
        },
      });
      await tx.strategyVersion.create({
        data: { robotId: r.id, version: 1, config: JSON.stringify(body.config ?? {}) },
      });
      // Phase 10: the robot-session row (exit-bar item 8) is written INSIDE
      // the same transaction — atomic with the robot (no orphaned sessions,
      // same chaos-fix discipline as the strategy version) and it adds no
      // extra connection acquisition on the concurrent load path (B5).
      await tx.robotSession.create({
        data: { userId: user.id, robotId: r.id, kind: sessionKind, venue },
      });
      await enqueueOutbox(tx, [
        {
          aggregateType: "ROBOT",
          aggregateId: r.id,
          eventType: "ROBOT_STATE_CHANGED",
          payload: { userId: user.id, status: "PAPER_ONLY" },
        },
      ]);
      return r;
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
  // P-04: the creation notification goes through the taxonomy AFTER the
  // transaction commits — the wizard create stays all-or-nothing (chaos fix)
  // and a failed notification write can never roll back a created robot.
  await notifyUser(user.id, {
    family: "SYSTEM",
    title: `Robot created: ${robot.name}`,
    body: "Paper-only. Run the edge gate, backtest and paper session before requesting live activation.",
    dedupeKey: `robot-created:${robot.id}`,
  });
  return NextResponse.json({ robot });
}

export async function PATCH(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = auth.ctx.user;
  const body = (await req.json()) as { robotId?: string; status?: string };
  if (!body.robotId || !body.status) return NextResponse.json({ error: "robotId and status required" }, { status: 400 });
  const robot = await db.robot.findUnique({ where: { id: body.robotId } });
  if (!robot) return NextResponse.json({ error: "robot not found" }, { status: 404 });
  // Phase 10: members act on their own robots only; the operator may act on any.
  if (user.role !== "OPERATOR" && robot.userId !== user.id) {
    return NextResponse.json({ error: "not your robot" }, { status: 403 });
  }

  const allowed = STATUS_TRANSITIONS[robot.status] ?? [];
  if (!allowed.includes(body.status)) {
    return NextResponse.json(
      { error: `illegal status transition ${robot.status} -> ${body.status}`, allowed },
      { status: 400 },
    );
  }
  // C10: live RUNNING is gated by Phase 7 — the skeleton refuses it honestly.
  if (body.status === "RUNNING" && robot.paperMode) {
    return NextResponse.json(
      { error: "live activation refused: Phase 7 gates not passed (edge gate, backtest, paper session, explicit authorization)" },
      { status: 403 },
    );
  }
  const updated = await db.robot.update({
    where: { id: robot.id },
    data: { status: body.status, statusReason: body.status === "PAUSED_BY_USER" ? "paused by user" : null },
  });
  await db.$transaction(async (tx) => {
    await enqueueOutbox(tx, [
      {
        aggregateType: "ROBOT",
        aggregateId: robot.id,
        eventType: "ROBOT_STATE_CHANGED",
        payload: { userId: robot.userId, from: robot.status, to: body.status },
      },
    ]);
  });
  return NextResponse.json({ robot: updated });
}
