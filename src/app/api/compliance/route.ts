// P-07 — Compliance ops surface: retention policy view/update + manual run.
// GET  → policies + last runs + what would be pruned today (dry counts).
// POST { action: "SET_RETENTION", key, days } → clamped update, audited.
// POST { action: "RUN_RETENTION", kind } → prune + RetentionRun row + audit.
// Phase 10: OPERATOR-ONLY — retention touches platform data, never members.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { RETENTION_KEYS, getRetentionPolicies, runRetention, setRetentionDays, RETENTION_BOUNDS } from "@/lib/compliance";
import { resolveOperator } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const policies = await getRetentionPolicies();
  const runs = await db.retentionRun.findMany({ orderBy: { ranAt: "desc" }, take: 10 });
  // Dry counts: what each policy WOULD prune today (honest preview, no writes).
  const since = (d: number) => new Date(Date.now() - d * 86400 * 1000);
  const p = (k: string) => policies.find((x) => x.key === k)?.days ?? 0;
  const [ticks, traces, notifications, outboxFailed] = await Promise.all([
    db.marketPriceTick.count({ where: { capturedAt: { lt: since(p(RETENTION_KEYS.TICKS_DAYS)) } } }),
    db.decisionTrace.count({ where: { createdAt: { lt: since(p(RETENTION_KEYS.TRACES_DAYS)) } } }),
    db.notification.count({ where: { createdAt: { lt: since(p(RETENTION_KEYS.NOTIFICATIONS_DAYS)) } } }),
    db.outboxEvent.count({ where: { status: "FAILED", createdAt: { lt: since(p(RETENTION_KEYS.OUTBOX_FAILED_DAYS)) } } }),
  ]);
  return NextResponse.json({
    policies,
    wouldPrune: { ticks, traces, notifications, outboxFailed },
    runs: runs.map((r) => ({ id: r.id, kind: r.kind, pruned: JSON.parse(r.pruned), ranAt: r.ranAt })),
    preservedNote:
      "P-07: financial truth (LedgerEntry, Order + OrderEvent, Fill, Position, ReconciliationEntry, RetentionRun) is NEVER pruned — append-only is the product (hard invariants 1/2/6)",
    bounds: RETENTION_BOUNDS,
  });
}

export async function POST(req: NextRequest) {
  // Phase 10: OPERATOR-ONLY — platform-level mutation.
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as { action?: string; key?: string; days?: number; kind?: string };
  if (body.action === "SET_RETENTION") {
    if (!body.key || typeof body.days !== "number") {
      return NextResponse.json({ error: "key and days (number) required" }, { status: 400 });
    }
    if (!Object.values(RETENTION_KEYS).includes(body.key as never)) {
      return NextResponse.json({ error: `unknown retention key`, allowed: Object.values(RETENTION_KEYS) }, { status: 400 });
    }
    const clamped = await setRetentionDays(body.key, body.days);
    return NextResponse.json({ ok: true, key: body.key, days: clamped });
  }
  if (body.action === "RUN_RETENTION") {
    const kind = body.kind === "SCHEDULED" ? "SCHEDULED" : "MANUAL";
    const result = await runRetention(kind);
    return NextResponse.json({ ok: true, result });
  }
  return NextResponse.json({ error: "action must be SET_RETENTION | RUN_RETENTION" }, { status: 400 });
}
