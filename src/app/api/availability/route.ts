// Per-venue availability by country (Help › Where can I trade).
// GET: the signed-in user's country, their per-venue availability and the
//      operator overrides (the static guides ship with the client bundle).
// PUT: OPERATOR-ONLY — confirm or change one venue×country status when a
//      venue changes its rules. Sanctioned jurisdictions can never change.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveAuth, resolveOperator } from "@/lib/auth";
import { venueAvailability, VENUE_GUIDES, type AvailabilityStatus } from "@/lib/venue/availability";
import { getAvailabilityOverrides, setAvailabilityOverride } from "@/lib/venue/availabilityServer";

export const dynamic = "force-dynamic";

const STATUSES: AvailabilityStatus[] = ["OPEN", "CHECK", "CLOSE_ONLY", "BLOCKED"];

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = await db.user.findUnique({ where: { id: auth.ctx.user.id }, select: { country: true } });
  const country = user?.country ?? "";
  const overrides = await getAvailabilityOverrides();
  return NextResponse.json({
    country,
    venues: VENUE_GUIDES.map((g) => venueAvailability(g.venue, country, overrides)),
    overrides,
  });
}

export async function PUT(req: NextRequest) {
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => ({}))) as { venue?: string; country?: string; status?: AvailabilityStatus | null; note?: string };
  if (!body.venue || !body.country) return NextResponse.json({ error: "venue and country are required" }, { status: 400 });
  if (body.status != null && !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")} (or null to clear)` }, { status: 400 });
  }
  try {
    const overrides = await setAvailabilityOverride({ venue: body.venue, country: body.country, status: body.status ?? null, note: body.note, by: auth.ctx.user.email });
    return NextResponse.json({ ok: true, overrides });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "invalid request";
    return NextResponse.json({ error: msg }, { status: msg.includes("sanctioned") ? 403 : 400 });
  }
}
