// Phase 10 — member feedback inbox (BETA_PHASE75 §2 R-1). Exit-bar item 8
// measures "≥1 feedback item per member" against THIS table.
//   GET   — operator: all items (?status=NEW); member: their own items
//   POST  — any session user submits { category, body } for the current round
//   PATCH — operator triage: status NEW→TRIAGED→DONE + operatorNote
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveAuth, resolveOperator } from "@/lib/auth";
import { getControl } from "@/lib/control";

export const dynamic = "force-dynamic";

const CATEGORIES = ["BUG", "CONFUSION", "FEATURE", "OTHER"];
const STATUSES = ["NEW", "TRIAGED", "DONE"];

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const isOperator = auth.ctx.user.role === "OPERATOR";
  const where: Record<string, unknown> = {};
  if (!isOperator) where.userId = auth.ctx.user.id; // members see only their own
  if (status) where.status = status;
  const items = await db.betaFeedback.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { user: { select: { email: true, name: true } } },
  });
  const openCount = await db.betaFeedback.count({ where: { status: { in: ["NEW", "TRIAGED"] } } });
  return NextResponse.json({
    items: items.map((f) => ({
      id: f.id,
      round: f.round,
      category: f.category,
      body: f.body,
      status: f.status,
      operatorNote: isOperator ? f.operatorNote : null,
      createdAt: f.createdAt,
      from: isOperator ? f.user.email : null,
    })),
    openCount,
    scope: isOperator ? "OPERATOR_ALL" : "OWN",
  });
}

export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => ({}))) as { category?: string; body?: string };
  const category = body.category ?? "OTHER";
  if (!CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `category must be one of ${CATEGORIES.join("|")}` }, { status: 400 });
  }
  const text = (body.body ?? "").trim();
  if (!text) return NextResponse.json({ error: "body required" }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: "body too long (4000 chars max)" }, { status: 400 });
  const round = await getControl<number>("BETA_ROUND", 1);
  const item = await db.betaFeedback.create({
    data: {
      userId: auth.ctx.user.id,
      round: Math.max(1, Math.floor(round)),
      category,
      body: text,
    },
  });
  return NextResponse.json({ item }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => ({}))) as { id?: string; status?: string; operatorNote?: string };
  if (!body.id || !body.status || !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `id and status (${STATUSES.join("|")}) required` }, { status: 400 });
  }
  const data: Record<string, unknown> = { status: body.status };
  if (typeof body.operatorNote === "string") data.operatorNote = body.operatorNote.slice(0, 1000);
  const item = await db.betaFeedback.update({ where: { id: body.id }, data }).catch(() => null);
  if (!item) return NextResponse.json({ error: "feedback item not found" }, { status: 404 });
  return NextResponse.json({ item });
}
