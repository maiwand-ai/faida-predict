// C5 — Strategy version API: list lineage, create immutable version, activate.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activateVersion, createVersion, listVersions } from "@/lib/strategy";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const robotId = new URL(req.url).searchParams.get("robotId");
  if (!robotId) return NextResponse.json({ error: "robotId required" }, { status: 400 });
  const robot = await db.robot.findUnique({ where: { id: robotId }, select: { id: true, name: true, family: true, activeVersion: true } });
  if (!robot) return NextResponse.json({ error: "robot not found" }, { status: 404 });
  const versions = await listVersions(robotId);
  return NextResponse.json({ robot, versions });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { robotId?: string; config?: Record<string, unknown> };
  if (!body.robotId) return NextResponse.json({ error: "robotId required" }, { status: 400 });
  try {
    const sv = await createVersion(body.robotId, body.config ?? {});
    return NextResponse.json({ ok: true, version: sv.version, id: sv.id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).replace(/^Error: /, "") }, { status: 404 });
  }
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as { robotId?: string; versionId?: string };
  if (!body.robotId || !body.versionId) return NextResponse.json({ error: "robotId and versionId required" }, { status: 400 });
  try {
    const sv = await activateVersion(body.robotId, body.versionId);
    return NextResponse.json({ ok: true, activated: sv.version });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).replace(/^Error: /, "") }, { status: 400 });
  }
}
