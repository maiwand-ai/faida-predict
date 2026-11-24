// Phase 10 — the defect ladder as data (BETA_PHASE75 §2 R-2 / §3). OPERATOR
// surfaces. The exit bar (§4 items 1–2: zero open S0/S1, ≤3 open S2) audits
// THIS table — never a markdown file.
//   GET   — list (optionally ?round=N, ?status=OPEN) with ladder reference
//   POST  — record a defect { round, severity, title, detail?, owner?,
//           fixPhase?, source? }; S0 fires an UNCAPPED CRITICAL notification
//           to the operator (§3: S0 = STOP the round, global pause C19).
//   PATCH — transition status OPEN→FIXED|WONTFIX (closedAt stamped).
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveOperator } from "@/lib/auth";
import { notifyUser } from "@/lib/notifications";
import { getControl } from "@/lib/control";

export const dynamic = "force-dynamic";

const SEVERITIES = ["S0", "S1", "S2", "S3"];
const STATUSES = ["OPEN", "FIXED", "WONTFIX"];

export const LADDER: Record<string, { definition: string; response: string }> = {
  S0: {
    definition: "Money risk: wrong fill, wrong balance, ledger drift, gate bypass, custody concern",
    response: "Stop the round: pause everything and fix this first",
  },
  S1: {
    definition: "Safety or honesty regression: gate refuses wrongly (fail-closed on truth), missing provenance, mislabeled evidence, data loss",
    response: "Fix within the round; cohort growth on hold",
  },
  S2: {
    definition: "Functional break with a workaround (UI dead-end, export broken, confusing refusal text)",
    response: "Scheduled to a fix phase; tracked",
  },
  S3: {
    definition: "Cosmetic / wording / minor UX",
    response: "Backlog",
  },
};

export async function GET(req: NextRequest) {
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const round = url.searchParams.get("round");
  const status = url.searchParams.get("status");
  const where: Record<string, unknown> = {};
  if (round) where.round = Math.max(1, Math.floor(Number(round)));
  if (status) where.status = status;
  const defects = await db.betaDefect.findMany({ where, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
  const openBySeverity = Object.fromEntries(
    SEVERITIES.map((s) => [s, defects.filter((d) => d.severity === s && d.status === "OPEN").length]),
  );
  return NextResponse.json({ defects, openBySeverity, ladder: LADDER });
}

export async function POST(req: NextRequest) {
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => ({}))) as {
    round?: number;
    severity?: string;
    title?: string;
    detail?: string;
    owner?: string;
    fixPhase?: string;
    source?: string;
  };
  const severity = body.severity ?? "";
  if (!SEVERITIES.includes(severity)) {
    return NextResponse.json({ error: `severity must be one of ${SEVERITIES.join("|")}` }, { status: 400 });
  }
  if (!body.title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 });
  const round = Math.max(1, Math.floor(body.round ?? (await getControl<number>("BETA_ROUND", 1))));
  const defect = await db.betaDefect.create({
    data: {
      round,
      severity,
      title: body.title.trim().slice(0, 200),
      detail: body.detail?.slice(0, 4000) ?? null,
      owner: body.owner?.slice(0, 100) ?? null,
      fixPhase: body.fixPhase?.slice(0, 60) ?? null,
      source: body.source ?? "OPERATOR",
      reportedById: auth.ctx.user.id,
    },
  });
  if (severity === "S0") {
    // BETA_PHASE75 §3 — an S0 is a money-risk stop: CRITICAL is never capped,
    // never deduped past the minute, never digested (P-04 construction).
    await notifyUser(auth.ctx.user.id, {
      family: "RISK",
      severity: "CRITICAL",
      title: `S0 DEFECT (round ${round}): ${defect.title}`,
      body: `${LADDER.S0.response} — ${defect.detail ?? "no detail recorded"}`,
      dedupeKey: `beta-s0:${defect.id}`,
    });
  }
  return NextResponse.json({ defect, ladderResponse: LADDER[severity].response }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    owner?: string;
    fixPhase?: string;
  };
  if (!body.id || !body.status || !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `id and status (${STATUSES.join("|")}) required` }, { status: 400 });
  }
  const data: Record<string, unknown> = { status: body.status };
  if (body.status !== "OPEN") data.closedAt = new Date();
  else data.closedAt = null;
  if (typeof body.owner === "string") data.owner = body.owner.slice(0, 100);
  if (typeof body.fixPhase === "string") data.fixPhase = body.fixPhase.slice(0, 60);
  const defect = await db.betaDefect.update({ where: { id: body.id }, data }).catch(() => null);
  if (!defect) return NextResponse.json({ error: "defect not found" }, { status: 404 });
  return NextResponse.json({ defect });
}
