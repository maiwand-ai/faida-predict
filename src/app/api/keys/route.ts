// P-06 — API key management (founder-facing, authenticated by the session).
// POST creates (plaintext shown once), DELETE revokes, GET lists masked rows.
// Every lifecycle event is audited via the outbox (COMPLIANCE family, P-04).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueueOutbox } from "@/lib/outbox";
import { notifyUser } from "@/lib/notifications";
import { createApiKey, revokeApiKey } from "@/lib/apikeys";

export const dynamic = "force-dynamic";

async function founder() {
  return db.user.findUnique({ where: { email: "founder@faida.local" }, select: { id: true } });
}

export async function GET() {
  const user = await founder();
  if (!user) return NextResponse.json({ error: "not seeded" }, { status: 503 });
  const keys = await db.apiKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, prefix: true, scope: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });
  return NextResponse.json({
    keys: keys.map((k) => ({ ...k, status: k.revokedAt ? "REVOKED" : "ACTIVE" })),
    note: "P-06 read-only API keys — plaintext shown once at creation, only SHA-256 stored; scope READ_ONLY by design (no write surface exists)",
  });
}

export async function POST(req: Request) {
  const user = await founder();
  if (!user) return NextResponse.json({ error: "not seeded" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = (body.name ?? "").trim() || "unnamed key";
  const created = await createApiKey(user.id, name);
  await enqueueOutbox(db, [
    {
      aggregateType: "ROBOT",
      aggregateId: created.id,
      eventType: "API_KEY_CREATED",
      payload: { userId: user.id, keyId: created.id, name: created.name, prefix: created.prefix, scope: "READ_ONLY" },
    },
  ]);
  await notifyUser(user.id, {
    family: "COMPLIANCE",
    title: `API key created: ${created.name}`,
    body: `Read-only key ${created.prefix}… created. The plaintext was shown once — store it now; it cannot be recovered.`,
    dedupeKey: `api-key-created:${created.id}`,
  });
  return NextResponse.json({ key: created }, { status: 201 });
}

export async function DELETE(req: Request) {
  const user = await founder();
  if (!user) return NextResponse.json({ error: "not seeded" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { keyId?: string };
  if (!body.keyId) return NextResponse.json({ error: "keyId required" }, { status: 400 });
  const ok = await revokeApiKey(user.id, body.keyId);
  if (!ok) return NextResponse.json({ error: "key not found or already revoked" }, { status: 404 });
  await enqueueOutbox(db, [
    {
      aggregateType: "ROBOT",
      aggregateId: body.keyId,
      eventType: "API_KEY_REVOKED",
      payload: { userId: user.id, keyId: body.keyId },
    },
  ]);
  await notifyUser(user.id, {
    family: "COMPLIANCE",
    title: "API key revoked",
    body: `Key ${body.keyId} revoked — requests with it refuse on their next use.`,
    dedupeKey: `api-key-revoked:${body.keyId}`,
  });
  return NextResponse.json({ ok: true });
}
