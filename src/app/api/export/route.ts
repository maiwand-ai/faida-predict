// P-06 — Data export. The user's own data, complete and honest:
// robots, orders, ledger (append-only), positions, decision traces —
// JSON (full fidelity) or CSV (spreadsheet-friendly). Every row names its
// venue (B11). Export is read-only and needs no keys; the PUBLIC key surface
// is separate (/api/public/v1/*).
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ENTITIES = ["robots", "orders", "ledger", "positions", "traces", "all"] as const;

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const entity = (url.searchParams.get("entity") ?? "all").toLowerCase();
  const format = (url.searchParams.get("format") ?? "json").toLowerCase();
  if (!ENTITIES.includes(entity as (typeof ENTITIES)[number])) {
    return NextResponse.json({ error: `entity must be one of ${ENTITIES.join("|")}` }, { status: 400 });
  }
  if (!["json", "csv"].includes(format)) {
    return NextResponse.json({ error: "format must be json|csv" }, { status: 400 });
  }
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = { id: auth.ctx.user.id, email: auth.ctx.user.email };

  const want = (e: string) => entity === "all" || entity === e;
  const payload: Record<string, unknown> = {
    _meta: {
      exportedAt: new Date().toISOString(),
      user: user.email,
      entity,
      format,
      venueLabeling: "B11 — every market-linked row names its venue",
      honesty: "paper ledger rows carry mode=PAPER; live rows carry mode=LIVE (D-03)",
    },
  };

  const robots = want("robots")
    ? await db.robot.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } })
    : [];
  const orders = want("orders")
    ? await db.order.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        include: { market: { select: { venue: true, question: true, venueSymbol: true } } },
      })
    : [];
  const ledger = want("ledger")
    ? await db.ledgerEntry.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } })
    : [];
  const positions = want("positions")
    ? await db.position.findMany({
        orderBy: { openedAt: "asc" },
        where: { robot: { userId: user.id } },
        include: { market: { select: { venue: true, question: true } }, robot: { select: { name: true } } },
      })
    : [];
  const traces = want("traces")
    ? await db.decisionTrace.findMany({
        orderBy: { createdAt: "asc" },
        where: { robot: { userId: user.id } },
        include: { market: { select: { venue: true, question: true } }, robot: { select: { name: true } } },
      })
    : [];

  if (want("robots")) payload.robots = robots;
  if (want("orders"))
    payload.orders = orders.map((o) => ({
      id: o.id, venue: o.market.venue, market: o.market.question, venueSymbol: o.market.venueSymbol,
      robotId: o.robotId, mode: o.mode, side: o.side, state: o.state, stateReason: o.stateReason,
      priceCents: o.priceCents, sizeCents: o.sizeCents, filledCents: o.filledCents, feeCents: o.feeCents,
      strategyVersionId: o.strategyVersionId, createdAt: o.createdAt,
    }));
  if (want("ledger")) payload.ledger = ledger;
  if (want("positions"))
    payload.positions = positions.map((p) => ({
      id: p.id, venue: p.market.venue, market: p.market.question, robot: p.robot.name,
      side: p.side, sizeCents: p.sizeCents, avgPriceCents: p.avgPriceCents, status: p.status,
      openedAt: p.openedAt, closedAt: p.closedAt,
    }));
  if (want("traces"))
    payload.traces = traces.map((t) => ({
      id: t.id, venue: t.market.venue, market: t.market.question, robot: t.robot.name,
      trigger: t.trigger, decision: t.decision, reason: t.reason,
      modelEstimatePct: t.modelEstimatePct, marketPriceCents: t.marketPriceCents, edgeNetPct: t.edgeNetPct,
      modelKey: t.modelKey, createdAt: t.createdAt,
    }));

  if (format === "csv") {
    // CSV exports one entity at a time — pick the first requested entity row set.
    const first = entity === "all" ? "orders" : entity;
    const rows = (payload[first] as Record<string, unknown>[]) ?? [];
    return new NextResponse(toCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="faida-${first}.csv"`,
      },
    });
  }
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="faida-${entity}.json"`,
    },
  });
}
