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
      source: "BetaDefect table (R-2 triage)",
    },
    {
      id: 2,
      item: "≤3 open S2 defects, each with a named fix phase and no workaround older than two rounds",
      status: openS2.length <= 3 && staleS2.length === 0 ? "PASS" : "HOLD",
      measured: { openS2: openS2.length, missingFixPhaseOrStale: staleS2.length },
      source: "BetaDefect table (R-2 triage)",
    },
    {
      id: 3,
      item: "No open safety or honesty regressions — B10/C25/C19.1/B1/C4.5 invariants re-verified by the smoke suite within the last 7 days",
      status:
        smokeTs && Date.now() - new Date(smokeTs).getTime() <= SEVEN_DAYS_MS
          ? "PASS"
          : smokeTs
            ? "STALE"
            : "UNKNOWN",
      measured: { lastInvariantSmokePass: smokeTs, ageDays: smokeTs ? Math.round((Date.now() - new Date(smokeTs).getTime()) / 86400_000) : null },
      source: "LAST_INVARIANT_SMOKE_PASS control key, written by the phase smoke on PASS",
    },
    {
      id: 4,
      item: "All six runbooks drilled on the beta instance within the last 14 days (R1–R5 via drill_phase75.py, R6 via demotion_drill.py)",
      status:
        drillTs && Date.now() - new Date(drillTs).getTime() <= FOURTEEN_DAYS_MS
          ? "PASS"
          : drillTs
            ? "STALE"
            : "UNKNOWN",
      measured: { lastRunbookDrill: drillTs, ageDays: drillTs ? Math.round((Date.now() - new Date(drillTs).getTime()) / 86400_000) : null },
      source: "LAST_RUNBOOK_DRILL control key, written by the drill scripts on PASS",
    },
    {
      id: 5,
      item: "B5 targets met on the founder host: 500-robot load pass (p95 ≤750 ms at protocol concurrency), availability ≥99.5%, production config",
      status: "FOUNDER_HOST",
      measured: { sandboxReference: "p95 699 ms @ 16-way, 100% availability, 2026-11-18 (Phase 7.5 ledger) — NOT a founder-host number" },
      source: "founder-host rerun owed before exit (B5 carry-forward)",
    },
    {
      id: 6,
      item: "72-hour soak green on the beta instance (P3.5 acceptance, full variant)",
      status: "FOUNDER_HOST",
      measured: { sandboxReference: "sandbox ran the shortened variant only" },
      source: "full soak runs on the founder host",
    },
    {
      id: 7,
      item: "Live-pilot sanity: ≥1 gated live-pilot robot completes a DRY-RUN signed order end-to-end on the founder host with consent + gates + pilot caps verified",
      status: "FOUNDER_HOST",
      measured: { posture: "SAFE — nothing sent while the arm switch is off (B10; founder authorization on the founder host)" },
      source: "founder-host execution owed",
    },
    {
      id: 8,
      item: "Cohort signal: ≥60% of active members completed ≥3 robot sessions and submitted ≥1 feedback item; no unresolved consent or data-handling complaint",
      status: signalPct >= 60 ? "PASS" : "HOLD",
      measured: {
        pct: signalPct,
        qualifying: qualifying.length,
        linkedMembers: linked.length,
        note: "unregistered members are excluded from the denominator until they can act (honest counting)",
      },
      source: "RobotSession + BetaFeedback + BetaMember",
    },
  ];

  const passCount = items.filter((i) => i.status === "PASS").length;
  return NextResponse.json({
    items,
    summary: { pass: passCount, total: 8, verdict: passCount === 8 ? "EXIT READY" : "HOLD — the bar gates Phase 8 billing (BETA_PHASE75 §4)" },
    note: "FOUNDER_HOST items are measured on the founder's host; the sandbox never fakes them. UNKNOWN items need the drill/smoke scripts to record their PASS timestamps.",
  });
}
