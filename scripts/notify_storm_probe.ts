// P-04 anti-storm probe — drives notifyUser() DIRECTLY (same lib the server
// uses, same DB) so the acceptance smoke can measure dedupe windows and
// hourly caps end-to-end without test-only backdoors in the server.
//
//   bun scripts/notify_storm_probe.ts <userEmail> <outPath>
//
// Each invocation is RUN-SCOPED (random runId in titles) so repeated runs
// measure this run only. Sequence (COMPLIANCE family — cap 20/h, digest,
// dedupe 60s):
//   1. five notifications, SAME dedupeKey, inside the window
//      → expect 1 delivered + 4 absorbed (DEDUPE) — unless prior live
//        COMPLIANCE rows exist this hour, which the result records.
//   2. up to 25 notifications with DISTINCT dedupe keys
//      → expect the COMPLIANCE hourly cap to absorb the tail (HOURLY_CAP).
// Writes the observed outcome JSON to <outPath>.
// Cleanup is the smoke's job (it deletes the rows it can attribute).
import { db } from "../src/lib/db";
import { notifyUser } from "../src/lib/notifications";

async function main() {
  const [email, outPath] = process.argv.slice(2);
  if (!email || !outPath) {
    console.error("usage: bun scripts/notify_storm_probe.ts <userEmail> <outPath>");
    process.exit(2);
  }
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`user ${email} not found`);
  const runId = `p8-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Baseline: live COMPLIANCE rows already in the hour window (this probe is
  // run-scoped, so the baseline tells us how much cap headroom exists).
  const hourAgo = new Date(Date.now() - 3600 * 1000);
  const baselineLive = await db.notification.count({
    where: { userId: user.id, family: "COMPLIANCE", suppressed: false, createdAt: { gte: hourAgo } },
  });

  // 1) dedupe window: same key five times → exactly 1 delivered + 4 absorbed.
  const dedupeResults: Array<{ i: number; suppressed: boolean; reason: string | null }> = [];
  for (let i = 0; i < 5; i++) {
    const r = await notifyUser(user.id, {
      family: "COMPLIANCE",
      title: `${runId} dedupe ${i}`,
      body: "anti-storm probe (suppressed rows are honest evidence)",
      dedupeKey: `${runId}-dedupe`,
    });
    dedupeResults.push({ i, suppressed: r.suppressed, reason: r.reason });
  }
  const dedupeDelivered = dedupeResults.filter((r) => !r.suppressed).length;
  const dedupeAbsorbed = dedupeResults.filter((r) => r.suppressed && r.reason === "DEDUPE").length;

  // 2) hourly cap: distinct keys until the cap absorbs the tail.
  const capResults: Array<{ i: number; suppressed: boolean; reason: string | null }> = [];
  for (let i = 0; i < 25; i++) {
    const r = await notifyUser(user.id, {
      family: "COMPLIANCE",
      title: `${runId} cap ${i}`,
      body: "anti-storm probe",
      dedupeKey: `${runId}-cap-${i}`,
    });
    capResults.push({ i, suppressed: r.suppressed, reason: r.reason });
  }
  const capDelivered = capResults.filter((r) => !r.suppressed).length;
  const capAbsorbed = capResults.filter((r) => r.suppressed && r.reason === "HOURLY_CAP").length;

  const result = { runId, baselineLive, dedupeDelivered, dedupeAbsorbed, capDelivered, capAbsorbed };
  const fs = await import("node:fs");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`probe ${runId}: baseline=${baselineLive}; dedupe delivered=${dedupeDelivered} absorbed=${dedupeAbsorbed}; cap delivered=${capDelivered} absorbed=${capAbsorbed}`);
  await db.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});
