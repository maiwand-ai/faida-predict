// C4.5 — Jurisdiction eligibility matrix. Editable config (Settings UI),
// never hardcoded at call sites. Every denial states its reason and source.
import { db } from "@/lib/db";

export interface EligibilityResult {
  allowed: boolean;
  country: string;
  reason: string | null;
  source: string | null;
}

// Countries whose venues or law make real-money event trading unavailable.
// Sources: SANCTION_LIST (OFAC/EU — absolute), VENUE (Polymarket geo-restrictions,
// marked [VERIFY] — counsel must confirm at launch), PLATFORM (founder choice).
export const SEED_MATRIX: Array<{ country: string; allowed: boolean; reason?: string; source: string }> = [
  // — unrestricted launch set (EU per decision #3 + broadly accessible) —
  { country: "NL", allowed: true, source: "PLATFORM" },
  { country: "DE", allowed: true, source: "PLATFORM" },
  { country: "PT", allowed: true, source: "PLATFORM" },
  { country: "ES", allowed: true, source: "PLATFORM" },
  { country: "IT", allowed: true, source: "PLATFORM" },
  { country: "PL", allowed: true, source: "PLATFORM" },
  { country: "RO", allowed: true, source: "PLATFORM" },
  { country: "GB", allowed: true, source: "PLATFORM" },
  { country: "BR", allowed: true, source: "PLATFORM" },
  { country: "MX", allowed: true, source: "PLATFORM" },
  { country: "NG", allowed: true, source: "PLATFORM" },
  { country: "IN", allowed: true, source: "PLATFORM" },
  { country: "JP", allowed: true, source: "PLATFORM" },
  { country: "VN", allowed: true, source: "PLATFORM" },
  { country: "AE", allowed: true, source: "PLATFORM" },
  // — venue-restricted [VERIFY before launch] —
  { country: "US", allowed: false, reason: "Polymarket restricts US residents on its international site (to be confirmed by counsel)", source: "VENUE" },
  { country: "FR", allowed: false, reason: "Regulator action against prediction-market venues (to be confirmed by counsel)", source: "VENUE" },
  { country: "BE", allowed: false, reason: "Blocked by the venue in this country (to be confirmed by counsel)", source: "VENUE" },
  { country: "SG", allowed: false, reason: "Blocked under gambling rules (to be confirmed by counsel)", source: "VENUE" },
  { country: "TH", allowed: false, reason: "Blocked by the venue in this country (to be confirmed by counsel)", source: "VENUE" },
  // — sanctioned: absolute, never editable to allowed in the UI —
  { country: "IR", allowed: false, reason: "Sanctioned country (US/EU sanctions); can't be changed", source: "SANCTION_LIST" },
  { country: "KP", allowed: false, reason: "Sanctioned country (US/EU sanctions); can't be changed", source: "SANCTION_LIST" },
  { country: "CU", allowed: false, reason: "Sanctioned country (US/EU sanctions); can't be changed", source: "SANCTION_LIST" },
  { country: "SY", allowed: false, reason: "Sanctioned country (US/EU sanctions); can't be changed", source: "SANCTION_LIST" },
];

export async function checkEligibility(country: string): Promise<EligibilityResult> {
  const rule = await db.eligibilityRule.findUnique({ where: { country } });
  if (!rule) {
    // Default-deny for unknown countries: the matrix is explicit, not implicit.
    return { allowed: false, country, reason: "Country not present in eligibility matrix — default deny", source: "PLATFORM" };
  }
  return { allowed: rule.allowed, country, reason: rule.reason ?? null, source: rule.source };
}

export async function isVenueTradeAllowed(userId: string): Promise<EligibilityResult> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { allowed: false, country: "??", reason: "User not found", source: "PLATFORM" };
  return checkEligibility(user.country);
}
