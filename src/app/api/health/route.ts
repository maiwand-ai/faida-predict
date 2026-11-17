import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await db.user.count();
    return NextResponse.json({ ok: true, service: "faida-predict", phase: "phase-5-probability-hardening", mode: "PAPER_ONLY" });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
