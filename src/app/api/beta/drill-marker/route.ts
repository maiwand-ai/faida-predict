// Phase 10 — drill/smoke PASS marker. OPERATOR-ONLY.
// POST { kind: "INVARIANT_SMOKE" | "RUNBOOK_DRILL", note? }
// The verification scripts stamp the control key the exit bar reads. A stale
// or missing timestamp reads honestly as STALE/UNKNOWN — never as PASS.
import { NextResponse, type NextRequest } from "next/server";
import { resolveOperator } from "@/lib/auth";
import { setControl } from "@/lib/control";

export const dynamic = "force-dynamic";

const KINDS: Record<string, string> = {
  INVARIANT_SMOKE: "LAST_INVARIANT_SMOKE_PASS",
  RUNBOOK_DRILL: "LAST_RUNBOOK_DRILL",
};

export async function POST(req: NextRequest) {
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => ({}))) as { kind?: string; note?: string };
  const key = body.kind ? KINDS[body.kind] : undefined;
  if (!key) {
    return NextResponse.json({ error: `kind must be one of ${Object.keys(KINDS).join("|")}` }, { status: 400 });
  }
  const ts = new Date().toISOString();
  await setControl(key, ts);
  return NextResponse.json({ ok: true, kind: body.kind, stampedAt: ts, note: body.note?.slice(0, 200) ?? null });
}
