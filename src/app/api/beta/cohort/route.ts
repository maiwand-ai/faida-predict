// Phase 10 — beta cohort management (BETA_PHASE75 §1). OPERATOR-ONLY.
// GET   — the cohort table: enrollment rows with linked accounts + track mix.
// POST  — enroll an email BEFORE an account exists (closed beta: recruitment
//         is operator-run; registration consumes the row, no public signup).
// PATCH — set active/track/round on an enrollment.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveOperator } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TRACKS = ["PAPER_ONLY", "LIVE_PILOT", "FREE_CHOICE"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(req: NextRequest) {
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const members = await db.betaMember.findMany({
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, email: true, name: true, country: true, createdAt: true } } },
  });
  const mix = {
    total: members.filter((m) => m.active).length,
    paperOnly: members.filter((m) => m.active && m.track === "PAPER_ONLY").length,
    livePilot: members.filter((m) => m.active && m.track === "LIVE_PILOT").length,
    freeChoice: members.filter((m) => m.active && m.track === "FREE_CHOICE").length,
    registered: members.filter((m) => m.userId).length,
  };
  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      email: m.email,
      track: m.track,
      round: m.round,
      active: m.active,
      registered: Boolean(m.userId),
      notes: m.notes,
      createdAt: m.createdAt,
      user: m.user,
    })),
    mix,
    mixNote: "BETA_PHASE75 §1 — cohort of 10–25; ≥3 paper-only and ≥3 live-pilot required before round 1 closes recruitment",
  });
}

export async function POST(req: NextRequest) {
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    track?: string;
    round?: number;
    notes?: string;
  };
  const email = (body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "valid email required" }, { status: 400 });
  const track = body.track ?? "FREE_CHOICE";
  if (!TRACKS.includes(track)) {
    return NextResponse.json({ error: `track must be one of ${TRACKS.join("|")}` }, { status: 400 });
  }
  const existing = await db.betaMember.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: "email already enrolled" }, { status: 409 });
  const count = await db.betaMember.count({ where: { active: true } });
  if (count >= 25) {
    return NextResponse.json(
      { error: "cohort cap reached (25) — BETA_PHASE75 §1; grow only while the exit bar holds" },
      { status: 422 },
    );
  }
  const member = await db.betaMember.create({
    data: {
      email,
      track,
      round: Math.max(1, Math.floor(body.round ?? 1)),
      notes: body.notes?.slice(0, 500) ?? null,
    },
  });
  return NextResponse.json({ member }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    active?: boolean;
    track?: string;
    notes?: string;
  };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (body.track && !TRACKS.includes(body.track)) {
    return NextResponse.json({ error: `track must be one of ${TRACKS.join("|")}` }, { status: 400 });
  }
  const data: Record<string, unknown> = {};
  if (typeof body.active === "boolean") data.active = body.active;
  if (body.track) data.track = body.track;
  if (typeof body.notes === "string") data.notes = body.notes.slice(0, 500);
  const member = await db.betaMember.update({ where: { id: body.id }, data }).catch(() => null);
  if (!member) return NextResponse.json({ error: "enrollment not found" }, { status: 404 });
  return NextResponse.json({ member });
}
