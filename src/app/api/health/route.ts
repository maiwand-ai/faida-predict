import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await db.user.count();
    return NextResponse.json({ ok: true, service: "faida-predict", phase: "phase-10-beta-operations-readiness", mode: "PAPER_ONLY" });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
