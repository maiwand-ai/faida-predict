// Phase 10 — who am I. GET /api/auth/me
// Discloses the acting user AND the auth mode (D-03: the fallback posture is
// visible, never implied). 401 in strict mode without a session.
import { NextResponse } from "next/server";
import { resolveAuth, strictAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await resolveAuth(req as never);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({
    user: {
      id: auth.ctx.user.id,
      email: auth.ctx.user.email,
      name: auth.ctx.user.name,
      role: auth.ctx.user.role,
      country: auth.ctx.user.country,
    },
    via: auth.ctx.via,
    strictAuth: strictAuth(),
  });
}
