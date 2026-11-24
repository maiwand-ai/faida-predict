// Phase 7 — live automation control surface:
//   GET  — custody (B1), consent (C25), pilot caps, B3 sign-off, and the full
//          live gate report for every robot (evidence halves included).
//   POST — explicit founder actions: REGISTER_WALLET (address only, B1),
//          ENABLE/DISABLE_PILOT, SET_CAPS (clamped to ceilings), SET_ROBOT_MODE
//          (PAPER⇄LIVE_PILOT, flip re-runs every gate except the mode check
//          itself), B3_SIGNOFF (counsel), ARM_LIVE_WRITE acknowledgement is
//          env-only (POLYMARKET_LIVE_WRITE) and never settable via API.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { custodyStatus, signerAddress } from "@/lib/live/custody";
import { kalshiCredentialStatus } from "@/lib/live/kalshiCustody";
import { getConsent } from "@/lib/live/consent";
import { getPilotState, updatePilotState, getB3Signoff, recordB3Signoff, PILOT_CEILINGS } from "@/lib/live/pilot";
import { liveGateReport } from "@/lib/live/gates";
import { enqueueOutbox } from "@/lib/outbox";
import { resolveAuth, resolveOperator } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET is OPERATOR-ONLY (Phase 10): the report names every Polymarket robot —
// member robot names must not leak across cohort accounts.
export async function GET(req: NextRequest) {
  const auth = await resolveOperator(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const robots = await db.robot.findMany({
    where: { venue: "POLYMARKET" },
    select: { id: true, name: true, mode: true, status: true, allocatedCents: true, maxPositionCents: true },
    orderBy: { createdAt: "asc" },
  });
  const gates: Array<{ robotId: string; robotName: string; mode: string; status: string; edge: NonNullable<Awaited<ReturnType<typeof liveGateReport>>>["edge"]; exec: NonNullable<Awaited<ReturnType<typeof liveGateReport>>>["exec"]; ready: boolean; armed: boolean; dryRun: boolean }> = [];
  for (const r of robots) {
    const g = await liveGateReport(r.id);
    if (g) gates.push({ robotId: r.id, robotName: r.name, mode: r.mode, status: r.status, edge: g.edge, exec: g.exec, ready: g.ready, armed: g.armed, dryRun: g.dryRun });
  }
  const [consent, pilot, b3] = await Promise.all([getConsent(), getPilotState(), getB3Signoff()]);
  return NextResponse.json({
    custody: custodyStatus(),
    // Phase 9 — the SECOND credential kind (Kalshi asymmetric API key, RSA-PSS
    // or Ed25519, env-injected, never stored). Status only — never key material.
    kalshiCred: kalshiCredentialStatus(),
    consent,
    pilot,
    ceilings: PILOT_CEILINGS,
    b3,
    gates,
    armSwitch: process.env.POLYMARKET_LIVE_WRITE === "1" ? "ARMED" : "SAFE",
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    address?: string;
    caps?: { maxOrderCents?: number; maxTotalNotionalCents?: number };
    enabled?: boolean;
    robotId?: string;
    mode?: string;
    by?: string;
    note?: string;
    actor?: string;
  };
  const actor = body.actor ?? "founder";

  // Phase 10 auth split: REGISTER_WALLET is member onboarding (BETA §1 —
  // session user registers their OWN wallet, address only, B1); every pilot
  // control action is OPERATOR-only (caps/modes/counsel are platform truth).
  switch (body.action) {
    case "REGISTER_WALLET": {
      const auth = await resolveAuth(req);
      if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
      const user = auth.ctx.user;
      const address = body.address?.trim();
      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return NextResponse.json({ error: "address must be a 0x-prefixed 20-byte address" }, { status: 400 });
      }
      const signer = signerAddress();
      if (signer && signer.toLowerCase() !== address.toLowerCase()) {
        return NextResponse.json({ error: `injected signer ${signer} does not control the registered address — refusing` }, { status: 422 });
      }
      const wallet = await db.wallet.upsert({
        where: { address },
        create: { userId: user.id, address, chainId: 137, signingModel: "SELF_CUSTODY_EIP712", label: "self-custody (address only)" },
        update: { signingModel: "SELF_CUSTODY_EIP712" },
      });
      return NextResponse.json({ ok: true, wallet: { address: wallet.address, chainId: wallet.chainId, signingModel: wallet.signingModel } });
    }
  }

  const opAuth = await resolveOperator(req);
  if (!opAuth.ok) return NextResponse.json({ error: opAuth.error }, { status: opAuth.status });

  switch (body.action) {
    case "ENABLE_PILOT":
    case "DISABLE_PILOT":
    case "SET_CAPS": {
      const res = await updatePilotState({ enabled: body.action === "ENABLE_PILOT" ? true : body.action === "DISABLE_PILOT" ? false : undefined, ...body.caps }, actor);
      if (!res.ok) return NextResponse.json({ error: res.reason }, { status: res.status });
      return NextResponse.json({ ok: true, pilot: res.pilot });
    }

    case "SET_ROBOT_MODE": {
      if (!body.robotId || !body.mode) return NextResponse.json({ error: "robotId and mode required" }, { status: 400 });
      const robot = await db.robot.findUnique({ where: { id: body.robotId } });
      if (!robot) return NextResponse.json({ error: "robot not found" }, { status: 404 });
      if (body.mode === "PAPER") {
        await db.robot.update({ where: { id: robot.id }, data: { mode: "PAPER", status: robot.status === "RUNNING" ? "PAPER_ONLY" : robot.status } });
        return NextResponse.json({ ok: true, mode: "PAPER" });
      }
      if (body.mode !== "LIVE_PILOT") return NextResponse.json({ error: "mode must be PAPER or LIVE_PILOT" }, { status: 400 });
      if (robot.venue !== "POLYMARKET") {
        return NextResponse.json({ error: `real-money orders exist only on Polymarket for now — ${robot.venue} robots stay in practice` }, { status: 422 });
      }
      const gate = await liveGateReport(robot.id);
      if (!gate) return NextResponse.json({ error: "gate report unavailable" }, { status: 503 });
      // The flip requires every gate check EXCEPT the mode check it is about
      // to change and the arm switch (dry-run posture is a valid flip state).
      const blocking = [...(gate.edge?.checks ?? []), ...gate.exec].filter((c) => c.passed === false && c.check !== "ROBOT_MODE" && c.check !== "LIVE_WRITE_SWITCH");
      if (blocking.length > 0) {
        return NextResponse.json({ error: "live gate refuses the flip", blocking: blocking.map((c) => ({ check: c.check, detail: c.detail })) }, { status: 422 });
      }
      await db.robot.update({ where: { id: robot.id }, data: { mode: "LIVE_PILOT", status: "RUNNING", statusReason: "Real-money pilot: all safety checks passed" } });
      await enqueueOutbox(db, [{ aggregateType: "ROBOT", aggregateId: robot.id, eventType: "ROBOT_MODE_LIVE_PILOT", payload: { by: actor, at: new Date().toISOString() } }]);
      return NextResponse.json({ ok: true, mode: "LIVE_PILOT" });
    }

    case "B3_SIGNOFF": {
      if (!body.by) return NextResponse.json({ error: "counsel name required (by)" }, { status: 400 });
      const signoff = await recordB3Signoff({ by: body.by, note: body.note });
      return NextResponse.json({ ok: true, b3: signoff });
    }

    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
