// Isolation probe: do concurrent Prisma interactive transactions convoy on
// SQLite here? Direct PrismaClient, no Next.js involved.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ log: [] });

async function one(label: string): Promise<string> {
  const t0 = Date.now();
  await db.$transaction(
    async (tx) => {
      const r = await tx.robot.create({
        data: {
          userId: (await tx.user.findFirstOrThrow({ where: { email: "founder@faida.local" } })).id,
          name: `TxProbe-${label}-${Date.now()}`,
          family: "PROBABILITY_EDGE",
          venue: "MANIFOLD",
          status: "PAPER_ONLY",
          paperMode: true,
          allocatedCents: 5000,
          maxPositionCents: 500,
          maxOpenPositions: 4,
        },
      });
      await tx.strategyVersion.create({ data: { robotId: r.id, version: 1, config: "{}" } });
      return r;
    },
    { timeout: 30_000, maxWait: 20_000 },
  );
  return `${Date.now() - t0}ms`;
}

async function main() {
  for (const w of [3, 6]) {
    const t0 = Date.now();
    const results = await Promise.all(
      Array.from({ length: w }, (_, i: number) => one(`${w}-${i}`).catch((e) => `ERR ${String(e).slice(0, 80)}`)),
    );
    console.log(`W=${w}: wall ${Date.now() - t0}ms — ${results.join(" | ")}`);
  }
  const rows = await db.robot.findMany({ where: { name: { startsWith: "TxProbe-" } }, select: { id: true } });
  await db.strategyVersion.deleteMany({ where: { robotId: { in: rows.map((r) => r.id) } } });
  await db.robotLease.deleteMany({ where: { robotId: { in: rows.map((r) => r.id) } } });
  await db.outboxEvent.deleteMany({ where: { AND: [{ aggregateType: "ROBOT" }, { aggregateId: { in: rows.map((r) => r.id) } }] } });
  await db.decisionTrace.deleteMany({ where: { robotId: { in: rows.map((r) => r.id) } } });
  await db.robot.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  console.log(`cleaned ${rows.length}`);
  await db.$disconnect();
}

main();
