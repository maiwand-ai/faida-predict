// Platform control (C19/S-07, P3.2): global pause, autopilot, staleness
// threshold. Single-tenant self-host — the founder owns every switch (B8).
import { NextResponse } from "next/server";
import {
  getAutopilotState,
  getPauseState,
  getStalenessThresholdMs,
  pausePlatform,
  resumePlatform,
  setStalenessThresholdMs,
  DEFAULT_STALENESS_MS,
  MAX_STALENESS_MS,
  MIN_STALENESS_MS,
} from "@/lib/control";
import { ensureAutopilotTimer, startAutopilot, stopAutopilot } from "@/lib/engine/autopilot";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureAutopilotTimer(); // self-heal after a process restart
  const [pause, autopilot, stalenessMs] = await Promise.all([
    getPauseState(),
    getAutopilotState(),
    getStalenessThresholdMs(),
  ]);
  return NextResponse.json({ pause, autopilot, stalenessMs, stalenessBounds: { MIN_STALENESS_MS, MAX_STALENESS_MS, DEFAULT_STALENESS_MS } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: "PAUSE" | "RESUME" | "AUTOPILOT_START" | "AUTOPILOT_STOP" | "SET_STALENESS";
    reason?: string;
    intervalSec?: number;
    stalenessMs?: number;
  };

  switch (body.action) {
    case "PAUSE": {
      const state = await pausePlatform(body.reason ?? "manual pause");
      return NextResponse.json({ ok: true, pause: state });
    }
    case "RESUME": {
      const state = await resumePlatform();
      return NextResponse.json({ ok: true, pause: state });
    }
    case "AUTOPILOT_START": {
      await startAutopilot(body.intervalSec ?? 60);
      return NextResponse.json({ ok: true, autopilot: await getAutopilotState() });
    }
    case "AUTOPILOT_STOP": {
      await stopAutopilot();
      return NextResponse.json({ ok: true, autopilot: await getAutopilotState() });
    }
    case "SET_STALENESS": {
      if (typeof body.stalenessMs !== "number") {
        return NextResponse.json({ error: "stalenessMs (number) required" }, { status: 400 });
      }
      const clamped = await setStalenessThresholdMs(body.stalenessMs);
      return NextResponse.json({ ok: true, stalenessMs: clamped });
    }
    default:
      return NextResponse.json(
        { error: "action must be PAUSE | RESUME | AUTOPILOT_START | AUTOPILOT_STOP | SET_STALENESS" },
        { status: 400 },
      );
  }
}
