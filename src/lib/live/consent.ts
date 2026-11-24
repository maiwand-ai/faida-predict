// Phase 7 — recorded consent (C25) on PlatformControl.LIVE_CONSENT.
// Consent is an explicit, recorded, revocable founder action:
//   - recording requires the exact typed confirmation phrase + wallet address
//     + pilot-caps acknowledgement; a sha256 hash binds them (audit).
//   - revocation is instant and MEASURED: revocation-to-stop ≤ 60 s target
//     (P7.7) — every live cycle and every live order path reads this row
//     first, so a revoke flips the whole live path closed on its next read.
// Live trading without a live, unrevoked consent row is refused everywhere.
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { getControl, setControl } from "@/lib/control";
import { enqueueOutbox } from "@/lib/outbox";
import { notifyUser } from "@/lib/notifications";

export const LIVE_CONSENT_KEY = "LIVE_CONSENT";
export const CONSENT_PHRASE = "I AUTHORIZE LIVE TRADING";

export interface LiveConsent {
  consented: boolean;
  phraseEcho: string; // the exact phrase required (shown in UI)
  recordedAt: string | null;
  revokedAt: string | null;
  walletAddress: string | null;
  consentHash: string | null; // sha256(phrase|wallet|recordedAt) — audit binding
  capsAcknowledged: boolean;
  note: string | null;
}

export const NO_CONSENT: LiveConsent = {
  consented: false,
  phraseEcho: CONSENT_PHRASE,
  recordedAt: null,
  revokedAt: null,
  walletAddress: null,
  consentHash: null,
  capsAcknowledged: false,
  note: "Real money is off until you record your consent.",
};

export function getConsent(): Promise<LiveConsent> {
  return getControl<LiveConsent>(LIVE_CONSENT_KEY, NO_CONSENT);
}

export function consentHash(phrase: string, wallet: string, at: string): string {
  return createHash("sha256").update(`${phrase}|${wallet.toLowerCase()}|${at}`).digest("hex");
}

export async function recordConsent(input: {
  confirm: string;
  walletAddress: string;
  capsAcknowledged: boolean;
  actor?: string;
}): Promise<{ ok: true; consent: LiveConsent } | { ok: false; reason: string; status: number }> {
  if (input.confirm !== CONSENT_PHRASE) {
    return { ok: false, reason: `typed confirmation does not match the required phrase ("${CONSENT_PHRASE}")`, status: 403 };
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.walletAddress)) {
    return { ok: false, reason: "walletAddress must be a 0x-prefixed 20-byte address", status: 400 };
  }
  if (!input.capsAcknowledged) {
    return { ok: false, reason: "pilot caps must be acknowledged before consent is recorded", status: 400 };
  }
  const at = new Date().toISOString();
  const consent: LiveConsent = {
    consented: true,
    phraseEcho: CONSENT_PHRASE,
    recordedAt: at,
    revokedAt: null,
    walletAddress: input.walletAddress,
    consentHash: consentHash(CONSENT_PHRASE, input.walletAddress, at),
    capsAcknowledged: true,
    note: `recorded by ${input.actor ?? "founder"}. You can revoke it at any time; robots stop within about a minute`,
  };
  await setControl(LIVE_CONSENT_KEY, consent);
  const founder = await db.user.findUnique({ where: { email: "founder@faida.local" }, select: { id: true } });
  if (founder) {
    // P-04 taxonomy: consent lifecycle is EXECUTION/CRITICAL — uncapped,
    // never deduped within the minute, never digested.
    await notifyUser(founder.id, {
      family: "EXECUTION",
      title: "Real-money consent recorded",
      body: `Wallet ${input.walletAddress} authorized live trading in pilot caps. Revoke from Settings → Live trading; revocation stops every robot within the measured target.`,
      dedupeKey: `consent-recorded:${at}`,
    });
    await enqueueOutbox(db, [
      { aggregateType: "ROBOT", aggregateId: "PLATFORM", eventType: "CONSENT_RECORDED", payload: { wallet: input.walletAddress, at, hash: consent.consentHash } },
    ]);
  }
  return { ok: true, consent };
}

export async function revokeConsent(actor = "founder"): Promise<LiveConsent> {
  const prev = await getConsent();
  const at = new Date().toISOString();
  const consent: LiveConsent = {
    ...prev,
    consented: false,
    revokedAt: at,
    note: `revoked by ${actor} at ${at} — every live path refuses on its next read (revocation-to-stop measured)`,
  };
  await setControl(LIVE_CONSENT_KEY, consent);
  const founder = await db.user.findUnique({ where: { email: "founder@faida.local" }, select: { id: true } });
  if (founder) {
    await notifyUser(founder.id, {
      family: "EXECUTION",
      title: "Live-trading consent revoked",
      body: "All live cycles and live orders refuse from their next read. Paper trading is unaffected.",
      dedupeKey: `consent-revoked:${at}`,
    });
    await enqueueOutbox(db, [
      { aggregateType: "ROBOT", aggregateId: "PLATFORM", eventType: "CONSENT_REVOKED", payload: { at, by: actor, prevHash: prev.consentHash } },
    ]);
  }
  return consent;
}
