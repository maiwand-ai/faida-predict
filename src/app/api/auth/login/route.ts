// Phase 10 — password login. POST /api/auth/login { email, password }
// Generic "invalid credentials" for both unknown email and wrong password
// (no user enumeration). Rate-limited 10 attempts/min per IP+email pair.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  createSession,
  loginAttemptAllowed,
  publicUser,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!loginAttemptAllowed(`login:${ip}:${email}`)) {
    return NextResponse.json(
      { error: "too many attempts — wait a minute" },
      { status: 429 },
    );
  }

  const user = await db.user.findUnique({ where: { email } });
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  const { token, expiresAt } = await createSession(user.id);
  const res = NextResponse.json({ user: publicUser(user), via: "SESSION" });
  setSessionCookie(res, token, expiresAt);
  return res;
}
