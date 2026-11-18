// P-04 — Notification feed with read-time digest + honest anti-storm counts.
// IMMEDIATE rows and every CRITICAL row surface individually; DIGEST-family
// rows inside the window collapse to one virtual row per family; suppressed
// rows never surface but are counted (the storm is provable, never silent).
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { digestFeed, TAXONOMY } from "@/lib/notifications";
import { resolveAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const windowSec = Math.min(86400, Math.max(60, Number(url.searchParams.get("windowSec") ?? 3600)));
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = auth.ctx.user;

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
