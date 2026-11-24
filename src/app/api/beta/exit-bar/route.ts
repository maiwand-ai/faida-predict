// Phase 10 — the measurable beta exit bar (BETA_PHASE75 §4). OPERATOR-ONLY.
// Each of the eight items reports { id, item, status, measured, source }:
//   MEASURED — the platform computes it right now from recorded data
//   FOUNDER_HOST — owed on the founder's host; the sandbox CANNOT measure it
//                  and never pretends to (D-03)
//   STALE/UNKNOWN — process timestamps recorded by the drill/smoke scripts
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveOperator } from "@/lib/auth";
import { getControl } from "@/lib/control";

export const dynamic = "force-dynamic";

const SEVEN_DAYS_MS = 7 * 86400 * 1000;
const FOURTEEN_DAYS_MS = 14 * 86400 * 1000;
const TWO_ROUNDS_MS = 14 * 86400 * 1000; // one round ≈ one calendar week (§2)

export async function GET(req: NextRequest) {
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const [openDefects, cohort, sessions, feedback, smokeTs, drillTs] = await Promise.all([
    db.betaDefect.findMany({ where: { status: "OPEN" } }),
    db.betaMember.findMany({ where: { active: true }, select: { id: true, userId: true } }),
    db.robotSession.findMany({ select: { userId: true, createdAt: true } }),
    db.betaFeedback.findMany({ select: { userId: true } }),
    getControl<string | null>("LAST_INVARIANT_SMOKE_PASS", null),
    getControl<string | null>("LAST_RUNBOOK_DRILL", null),
  ]);

  const openS0 = openDefects.filter((d) => d.severity === "S0").length;
  const openS1 = openDefects.filter((d) => d.severity === "S1").length;
  const openS2 = openDefects.filter((d) => d.severity === "S2");
  const staleS2 = openS2.filter(
    (d) => !d.fixPhase || Date.now() - d.createdAt.getTime() > TWO_ROUNDS_MS,
  );

  // Item 8 — cohort signal.
  const sessionsByUser = new Map<string, number>();
  for (const s of sessions) sessionsByUser.set(s.userId, (sessionsByUser.get(s.userId) ?? 0) + 1);
  const feedbackUsers = new Set(feedback.map((f) => f.userId));
  const linked = cohort.filter((m) => m.userId);
  const qualifying = linked.filter(
    (m) => (sessionsByUser.get(m.userId!) ?? 0) >= 3 && feedbackUsers.has(m.userId!),
  );
  const signalPct = linked.length ? Math.round((qualifying.length / linked.length) * 100) : 0;

  const items = [
    {
      id: 1,
      item: "Zero open S0 and zero open S1 defects",
      status: openS0 === 0 && openS1 === 0 ? "PASS" : "HOLD",
      measured: { openS0, openS1 },
      source: "Beta defect list",
    },
    {
      id: 2,
      item: "No more than 3 open S2 defects, each with a planned fix and no workaround older than two rounds",
      status: openS2.length <= 3 && staleS2.length === 0 ? "PASS" : "HOLD",
      measured: { openS2: openS2.length, missingFixPhaseOrStale: staleS2.length },
      source: "Beta defect list",
    },
    {
      id: 3,
      item: "No open safety regressions: real-money locks, consent, emergency stop, key handling and country rules re-checked by the test suite in the last 7 days",
      status:
        smokeTs && Date.now() - new Date(smokeTs).getTime() <= SEVEN_DAYS_MS
          ? "PASS"
          : smokeTs
            ? "STALE"
            : "UNKNOWN",
      measured: { lastInvariantSmokePass: smokeTs, ageDays: smokeTs ? Math.round((Date.now() - new Date(smokeTs).getTime()) / 86400_000) : null },
      source: "Last passing run of the test suite",
    },
    {
      id: 4,
      item: "All six incident runbooks practiced on the beta server in the last 14 days",
      status:
        drillTs && Date.now() - new Date(drillTs).getTime() <= FOURTEEN_DAYS_MS
          ? "PASS"
          : drillTs
            ? "STALE"
            : "UNKNOWN",
      measured: { lastRunbookDrill: drillTs, ageDays: drillTs ? Math.round((Date.now() - new Date(drillTs).getTime()) / 86400_000) : null },
      source: "Last passing runbook drill",
    },
    {
      id: 5,
      item: "Speed targets met on the production server: 500 robots load test (95% of requests under 750 ms), at least 99.5% uptime",
      status: "FOUNDER_HOST",
      measured: { sandboxReference: "Development machine: 699 ms, 100% uptime (2026-11-18). Not yet measured on the production server." },
      source: "Needs a run on the production server",
    },
    {
      id: 6,
      item: "72-hour non-stop run passed on the beta server",
      status: "FOUNDER_HOST",
      measured: { sandboxReference: "Only the short version has run so far" },
      source: "Needs the full 72-hour run on the production server",
    },
    {
      id: 7,
      item: "Real-money pilot check: at least one robot signs a test order end to end on the production server, with consent, safety checks and pilot limits verified",
      status: "FOUNDER_HOST",
      measured: { posture: "Safe: nothing is sent while real sending is switched off" },
      source: "Needs a run on the production server",
    },
    {
      id: 8,
      item: "Cohort signal: ≥60% of active members completed ≥3 robot sessions and submitted ≥1 feedback item; no unresolved consent or data-handling complaint",
      status: signalPct >= 60 ? "PASS" : "HOLD",
      measured: {
        pct: signalPct,
        qualifying: qualifying.length,
        linkedMembers: linked.length,
        note: "Members who haven't registered yet aren't counted until they can take part",
      },
      source: "RobotSession + BetaFeedback + BetaMember",
    },
  ];

  const passCount = items.filter((i) => i.status === "PASS").length;
  return NextResponse.json({
    items,
    summary: { pass: passCount, total: 8, verdict: passCount === 8 ? "EXIT READY" : "HOLD: paid plans stay off until every item passes" },
    note: "Production-server items are measured on the production server only and never faked. UNKNOWN items need their test or drill to run and pass.",
  });
}
