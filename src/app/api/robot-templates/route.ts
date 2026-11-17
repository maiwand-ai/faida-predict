// P-03 — Robot templates API: the curated template gallery for Robot Studio.
// Static, versioned code constants; venue recommendations annotated with live
// adapter status so the UI can honestly mark a template whose venue is down.
import { NextResponse } from "next/server";
import { ROBOT_TEMPLATES } from "@/lib/robotTemplates";
import { isLiveVenue, VENUE_LABEL } from "@/lib/venues";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    templates: ROBOT_TEMPLATES.map((t) => ({
      ...t,
      venueLabel: VENUE_LABEL[t.venue] ?? t.venue,
      venueLive: isLiveVenue(t.venue),
    })),
  });
}
