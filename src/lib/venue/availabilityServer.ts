// Server side of per-venue availability: loads the operator's overrides from
// PlatformControl and answers "may this user use real money on this venue".
import { db } from "@/lib/db";
import { getControl, setControl } from "@/lib/control";
import { venueAvailability, VENUE_GUIDES, SANCTIONED, type Availability, type AvailabilityOverrides, type AvailabilityStatus } from "./availability";

export const AVAILABILITY_KEY = "VENUE_AVAILABILITY_OVERRIDES";

export function getAvailabilityOverrides(): Promise<AvailabilityOverrides> {
  return getControl<AvailabilityOverrides>(AVAILABILITY_KEY, {});
}

export async function userVenueAvailability(userId: string, venue: string): Promise<Availability> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { country: true } });
  return venueAvailability(venue, user?.country ?? "", await getAvailabilityOverrides());
}

/** Operator edit: set (or clear with status null) one venue×country status. */
export async function setAvailabilityOverride(input: { venue: string; country: string; status: AvailabilityStatus | null; note?: string; by: string }) {
  const venue = input.venue.toUpperCase();
  const country = input.country.toUpperCase();
  if (!VENUE_GUIDES.some((g) => g.venue === venue)) throw new Error(`unknown venue ${venue}`);
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("country must be a 2-letter ISO code");
  if (SANCTIONED[country]) throw new Error(`${country} is a sanctioned jurisdiction and cannot be changed`);
  const all = await getAvailabilityOverrides();
  const forVenue = { ...(all[venue] ?? {}) };
  if (input.status == null) delete forVenue[country];
  else forVenue[country] = { status: input.status, note: input.note?.slice(0, 300), by: input.by, at: new Date().toISOString() };
  const next = { ...all, [venue]: forVenue };
  await setControl(AVAILABILITY_KEY, next);
  return next;
}
