// Scheduled tick endpoint (see lib/engine/scheduler.ts). Call it every few
// minutes from any scheduler (Vercel Cron, GitHub Actions, an uptime pinger).
// If CRON_SECRET is set, the caller must send "Authorization: Bearer <secret>"
// (Vercel Cron does this automatically). The tick only performs work the
// platform's own settings already schedule, and never more often than they
// allow, so it is safe to call repeatedly.
import { NextResponse, type NextRequest } from "next/server";
import { runScheduledTick } from "@/lib/engine/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const report = await runScheduledTick();
  return NextResponse.json({ ok: true, ...report });
}

export const GET = handle;
export const POST = handle;
