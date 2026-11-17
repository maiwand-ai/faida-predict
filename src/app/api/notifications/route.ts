// P-04 — Notification feed with read-time digest + honest anti-storm counts.
// IMMEDIATE rows and every CRITICAL row surface individually; DIGEST-family
// rows inside the window collapse to one virtual row per family; suppressed
// rows never surface but are counted (the storm is provable, never silent).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { digestFeed, TAXONOMY } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const windowSec = Math.min(86400, Math.max(60, Number(url.searchParams.get("windowSec") ?? 3600)));
  const user = await db.user.findUnique({ where: { email: "founder@faida.local" }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "not seeded" }, { status: 503 });

  const since = new Date(Date.now() - windowSec * 1000);
  const rows = await db.notification.findMany({
    where: { userId: user.id, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 400,
  });

  const { feed, digested, suppressedCount } = digestFeed(rows, windowSec);
  // Anti-storm accounting per family over the window — the honest view.
  const byFamily = Object.keys(TAXONOMY).map((family) => {
    const familyRows = rows.filter((r) => r.family === family);
    return {
      family,
      delivered: familyRows.filter((r) => !r.suppressed).length,
      suppressed: familyRows.filter((r) => r.suppressed).length,
      policy: TAXONOMY[family as keyof typeof TAXONOMY],
    };
  });

  return NextResponse.json({
    windowSec,
    feed: feed.map((r) => ({
      id: r.id, severity: r.severity, family: r.family, title: r.title, body: r.body, createdAt: r.createdAt,
    })),
    digest: digested,
    suppressedCount,
    byFamily,
    taxonomyNote: "P-04 taxonomy + anti-storm: dedupe windows, hourly caps, read-time digest; CRITICAL never capped (src/lib/notifications.ts)",
  });
}
