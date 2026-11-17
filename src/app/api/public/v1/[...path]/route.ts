// P-06 — Public read-only API, authenticated by API keys (fdp_ro_…).
// Catch-all: /api/public/v1/robots | /api/public/v1/orders |
//            /api/public/v1/positions | /api/public/v1/ledger
// NO write surface exists at all — scope READ_ONLY is structural, not a flag.
// Every response names venues (B11); rate limit 60 req/min per key (429
// names the limit); lastUsedAt is stamped per authenticated call.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateApiKey, rateLimitKey } from "@/lib/apikeys";

export const dynamic = "force-dynamic";

const ENTITIES = ["robots", "orders", "positions", "ledger"] as const;

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const key = await authenticateApiKey(req);
  if (!key) {
    return NextResponse.json(
      { error: "unauthorized", hint: "Authorization: Bearer fdp_ro_… (create in Settings → API keys)" },
      { status: 401 },
    );
  }
  const lim = rateLimitKey(key.keyId);
  if (!lim.ok) {
    return NextResponse.json(
      { error: "rate limited — 60 requests/min per key", retryAfterSec: lim.retryAfterSec },
      { status: 429, headers: { "retry-after": String(lim.retryAfterSec) } },
    );
  }

  const { path } = await ctx.params;
  const entity = (path[0] ?? "").toLowerCase();
  if (!ENTITIES.includes(entity as (typeof ENTITIES)[number])) {
    return NextResponse.json(
      { error: `unknown entity "${entity}"`, allowed: ENTITIES, note: "read-only API — no write surface exists by design (P-06)" },
      { status: 404 },
    );
  }

  const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 100)));

  if (entity === "robots") {
    const rows = await db.robot.findMany({ where: { userId: key.userId }, orderBy: { createdAt: "desc" }, take: limit });
    return NextResponse.json({ data: rows.map((r) => ({
      id: r.id, name: r.name, family: r.family, venue: r.venue, status: r.status, mode: r.mode,
      paperMode: r.paperMode, allocatedCents: r.allocatedCents, activeVersion: r.activeVersion, createdAt: r.createdAt,
    })), key: { name: key.name, prefix: key.keyId.slice(0, 8) } });
  }
  if (entity === "orders") {
    const rows = await db.order.findMany({
      where: { userId: key.userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { market: { select: { venue: true, question: true, venueSymbol: true } } },
    });
    return NextResponse.json({ data: rows.map((o) => ({
      id: o.id, venue: o.market.venue, market: o.market.question, venueSymbol: o.market.venueSymbol,
      robotId: o.robotId, mode: o.mode, side: o.side, state: o.state, priceCents: o.priceCents,
      sizeCents: o.sizeCents, filledCents: o.filledCents, feeCents: o.feeCents, createdAt: o.createdAt,
    })) });
  }
  if (entity === "positions") {
    const rows = await db.position.findMany({
      where: { robot: { userId: key.userId } },
      orderBy: { openedAt: "desc" },
      take: limit,
      include: { market: { select: { venue: true, question: true } }, robot: { select: { name: true } } },
    });
    return NextResponse.json({ data: rows.map((p) => ({
      id: p.id, venue: p.market.venue, market: p.market.question, robot: p.robot.name,
      side: p.side, sizeCents: p.sizeCents, avgPriceCents: p.avgPriceCents, status: p.status, openedAt: p.openedAt,
    })) });
  }
  // ledger
  const rows = await db.ledgerEntry.findMany({ where: { userId: key.userId }, orderBy: { createdAt: "desc" }, take: limit });
  return NextResponse.json({ data: rows.map((l) => ({
    id: l.id, mode: l.mode, type: l.type, amountCents: l.amountCents, balanceAfterCents: l.balanceAfterCents,
    refId: l.refId, memo: l.memo, createdAt: l.createdAt,
  })) });
}
