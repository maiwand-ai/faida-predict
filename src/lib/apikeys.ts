// P-06 — Read-only API keys (Phase 8).
//
// Design invariants:
//  • The plaintext key is shown ONCE at creation and NEVER stored — only its
//    SHA-256 hash lands in the DB (same posture as S-08 custody: secrets the
//    platform cannot re-derive cannot leak).
//  • Scope is READ_ONLY and nothing else exists: the public API surface has
//    no write routes at all, so a leaked key cannot move money or state.
//  • Keys authenticate /api/public/v1/* via `Authorization: Bearer <key>`.
//  • Revocation is immediate: revokedAt set → verification refuses.
//  • Rate limiting is honest single-tenant: an in-memory token bucket per key
//    (60 req/min) — 429 names the limit.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

const KEY_PREFIX = "fdp_ro_";

export function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export interface CreatedKey {
  id: string;
  name: string;
  prefix: string;
  /** Plaintext — returned exactly once, never stored. */
  plaintext: string;
  scope: "READ_ONLY";
}

export async function createApiKey(userId: string, name: string): Promise<CreatedKey> {
  const plaintext = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  const prefix = plaintext.slice(0, KEY_PREFIX.length + 6); // display fragment only
  const row = await db.apiKey.create({
    data: { userId, name: name.slice(0, 80), prefix, keyHash: hashKey(plaintext), scope: "READ_ONLY" },
    select: { id: true, name: true, prefix: true, scope: true },
  });
  return { ...row, plaintext, scope: "READ_ONLY" as const };
}

export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  const row = await db.apiKey.findUnique({ where: { id: keyId } });
  if (!row || row.userId !== userId || row.revokedAt) return false;
  await db.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
  return true;
}

export interface AuthedKey {
  keyId: string;
  userId: string;
  name: string;
}

/** Verify a Bearer token. Constant-time on the hash comparison. */
export async function authenticateApiKey(req: Request): Promise<AuthedKey | null> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(fdp_ro_[A-Za-z0-9_-]+)$/i.exec(header.trim());
  if (!match) return null;
  const presented = match[1];
  const presentedHash = hashKey(presented);
  const rows = await db.apiKey.findMany({
    where: { scope: "READ_ONLY", revokedAt: null },
    select: { id: true, userId: true, name: true, keyHash: true },
    take: 200,
  });
  const row = rows.find((r) => safeEqHex(r.keyHash, presentedHash));
  if (!row) return null;
  await db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return { keyId: row.id, userId: row.userId, name: row.name };
}

function safeEqHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ── Rate limiting (single-tenant, in-memory, honest) ────────────────────────
const BUCKET_CAPACITY = 60;
const REFILL_PER_SEC = 1; // 60 req/min steady state
const buckets = new Map<string, { tokens: number; ts: number }>();

export function rateLimitKey(keyId: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(keyId) ?? { tokens: BUCKET_CAPACITY, ts: now };
  const elapsed = (now - b.ts) / 1000;
  b.tokens = Math.min(BUCKET_CAPACITY, b.tokens + elapsed * REFILL_PER_SEC);
  b.ts = now;
  if (b.tokens < 1) {
    buckets.set(keyId, b);
    return { ok: false, retryAfterSec: Math.ceil((1 - b.tokens) / REFILL_PER_SEC) };
  }
  b.tokens -= 1;
  buckets.set(keyId, b);
  return { ok: true, retryAfterSec: 0 };
}
