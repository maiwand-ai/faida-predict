// C5 — Strategy versioning. Versions are immutable: creating a change always
// produces a new version number, and every order/trace records the exact
// version id that produced it. Activation is explicit and audited (outbox).
import { db } from "@/lib/db";
import { enqueueOutbox } from "@/lib/outbox";

// Normalized strategy knobs. Everything numeric is clamped so a hand-tuned
// config can never push a robot outside sane bounds.
export interface StrategyConfig {
  entryRule: string; // descriptive
  minEdgePts: number; // entry: |estimate - market| >= this, net of fees
  estimatorTiltPct: number; // heuristic: how hard the book is faded toward 50
  exitEdgePts: number; // exit when |edge| falls below this after entry
  holdTicksMax: number; // hard time stop in ticks (paper cycle granularity)
  exitPolicy: string;
  schedule: string;
  estimator: string;
}

export const DEFAULT_CONFIG: StrategyConfig = {
  entryRule: "edge>=8pts net of fees",
  minEdgePts: 8,
  estimatorTiltPct: 25,
  exitEdgePts: 2,
  holdTicksMax: 12,
  exitPolicy: "edge_disappears_or_adverse_verified_info",
  schedule: "continuous",
  estimator: "HEURISTIC",
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

export function normalizeConfig(raw: unknown): StrategyConfig {
  const r = (raw ?? {}) as Partial<Record<keyof StrategyConfig, unknown>>;
  return {
    entryRule: typeof r.entryRule === "string" && r.entryRule.trim() ? r.entryRule.trim().slice(0, 80) : DEFAULT_CONFIG.entryRule,
    minEdgePts: clamp(Number(r.minEdgePts ?? DEFAULT_CONFIG.minEdgePts), 1, 25),
    estimatorTiltPct: clamp(Number(r.estimatorTiltPct ?? DEFAULT_CONFIG.estimatorTiltPct), 0, 40),
    exitEdgePts: clamp(Number(r.exitEdgePts ?? DEFAULT_CONFIG.exitEdgePts), 0, 10),
    holdTicksMax: clamp(Number(r.holdTicksMax ?? DEFAULT_CONFIG.holdTicksMax), 3, 60),
    exitPolicy: typeof r.exitPolicy === "string" ? r.exitPolicy.slice(0, 60) : DEFAULT_CONFIG.exitPolicy,
    schedule: typeof r.schedule === "string" ? r.schedule.slice(0, 40) : DEFAULT_CONFIG.schedule,
    estimator: typeof r.estimator === "string" ? r.estimator.slice(0, 30) : DEFAULT_CONFIG.estimator,
  };
}

export function parseConfig(json: string): StrategyConfig {
  try {
    return normalizeConfig(JSON.parse(json));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// Create the next immutable version for a robot.
export async function createVersion(robotId: string, rawConfig: unknown) {
  const robot = await db.robot.findUnique({ where: { id: robotId }, include: { versions: true } });
  if (!robot) throw new Error("robot not found");
  const nextVersion = robot.versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;
  const config = normalizeConfig(rawConfig);
  const sv = await db.strategyVersion.create({
    data: { robotId, version: nextVersion, config: JSON.stringify(config) },
  });
  await db.$transaction(async (tx) => {
    await enqueueOutbox(tx, [
      {
        aggregateType: "ROBOT",
        aggregateId: robotId,
        eventType: "ROBOT_STATE_CHANGED",
        payload: { userId: robot.userId, status: robot.status, note: `strategy v${nextVersion} created` },
      },
    ]);
  });
  return sv;
}

// Activate an existing version. C5 invariant: activation never flips a robot
// to RUNNING — status stays untouched; only the pointer moves.
export async function activateVersion(robotId: string, versionId: string) {
  const robot = await db.robot.findUnique({ where: { id: robotId } });
  if (!robot) throw new Error("robot not found");
  const sv = await db.strategyVersion.findUnique({ where: { id: versionId } });
  if (!sv || sv.robotId !== robotId) throw new Error("version does not belong to this robot");
  await db.robot.update({
    where: { id: robotId },
    data: { activeVersion: sv.version, statusReason: `active strategy v${sv.version} (C5 pointer move — status unchanged)` },
  });
  await db.$transaction(async (tx) => {
    await enqueueOutbox(tx, [
      {
        aggregateType: "ROBOT",
        aggregateId: robotId,
        eventType: "ROBOT_STATE_CHANGED",
        payload: { userId: robot.userId, status: robot.status, note: `strategy v${sv.version} activated` },
      },
    ]);
  });
  return sv;
}

// List versions with how many orders each one produced (lineage evidence).
export async function listVersions(robotId: string) {
  const versions = await db.strategyVersion.findMany({
    where: { robotId },
    orderBy: { version: "desc" },
  });
  const counts = await db.order.groupBy({ by: ["strategyVersionId"], where: { robotId }, _count: true });
  const countMap = new Map(counts.filter((c) => c.strategyVersionId).map((c) => [c.strategyVersionId as string, c._count]));
  const robot = await db.robot.findUnique({ where: { id: robotId }, select: { activeVersion: true } });
  return versions.map((v) => ({
    id: v.id,
    version: v.version,
    config: parseConfig(v.config),
    orderCount: countMap.get(v.id) ?? 0,
    isActive: robot?.activeVersion === v.version,
    createdAt: v.createdAt,
  }));
}
