// Phase 10 — beta authentication core.
//
// The closed beta (BETA_PHASE75 §1) puts 10–25 member accounts on ONE
// self-hosted instance. Until Phase 10 every API resolved a single seeded
// founder user (`founder@faida.local`) — there was no auth at all. This
// module is the smallest honest auth layer that supports the cohort:
//
// - Passwords: node:crypto scrypt (no third-party dependency for a closed
//   cohort of ≤25 accounts), salted per user, constant-time verify.
// - Sessions: 32 random bytes in an httpOnly cookie, stored ONLY as a
//   SHA-256 hash (the P-06 ApiKey pattern) — a leaked DB row cannot be
//   replayed as a session.
// - Compatibility posture: when NO session cookie is present the APIs keep
//   resolving the seeded founder user ("FOUNDER_FALLBACK") so every existing
//   operator surface and smoke suite behaves unchanged. The beta instance
//   sets BETA_STRICT_AUTH=1, which removes the fallback: a member-facing
//   request without a valid session is refused 401. The mode is always
//   visible in /api/auth/me and the round snapshot (D-03 honesty).
// - Roles: OPERATOR (the founder; compliance/metrics/control/beta-ops
//   surfaces) vs MEMBER (a cohort account; own robots/orders/ledger).
//   The fallback always resolves the OPERATOR — a member can never be
//   reached through it.
//
// Hard invariants touched here: C4.5 (registration fail-closes on the
// eligibility matrix — unknown country = deny), B1 (no key material of any
// kind passes through this module), D-03 (the auth mode is disclosed, never
// implied).

import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest } from "next/server";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number
) => Promise<Buffer>;

export const SESSION_COOKIE = "faida_session";
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days, sliding on activity not implemented (honest fixed expiry)
export const FOUNDER_EMAIL = "founder@faida.local";
export const MIN_PASSWORD_LEN = 10;

export type Role = "OPERATOR" | "MEMBER";

export interface AuthContext {
  user: User;
  via: "SESSION" | "FOUNDER_FALLBACK";
}

export type AuthResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; status: number; error: string };

// ── Password hashing (scrypt, per-user salt) ────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hashHex] = parts;
  const derived = await scrypt(password, salt, 64);
  const storedBuf = Buffer.from(hashHex, "hex");
  if (storedBuf.length !== derived.length) return false;
  return timingSafeEqual(derived, storedBuf);
}

export function passwordPolicyError(password: string): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LEN) {
    return `password must be at least ${MIN_PASSWORD_LEN} characters`;
  }
  if (password.length > 200) return "password too long";
  return null;
}

// ── Sessions ────────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}

export async function revokeSession(token: string): Promise<void> {
  await db.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function userFromToken(token: string): Promise<User | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;
  return session.user;
}

// ── Request resolution ──────────────────────────────────────────────────────

export function strictAuth(): boolean {
  return process.env.BETA_STRICT_AUTH === "1";
}

/**
 * Resolve the acting user for an API request.
 *
 * 1. A valid session cookie wins (member OR operator — operators log in too).
 * 2. Without a cookie: founder fallback (seeded OPERATOR) UNLESS strict mode
 *    is on — then 401. The fallback exists so every pre-Phase-10 operator
 *    surface and smoke suite keeps working unchanged; it can NEVER resolve a
 *    MEMBER account.
 */
export async function resolveAuth(req: NextRequest): Promise<AuthResult> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const user = await userFromToken(token);
    if (user) return { ok: true, ctx: { user, via: "SESSION" } };
    // A presented-but-invalid token is treated like no token: it falls
    // through (strict mode refuses below; fallback mode serves the operator).
    // Cookie clearing is the caller's concern on explicit logout only.
  }
  if (strictAuth()) {
    return { ok: false, status: 401, error: "authentication required" };
  }
  const founder = await db.user.findUnique({ where: { email: FOUNDER_EMAIL } });
  if (!founder) return { ok: false, status: 503, error: "not seeded" };
  return { ok: true, ctx: { user: founder, via: "FOUNDER_FALLBACK" } };
}

/** Operator-only surface guard (compliance, metrics, control, settings, beta ops). */
export async function resolveOperator(req: NextRequest): Promise<AuthResult> {
  const auth = await resolveAuth(req);
  if (!auth.ok) return auth;
  if (auth.ctx.user.role !== "OPERATOR") {
    return { ok: false, status: 403, error: "operator role required" };
  }
  return auth;
}

// ── Cookie + response helpers ───────────────────────────────────────────────

import type { NextResponse as NextResponseType } from "next/server";

export function setSessionCookie(res: NextResponseType, token: string, expiresAt: Date): void {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    // Sandbox/smoke runs are plain HTTP; https deployments set
    // FAIDA_COOKIE_SECURE=1 so browsers only send the cookie over TLS.
    secure: process.env.FAIDA_COOKIE_SECURE === "1",
  });
}

export function clearSessionCookie(res: NextResponseType): void {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: process.env.FAIDA_COOKIE_SECURE === "1",
  });
}

/** Never includes passwordHash — the only user shape APIs may return. */
export function publicUser(u: User): { id: string; email: string; name: string | null; role: Role; country: string } {
  return { id: u.id, email: u.email, name: u.name, role: u.role as Role, country: u.country };
}

// ── Login rate limiting (in-memory, per closed-instance scale) ──────────────

const loginAttempts = new Map<string, number[]>();
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 10;

/** Sliding-window limiter. Returns true when the attempt is ALLOWED. */
export function loginAttemptAllowed(key: string): boolean {
  const now = Date.now();
  const recent = (loginAttempts.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
  if (recent.length >= LOGIN_MAX_ATTEMPTS) {
    loginAttempts.set(key, recent);
    return false;
  }
  recent.push(now);
  loginAttempts.set(key, recent);
  // Bounded memory: drop stale keys opportunistically.
  if (loginAttempts.size > 1000) {
    for (const [k, ts] of loginAttempts) {
      if (ts.every((t) => now - t >= LOGIN_WINDOW_MS)) loginAttempts.delete(k);
    }
  }
  return true;
}
