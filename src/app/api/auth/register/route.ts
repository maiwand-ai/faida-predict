// Phase 10 — closed-beta registration (BETA_PHASE75 §1: "no public signup").
// POST /api/auth/register { email, password, name?, country }
//
// Gate order (fail-closed at every step):
//   1. password policy (scrypt storage, ≥10 chars)
//   2. C4.5 jurisdiction eligibility — unknown country DENIES (default-deny
//      matrix, src/lib/eligibility.ts)
//   3. closed enrollment — the email must already sit on the operator's
//      BetaMember list, active and not yet consumed
// Success links the account to the enrollment row and opens a session.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyUser } from "@/lib/notifications";
import { checkEligibility } from "@/lib/eligibility";
import {
  createSession,
  hashPassword,
  passwordPolicyError,
  publicUser,
  setSessionCookie,
  strictAuth,
  FOUNDER_EMAIL,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
    country?: string;
  };

  const email = (body.email ?? "").trim().toLowerCase();
  const country = (body.country ?? "").trim().toUpperCase();
  const name = (body.name ?? "").trim() || null;

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  }
  const pwError = passwordPolicyError(body.password ?? "");
  if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });
  if (!/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json(
      { error: "country required (ISO 3166-1 alpha-2, e.g. NL)" },
      { status: 400 },
    );
  }

  // C4.5 — sanctioned/unknown jurisdictions can never be allowed. Default-deny.
  const eligibility = await checkEligibility(country);
  if (!eligibility.allowed) {
    return NextResponse.json(
      {
        error: "jurisdiction not eligible",
        reason: eligibility.reason,
        source: eligibility.source,
      },
      { status: 403 },
    );
  }

  // Closed beta — no public signup (BETA_PHASE75 §1).
  const enrollment = await db.betaMember.findUnique({ where: { email } });
  if (!enrollment || !enrollment.active) {
    return NextResponse.json(
      { error: "closed beta — this email is not enrolled (recruitment is operator-run)" },
      { status: 403 },
    );
  }
  if (enrollment.userId) {
    return NextResponse.json({ error: "enrollment already used" }, { status: 409 });
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "account already exists" }, { status: 409 });
  }

  const passwordHash = await hashPassword(body.password as string);
  const user = await db.user.create({
    data: {
      email,
      name,
      country,
      role: "MEMBER",
      passwordHash,
    },
  });
  await db.betaMember.update({
    where: { id: enrollment.id },
    data: { userId: user.id },
  });

  const { token, expiresAt } = await createSession(user.id);
  const res = NextResponse.json(
    {
      user: publicUser(user),
      track: enrollment.track,
      round: enrollment.round,
      authMode: strictAuth() ? "STRICT" : "FOUNDER_FALLBACK",
    },
    { status: 201 },
  );
  setSessionCookie(res, token, expiresAt);

  // Operator visibility (SYSTEM family, INFO — capped like the rest).
  const operator = await db.user.findUnique({ where: { email: FOUNDER_EMAIL } });
  if (operator) {
    await notifyUser(operator.id, {
      family: "SYSTEM",
      title: `Beta member registered: ${email}`,
      body: `Cohort round ${enrollment.round}, track ${enrollment.track}, country ${country}. The account is linked to the enrollment row.`,
      dedupeKey: `beta-register:${user.id}`,
    });
  }
  return res;
}
