// Phase 10 — one-time operator password bootstrap. POST /api/auth/bootstrap
// Sets the seeded OPERATOR's password ONLY if none is set. Never ships a
// default password; refuses once set ("already set — use /api/auth/login").
// Deliberately bypasses resolveAuth: bootstrap must work before any session
// exists, and it can never touch MEMBER accounts (founder row only).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  hashPassword,
  loginAttemptAllowed,
  passwordPolicyError,
  FOUNDER_EMAIL,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!loginAttemptAllowed(`bootstrap:${ip}`)) {
    return NextResponse.json({ error: "too many attempts — wait a minute" }, { status: 429 });
  }

  const founder = await db.user.findUnique({ where: { email: FOUNDER_EMAIL } });
  if (!founder) return NextResponse.json({ error: "not seeded" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { password?: string };
  const pwError = passwordPolicyError(body.password ?? "");
  if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

  if (founder.passwordHash) {
    return NextResponse.json(
      { error: "operator password already set — use /api/auth/login" },
      { status: 409 },
    );
  }

  await db.user.update({
    where: { id: founder.id },
    data: { passwordHash: await hashPassword(body.password as string) },
  });
  return NextResponse.json({ ok: true, role: founder.role });
}
