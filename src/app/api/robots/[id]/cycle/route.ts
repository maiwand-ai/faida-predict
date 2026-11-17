// Per-robot tick (Phase 7.5): external schedulers tick ONE robot at a time —
// the loop lease (S-06) makes concurrent ticks of the same robot safe, which
// is exactly what the B5 load protocol (500 concurrent robots) drives.
// Same engine path as /api/cycle — no decision logic lives here.
import { NextResponse } from "next/server";
import { runRobotCycle } from "@/lib/engine/cycle";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const summary = await runRobotCycle(id);
    return NextResponse.json(summary);
  } catch (e) {
    // Lease/state races surface as 200 summaries inside the engine; a throw
    // here means a genuinely missing entity or an unexpected engine fault.
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
