// P-06 — API key management (authenticated by the Phase 10 session layer;
// founder fallback outside strict mode).
// POST creates (plaintext shown once), DELETE revokes, GET lists masked rows.
// Every lifecycle event is audited via the outbox (COMPLIANCE family, P-04).
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { enqueueOutbox } from "@/lib/outbox";
import { notifyUser } from "@/lib/notifications";
import { createApiKey, revokeApiKey } from "@/lib/apikeys";
import { resolveAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.ctx.user.id;
  const keys = await db.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, prefix: true, scope: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });
  return NextResponse.json({
    keys: keys.map((k) => ({ ...k, status: k.revokedAt ? "REVOKED" : "ACTIVE" })),
    note: "P-06 read-only API keys — plaintext shown once at creation, only SHA-256 stored; scope READ_ONLY by design (no write surface exists)",
  });
}

export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.ctx.user.id;
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = (body.name ?? "").trim() || "unnamed key";
  const created = await createApiKey(userId, name);
  await enqueueOutbox(db, [
    {
      aggregateType: "ROBOT",
      aggregateId: created.id,
      eventType: "API_KEY_CREATED",
      payload: { userId, keyId: created.id, name: created.name, prefix: created.prefix, scope: "READ_ONLY" },
    },
  ]);
  await notifyUser(userId, {
    family: "COMPLIANCE",
    title: `API key created: ${created.name}`,
    body: `Read-only key ${created.prefix}… created. The plaintext was shown once — store it now; it cannot be recovered.`,
    dedupeKey: `api-key-created:${created.id}`,
  });
  return NextResponse.json({ key: created }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.ctx.user.id;
  const body = (await req.json().catch(() => ({}))) as { keyId?: string };
  if (!body.keyId) return NextResponse.json({ error: "keyId required" }, { status: 400 });
  const ok = await revokeApiKey(userId, body.keyId);
  if (!ok) return NextResponse.json({ error: "key not found or already revoked" }, { status: 404 });
  await enqueueOutbox(db, [
    {
      aggregateType: "ROBOT",
      aggregateId: body.keyId,
      eventType: "API_KEY_REVOKED",
      payload: { userId, keyId: body.keyId },
    },
  ]);
  await notifyUser(userId, {
    family: "COMPLIANCE",
    title: "API key revoked",
    body: `Key ${body.keyId} revoked — requests with it refuse on their next use.`,
    dedupeKey: `api-key-revoked:${body.keyId}`,
  });
  return NextResponse.json({ ok: true });
}
