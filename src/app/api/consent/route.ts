// Phase 7 — consent (C25): record, inspect, revoke. The record action is an
// explicit typed-confirmation founder action; revocation is instant and
// measured downstream (revocation-to-stop ≤60s target, P7.7).
import { NextResponse, type NextRequest } from "next/server";
import { getConsent, recordConsent, revokeConsent } from "@/lib/live/consent";
import { custodyStatus } from "@/lib/live/custody";
import { resolveOperator } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const [consent, custody] = await Promise.all([getConsent(), Promise.resolve(custodyStatus())]);
  return NextResponse.json({ consent, custody });
}

export async function POST(req: NextRequest) {
  // Phase 10: OPERATOR-ONLY — platform-level mutation.
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as { confirm?: string; walletAddress?: string; capsAcknowledged?: boolean; actor?: string };
  if (!body.confirm || !body.walletAddress) {
    return NextResponse.json({ error: "confirm (typed phrase) and walletAddress are required" }, { status: 400 });
  }
  const res = await recordConsent({
    confirm: body.confirm,
    walletAddress: body.walletAddress,
    capsAcknowledged: Boolean(body.capsAcknowledged),
    actor: body.actor ?? "founder",
  });
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: res.status });
  return NextResponse.json({ ok: true, consent: { ...res.consent } });
}

export async function DELETE(req: NextRequest) {
  // Phase 10: OPERATOR-ONLY — revocation is a founder action (C25).
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const consent = await revokeConsent(url.searchParams.get("actor") ?? "founder");
  return NextResponse.json({ ok: true, consent });
}
