// Phase 7 — small-capital pilot config (LIVE_PILOT) + the B3 counsel sign-off
// row. The pilot is the ONLY live mode the platform supports: hard caps in
// PlatformControl (config, not folklore), venue-whitelisted to the primary
// venue, and gated behind the recorded consent (C25). Enabling the pilot
// without consent is refused; caps can only be tightened by this API, and the
// platform ceilings in the code are the floor the founder can never loosen.
import { db } from "@/lib/db";
import { getControl, setControl } from "@/lib/control";
import { enqueueOutbox } from "@/lib/outbox";

export const LIVE_PILOT_KEY = "LIVE_PILOT";
export const B3_SIGNOFF_KEY = "B3_COUNSEL_SIGNOFF";

/** Absolute structural ceilings — the founder-facing API cannot exceed these. */
export const PILOT_CEILINGS = {
  maxOrderCents: 2000, // $20 per live order, hard ceiling
  maxTotalNotionalCents: 5000, // $50 total open live notional, hard ceiling
  venues: ["POLYMARKET"] as string[], // small-capital pilot is primary-venue only (B2)
};

export interface LivePilotState {
  enabled: boolean;
  maxOrderCents: number;
  maxTotalNotionalCents: number;
  venues: string[];
  enabledAt: string | null;
  note: string | null;
}

export const PILOT_DEFAULT: LivePilotState = {
  enabled: false,
  maxOrderCents: PILOT_CEILINGS.maxOrderCents,
  maxTotalNotionalCents: PILOT_CEILINGS.maxTotalNotionalCents,
  venues: PILOT_CEILINGS.venues,
  enabledAt: null,
  note: "small real-money pilot: off until you turn it on in Settings, after recording your consent",
};

export function getPilotState(): Promise<LivePilotState> {
  return getControl<LivePilotState>(LIVE_PILOT_KEY, PILOT_DEFAULT);
}

/**
 * Clamp an update into the structural ceilings and refuse enabling while
 * consent is absent. Returns {ok:false,status} for the API to map to HTTP.
 */
export async function updatePilotState(patch: Partial<Pick<LivePilotState, "enabled" | "maxOrderCents" | "maxTotalNotionalCents">>, actor = "founder"): Promise<{ ok: true; pilot: LivePilotState } | { ok: false; reason: string; status: number }> {
  const current = await getPilotState();
  const next: LivePilotState = { ...current };

  if (patch.maxOrderCents != null) {
    next.maxOrderCents = Math.max(100, Math.min(Math.round(patch.maxOrderCents), PILOT_CEILINGS.maxOrderCents));
  }
  if (patch.maxTotalNotionalCents != null) {
    next.maxTotalNotionalCents = Math.max(next.maxOrderCents, Math.min(Math.round(patch.maxTotalNotionalCents), PILOT_CEILINGS.maxTotalNotionalCents));
  }
  if (patch.enabled != null) {
    if (patch.enabled) {
      const consent = await getControl<{ consented: boolean }>("LIVE_CONSENT", { consented: false });
      if (!consent.consented) {
        return { ok: false, reason: "the pilot can't be turned on before you record your consent", status: 422 };
      }
      next.enabled = true;
      next.enabledAt = new Date().toISOString();
      next.note = `enabled by ${actor} at ${next.enabledAt} — caps ${next.maxOrderCents}¢/order, ${next.maxTotalNotionalCents}¢ total, venues ${next.venues.join("/")}`;
    } else {
      next.enabled = false;
      next.enabledAt = null;
      next.note = `disabled by ${actor}`;
    }
  }
  await setControl(LIVE_PILOT_KEY, next);
  const founder = await db.user.findUnique({ where: { email: "founder@faida.local" }, select: { id: true } });
  if (founder) {
    await enqueueOutbox(db, [
      { aggregateType: "ROBOT", aggregateId: "PLATFORM", eventType: "LIVE_PILOT_UPDATED", payload: { enabled: next.enabled, maxOrderCents: next.maxOrderCents, maxTotalNotionalCents: next.maxTotalNotionalCents } },
    ]);
  }
  return { ok: true, pilot: next };
}

// ── B3 counsel sign-off (carry-forward: owed before the Phase 7 pilot) ───────

export interface B3Signoff {
  signedOff: boolean;
  rows: string; // which [VERIFY] rows were reviewed
  by: string | null;
  at: string | null;
  note: string | null;
}

export const B3_DEFAULT: B3Signoff = {
  signedOff: false,
  rows: "geo/restriction entries of the eligibility matrix [VERIFY]",
  by: null,
  at: null,
  note: "counsel sign-off on the [VERIFY] rows is owed before the live pilot — recorded here when it happens, honestly false until then",
};

export function getB3Signoff(): Promise<B3Signoff> {
  return getControl<B3Signoff>(B3_SIGNOFF_KEY, B3_DEFAULT);
}

export async function recordB3Signoff(input: { by: string; note?: string }): Promise<B3Signoff> {
  const at = new Date().toISOString();
  const signoff: B3Signoff = {
    signedOff: true,
    rows: B3_DEFAULT.rows,
    by: input.by,
    at,
    note: input.note ?? "counsel reviewed the geo/restriction [VERIFY] entries",
  };
  await setControl(B3_SIGNOFF_KEY, signoff);
  return signoff;
}
