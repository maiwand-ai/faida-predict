// Phase 10 — R-0 round snapshot (BETA_PHASE75 §2). OPERATOR-ONLY.
// One call gives the round-opening picture: platform health, refusal/error
// signals, latency proxies, open defects, cohort mix, member-signal progress.
// Every number is measured — null where the platform does not record it (D-03).
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveOperator } from "@/lib/auth";
import { buildMetrics } from "@/lib/metrics";
import { getPauseState, getControl } from "@/lib/control";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const round = await getControl<number>("BETA_ROUND", 1);
  const [metrics, pause, defects, cohort, sessions, feedback] = await Promise.all([
    buildMetrics(),
    getPauseState(),
    db.betaDefect.findMany({ where: { status: "OPEN" } }),
    db.betaMember.findMany({ where: { active: true }, select: { id: true, userId: true, track: true } }),
    db.robotSession.findMany({ select: { userId: true } }),
    db.betaFeedback.findMany({ select: { userId: true, status: true } }),
  ]);

  // Exit-bar item 8 signal: % of active members with ≥3 sessions AND ≥1 feedback item.
  const sessionsByUser = new Map<string, number>();
  for (const s of sessions) sessionsByUser.set(s.userId, (sessionsByUser.get(s.userId) ?? 0) + 1);
  const feedbackUsers = new Set(feedback.map((f) => f.userId));
  const linked = cohort.filter((m) => m.userId);
  const signalMembers = linked.filter((m) => (sessionsByUser.get(m.userId!) ?? 0) >= 3 && feedbackUsers.has(m.userId!));

  const openBySeverity: Record<string, number> = { S0: 0, S1: 0, S2: 0, S3: 0 };
  for (const d of defects) openBySeverity[d.severity] = (openBySeverity[d.severity] ?? 0) + 1;

  return NextResponse.json({
    round,
    generatedAt: new Date().toISOString(),
    platform: {
      globalPause: pause,
      outbox: metrics.outbox,
      notifications24h: metrics.notifications24h,
      orders24h: metrics.orders24h,
      decisions: metrics.decisions,
      ai: metrics.ai,
      marketFreshness: metrics.markets.freshness,
    },
    defects: { openTotal: defects.length, openBySeverity },
    cohort: {
      activeMembers: cohort.length,
      registered: linked.length,
      trackMix: {
        PAPER_ONLY: cohort.filter((m) => m.track === "PAPER_ONLY").length,
        LIVE_PILOT: cohort.filter((m) => m.track === "LIVE_PILOT").length,
        FREE_CHOICE: cohort.filter((m) => m.track === "FREE_CHOICE").length,
      },
      mixNote: "At least 3 practice-only and 3 real-money-pilot members are needed before recruitment closes",
    },
    signal: {
      membersQualifying: signalMembers.length,
      membersLinked: linked.length,
      pct: linked.length ? Math.round((signalMembers.length / linked.length) * 100) : 0,
      bar: "exit-bar item 8: ≥60% of active members with ≥3 robot sessions and ≥1 feedback item",
      note: "Members who haven't registered yet aren't counted until they can take part",
    },
    smoke: {
      lastInvariantSmokePass: await getControl<string | null>("LAST_INVARIANT_SMOKE_PASS", null),
      lastRunbookDrill: await getControl<string | null>("LAST_RUNBOOK_DRILL", null),
      note: "When the tests and drills last passed; empty means not recorded yet",
    },
  });
}
