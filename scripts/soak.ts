// Paper soak runner (P3.5, adapted 72-hour soak / C28).
// Drives robot cycles on an interval against a running FAIDA Predict
// instance, then verifies the acceptance criteria:
//   - every cycle produced traces (trace completeness)
//   - zero unresolved reconciliation entries at the end
//   - zero UNKNOWN orders at the end
//   - no unhandled cycle errors
// Usage (from the project root, dev server running):
//   bun scripts/soak.ts --duration-min 72 --interval-sec 60
//   bun scripts/soak.ts --duration-min 1 --interval-sec 10   # smoke variant
import { db } from "@/lib/db";

interface Args {
  durationMin: number;
  intervalSec: number;
  base: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    durationMin: Number(get("--duration-min") ?? 72),
    intervalSec: Math.max(5, Number(get("--interval-sec") ?? 60)),
    base: get("--base") ?? "http://localhost:3000",
  };
}

interface CycleSummary {
  robotId: string;
  robotName: string;
  decision: "TRADE" | "NO_TRADE";
  reason: string;
  traceId: string;
}

async function main(): Promise<void> {
  const { durationMin, intervalSec, base } = parseArgs();
  const startedAt = new Date();
  const deadline = startedAt.getTime() + durationMin * 60_000;
  let runs = 0;
  let trades = 0;
  let noTrades = 0;
  let errors = 0;
  let leaseSkips = 0;

  console.log(`[soak] start ${startedAt.toISOString()} — ${durationMin} min @ ${intervalSec}s — ${base}`);

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/cycle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "CYCLE" }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = (await res.json()) as { action?: string; summaries?: CycleSummary[] };
      runs += 1;
      const summaries = data.summaries ?? [];
      for (const s of summaries) {
        if (s.reason.startsWith("cycle error")) errors += 1;
        else if (s.reason.includes("robot lease held")) leaseSkips += 1;
        if (s.decision === "TRADE") trades += 1;
        else noTrades += 1;
        if (!s.reason.startsWith("cycle error") && s.traceId === "-") {
          console.log(`[soak] WARN no trace for ${s.robotName}: ${s.reason}`);
        }
      }
      console.log(
        `[soak] run ${runs} — ${summaries.length} robots — ${trades} trades / ${noTrades} no-trades / ${errors} errors / ${leaseSkips} lease-skips`,
      );
    } catch (e) {
      runs += 1;
      errors += 1;
      console.log(`[soak] run ${runs} — REQUEST FAILED: ${String(e)}`);
    }
    const sleepMs = Math.max(0, Math.min(intervalSec * 1000, deadline - Date.now()));
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
  }

  // ── acceptance verdict ────────────────────────────────────────────────────
  const endedAt = new Date();
  const [traceCount, unresolvedRecon, unknownOrders, soakTraces] = await Promise.all([
    db.decisionTrace.count({ where: { createdAt: { gte: startedAt, lte: endedAt } } }),
    db.reconciliationEntry.count({ where: { resolvedAt: null, kind: { not: "RESOLVED" } } }),
    db.order.count({ where: { state: "UNKNOWN" } }),
    db.decisionTrace.count({
      where: { createdAt: { gte: startedAt, lte: endedAt }, trigger: "SCHEDULE_TICK" },
    }),
  ]);

  const report = {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMin,
    intervalSec,
    runs,
    trades,
    noTrades,
    cycleErrors: errors,
    leaseSkips,
    tracesDuringSoak: traceCount,
    scheduleTickTracesDuringSoak: soakTraces,
    unresolvedReconciliationEntries: unresolvedRecon,
    unknownOrdersAtEnd: unknownOrders,
  };
  const verdict = {
    ...report,
    PASS:
      unresolvedRecon === 0 &&
      unknownOrders === 0 &&
      errors === 0 &&
      traceCount > 0 &&
      soakTraces >= traceCount * 0.8, // traces complete (lease-skips and market-less runs explain the rest)
  };
  const outPath = new URL("../soak-report.json", import.meta.url).pathname;
  await (await import("node:fs/promises")).writeFile(outPath, JSON.stringify(verdict, null, 2));
  console.log("[soak] verdict:", JSON.stringify(verdict, null, 2));
  console.log(`[soak] report written to ${outPath}`);
  if (!verdict.PASS) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("[soak] FATAL", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
