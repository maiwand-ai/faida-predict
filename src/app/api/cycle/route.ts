// Robot evaluation cycle + reconciliation runner.
import { NextResponse } from "next/server";
import { runAllCycles } from "@/lib/engine/cycle";
import { reconcilePendingOrders } from "@/lib/engine/reconcile";
import { drainOutbox } from "@/lib/outbox";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: "CYCLE" | "RECONCILE" };
  if (body.action === "RECONCILE") {
    const results = await reconcilePendingOrders();
    await drainOutbox(25);
    return NextResponse.json({ action: "RECONCILE", results });
  }
  const summaries = await runAllCycles();
  await drainOutbox(25);
  return NextResponse.json({ action: "CYCLE", summaries });
}
