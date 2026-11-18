// Phase 10 — session logout. POST /api/auth/logout
// Revokes the session server-side (hash lookup) and clears the cookie.
// Works in every auth mode; idempotent.
import { NextResponse } from "next/server";
import { clearSessionCookie, revokeSession, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token =
    req.headers.get("cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1) ?? "";

  if (token) await revokeSession(token);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
