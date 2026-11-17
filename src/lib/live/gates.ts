// Phase 7 — the execution gate stack (B10 second tier). The edge gate
// (src/lib/probability/edgeGate.ts) proves the EVIDENCE; this module proves
// the EXECUTION is authorized, capped, custody-clean and geo-legal. A live
// order is possible only when BOTH reports are ready AND the arm switch is
// on. Every check names what is missing (D-04) — refusals are evidence.
import { db } from "@/lib/db";
import { edgeGateReport, type EdgeGateCheck } from "@/lib/probability/edgeGate";
import { custodyStatus, signerAddress } from "./custody";
import { getConsent } from "./consent";
import { getPilotState, getB3Signoff, PILOT_CEILINGS } from "./pilot";
import { isVenueTradeAllowed } from "@/lib/eligibility";

export interface LiveGateReport {
  robotId: string;
  robotName: string;
  mode: string;
  // edge-gate (evidence) half
  edge: Awaited<ReturnType<typeof edgeGateReport>>;
  // execution half
  exec: EdgeGateCheck[];
  ready: boolean; // every evidence + execution check EXCEPT the arm switch
  armed: boolean; // POLYMARKET_LIVE_WRITE=1 — the founder's final arm
  dryRun: boolean; // true unless armed — orders are signed but NOT sent
  generatedAt: string;
}

function check(name: string, passed: boolean, detail: string): EdgeGateCheck {
  return { check: name, passed, detail };
}

export async function liveGateReport(robotId: string): Promise<LiveGateReport | null> {
  const robot = await db.robot.findUnique({ where: { id: robotId }, include: { user: { select: { id: true, country: true } } } });
  if (!robot) return null;

  const edge = await edgeGateReport(robotId);
  const custody = custodyStatus();
  const consent = await getConsent();
  const pilot = await getPilotState();
  const b3 = await getB3Signoff();

  // 1. robot mode: only LIVE_PILOT robots reach the live path.
  const exec: EdgeGateCheck[] = [
    check("ROBOT_MODE", robot.mode === "LIVE_PILOT", `robot mode ${robot.mode} (LIVE_PILOT required — flip it in Settings with the gate ready)`),
  ];

  // 2. venue: live write exists only for the primary venue (B2).
  exec.push(check("VENUE_LIVE_WRITE", robot.venue === "POLYMARKET", `${robot.venue} live write ${robot.venue === "POLYMARKET" ? "supported (CLOB)" : "not built — small-capital pilot is primary-venue only (B2)"}`));

  // 3. custody (B1/S-08): the wallet is registered ADDRESS-ONLY and, when a
  //    signer key is injected, it must BE that wallet's key. The most recent
  //    registration is the live one (re-registering expresses intent).
  const wallet = await db.wallet.findFirst({
    where: { userId: robot.userId, signingModel: "SELF_CUSTODY_EIP712" },
    orderBy: { createdAt: "desc" },
  });
  const addr = signerAddress();
  const custodyOk = wallet != null && (addr == null || addr.toLowerCase() === wallet.address.toLowerCase());
  exec.push(check("CUSTODY_WALLET", custodyOk, wallet
    ? `wallet ${wallet.address} registered SELF_CUSTODY_EIP712${addr ? (custodyOk ? `; injected signer matches …${custody.fingerprint}` : `; injected signer ${addr} does NOT match the registered wallet`) : "; no signer key injected (signing impossible)"}`
    : "no self-custody wallet registered — register the address in Settings → Live trading (B1: address only, keys never stored)"));

  // 4. L2 credentials: env-injected per process, never stored (same discipline
  //    as the signer key). Without them the send boundary refuses.
  const creds = liveCredentials();
  exec.push(check("CREDENTIALS_PRESENT", creds != null, creds
    ? `CLOB L2 credentials injected (api key ${mask(creds.apiKey)})`
    : "POLYMARKET_API_KEY / _SECRET / _PASSPHRASE missing in process env — inject per-process, never store"));

  // 5. pilot enabled (with consent present — enabling without it is refused upstream).
  exec.push(check("PILOT_ENABLED", pilot.enabled, pilot.enabled
    ? `small-capital pilot ON since ${pilot.enabledAt}: ≤${pilot.maxOrderCents}¢/order, ≤${pilot.maxTotalNotionalCents}¢ total, venues ${pilot.venues.join("/")}`
    : "small-capital pilot disabled — enable it in Settings → Live trading (requires consent)"));

  // 6. pilot caps: this robot's own limits must sit inside the pilot caps.
  const capsOk = robot.allocatedCents <= pilot.maxTotalNotionalCents && robot.maxPositionCents <= pilot.maxOrderCents;
  exec.push(check("PILOT_CAPS_OK", capsOk, `robot allocation ${robot.allocatedCents}¢ ≤ pilot total ${pilot.maxTotalNotionalCents}¢ and position cap ${robot.maxPositionCents}¢ ≤ pilot per-order ${pilot.maxOrderCents}¢ (hard ceiling ${PILOT_CEILINGS.maxTotalNotionalCents}¢)`));

  // 7. B3 counsel sign-off on the [VERIFY] rows (carry-forward register).
  exec.push(check("B3_COUNSEL_SIGNOFF", b3.signedOff, b3.signedOff ? `${b3.rows} signed off by ${b3.by} at ${b3.at}` : b3.note ?? "counsel sign-off owed before the pilot"));

  // 8. geo eligibility (C4.5) — checked live, so a jurisdiction flip closes
  //    the gate on the next read (geographic transitions drill, P7.8).
  const geo = await isVenueTradeAllowed(robot.userId);
  exec.push(check("GEO_ELIGIBLE", geo.allowed, geo.allowed ? `${robot.user.country} allowed by the eligibility matrix` : `${robot.user.country} refused: ${geo.reason ?? "not eligible"}`));

  const dryRun = process.env.POLYMARKET_LIVE_WRITE !== "1";
  exec.push(check("LIVE_WRITE_SWITCH", !dryRun, dryRun
    ? "POLYMARKET_LIVE_WRITE unset — orders are built, signed and audited but NOT sent (dry-run armor)"
    : "POLYMARKET_LIVE_WRITE=1 — the send boundary will transmit signed orders"));

  // `ready` = every evidence + execution check EXCEPT the arm switch: the
  // switch is the founder's deliberate final arm, reported separately as
  // `armed`. A ready-but-not-armed gate is exactly the DRY-RUN posture.
  const ready = Boolean(edge?.ready) && exec.filter((c) => c.check !== "LIVE_WRITE_SWITCH").every((c) => c.passed);
  return {
    robotId,
    robotName: robot.name,
    mode: robot.mode,
    edge,
    exec,
    ready,
    armed: !dryRun,
    dryRun,
    generatedAt: new Date().toISOString(),
  };
}

/** Env-injected CLOB L2 credentials (P7: same token discipline as the PAT). */
export function liveCredentials(): { address: string; apiKey: string; apiSecret: string; apiPassphrase: string } | null {
  const apiKey = process.env.POLYMARKET_API_KEY?.trim();
  const apiSecret = process.env.POLYMARKET_API_SECRET?.trim();
  const apiPassphrase = process.env.POLYMARKET_API_PASSPHRASE?.trim();
  const address = signerAddress();
  if (!apiKey || !apiSecret || !apiPassphrase || !address) return null;
  return { address, apiKey, apiSecret, apiPassphrase };
}

function mask(v: string): string {
  return v.length <= 8 ? "…" : `${v.slice(0, 4)}…${v.slice(-4)}`;
}
