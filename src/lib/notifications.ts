// P-04 — Notification taxonomy + anti-storm (Phase 8).
//
// The platform had notification writes scattered across seven modules, each
// hand-picking severity/family. This module is the single writer: one
// taxonomy (family × severity rules) and one anti-storm policy (dedupe
// window, hourly caps, digest) that EVERY notification goes through.
//
// Honesty rules (D-03): a suppressed notification is still RECORDED — as a
// `suppressed` row carrying the same dedupeKey — so an operator can always
// prove how many storms were absorbed and why. Nothing is dropped silently.
import { db } from "@/lib/db";

// ── Taxonomy (P-04): every family the platform can emit, its default ────────
// severity, digest policy and anti-storm knobs. CRITICAL is never capped and
// never digested — a kill-switch event must always break through (C19).
export type NotificationFamily =
  | "RISK"
  | "EXECUTION"
  | "AI_BUDGET"
  | "MODEL_GOVERNANCE"
  | "SYSTEM"
  | "COMPLIANCE"
  // BILLING is in the taxonomy now (P-01/P-05 shape) but DORMANT: no billing
  // code exists until the founder approves B4 pricing (hard gate) — no code
  // path emits it yet.
  | "BILLING";

export interface FamilyPolicy {
  severity: "CRITICAL" | "WARNING" | "INFO";
  /** Duplicate suppression window per dedupeKey (seconds). 0 = no dedupe. */
  dedupeWindowSec: number;
  /** Max live (non-suppressed) notifications per user per hour. 0 = uncapped. */
  hourlyCap: number;
  /** INFO-storm families digest at read time instead of spamming the feed. */
  digest: boolean;
}

export const TAXONOMY: Record<NotificationFamily, FamilyPolicy> = {
  // Safety-critical: break through everything.
  RISK: { severity: "WARNING", dedupeWindowSec: 300, hourlyCap: 0, digest: false },
  EXECUTION: { severity: "CRITICAL", dedupeWindowSec: 60, hourlyCap: 0, digest: false },
  // Cost & governance: noisy by nature — capped + digested.
  AI_BUDGET: { severity: "INFO", dedupeWindowSec: 900, hourlyCap: 6, digest: true },
  MODEL_GOVERNANCE: { severity: "INFO", dedupeWindowSec: 600, hourlyCap: 10, digest: true },
  // Operational background: capped and digested.
  SYSTEM: { severity: "INFO", dedupeWindowSec: 300, hourlyCap: 10, digest: true },
  // Compliance ops (P-07): retention runs, key lifecycle audits.
  COMPLIANCE: { severity: "INFO", dedupeWindowSec: 60, hourlyCap: 20, digest: true },
  // Dormant until the founder ratifies B4 pricing — see docs/PRICING_B4.md.
  BILLING: { severity: "INFO", dedupeWindowSec: 3600, hourlyCap: 4, digest: true },
};

export function policyFor(family: string): FamilyPolicy {
  return TAXONOMY[family as NotificationFamily] ?? TAXONOMY.SYSTEM;
}

export interface NotifySpec {
  family: NotificationFamily;
  severity?: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  body?: string;
  /** Anti-storm identity: repeats with the same key inside the window are
   *  absorbed (recorded as suppressed). null = never deduped. */
  dedupeKey?: string | null;
}

export interface NotifyOutcome {
  id: string | null;
  suppressed: boolean;
  /** Why the write was absorbed: DEDUPE | HOURLY_CAP | null when delivered. */
  reason: "DEDUPE" | "HOURLY_CAP" | null;
}

/**
 * The ONLY way the platform writes a notification. Applies the family policy:
 * dedupe window → hourly cap → deliver. Suppressed attempts are recorded
 * (suppressed=true) so the storm is auditable, then hidden from the feed.
 */
export async function notifyUser(userId: string, spec: NotifySpec): Promise<NotifyOutcome> {
  const policy = policyFor(spec.family);
  const severity = spec.severity ?? policy.severity;
  const digest = policy.digest ? "DIGEST" : "IMMEDIATE";

  // ── 1. dedupe window ──────────────────────────────────────────────────────
  if (spec.dedupeKey && policy.dedupeWindowSec > 0) {
    const windowStart = new Date(Date.now() - policy.dedupeWindowSec * 1000);
    const dup = await db.notification.findFirst({
      where: { userId, dedupeKey: spec.dedupeKey, createdAt: { gte: windowStart } },
      orderBy: { createdAt: "desc" },
      select: { suppressed: true },
    });
    if (dup) {
      // Absorb the repeat but RECORD it (suppressed row = honest evidence).
      const row = await db.notification.create({
        data: {
          userId,
          severity,
          family: spec.family,
          title: spec.title,
          body: spec.body ?? "",
          dedupeKey: spec.dedupeKey,
          suppressed: true,
          digest,
        },
        select: { id: true },
      });
      return { id: row.id, suppressed: true, reason: "DEDUPE" };
    }
  }

  // ── 2. hourly cap (CRITICAL families are uncapped — kill-switch breaks
  //      through by construction: their cap is 0) ──────────────────────────
  if (policy.hourlyCap > 0) {
    const hourAgo = new Date(Date.now() - 3600 * 1000);
    const liveLastHour = await db.notification.count({
      where: { userId, family: spec.family, suppressed: false, createdAt: { gte: hourAgo } },
    });
    if (liveLastHour >= policy.hourlyCap) {
      const row = await db.notification.create({
        data: {
          userId,
          severity,
          family: spec.family,
          title: spec.title,
          body: spec.body ?? "",
          dedupeKey: spec.dedupeKey ?? `cap:${spec.family}`,
          suppressed: true,
          digest,
        },
        select: { id: true },
      });
      return { id: row.id, suppressed: true, reason: "HOURLY_CAP" };
    }
  }

  // ── 3. deliver ────────────────────────────────────────────────────────────
  const row = await db.notification.create({
    data: {
      userId,
      severity,
      family: spec.family,
      title: spec.title,
      body: spec.body ?? "",
      dedupeKey: spec.dedupeKey ?? null,
      digest,
    },
    select: { id: true },
  });
  return { id: row.id, suppressed: false, reason: null };
}

/**
 * Read-time digest (P-04): DIGEST-family notifications from the last
 * `windowSec` collapse into one virtual row per family; IMMEDIATE ones (and
 * everything CRITICAL, which is never digested by policy) always surface.
 * Suppressed rows never surface — they are counted instead.
 */
export function digestFeed(
  rows: Array<{
    id: string;
    severity: string;
    family: string;
    title: string;
    body: string;
    suppressed: boolean;
    digest: string;
    createdAt: Date;
  }>,
  windowSec = 3600,
): { feed: typeof rows; digested: Array<{ family: string; count: number; latestTitle: string; latestAt: Date }>; suppressedCount: number } {
  const windowStart = Date.now() - windowSec * 1000;
  const live = rows.filter((r) => !r.suppressed);
  const suppressedCount = rows.length - live.length;
  const feed: typeof rows = [];
  const digestGroups = new Map<string, typeof rows>();
  for (const r of live) {
    const inWindow = r.createdAt.getTime() >= windowStart;
    if (r.digest === "DIGEST" && inWindow) {
      const g = digestGroups.get(r.family) ?? [];
      g.push(r);
      digestGroups.set(r.family, g);
    } else {
      feed.push(r);
    }
  }
  const digested = [...digestGroups.entries()].map(([family, g]) => {
    const latest = g.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    return { family, count: g.length, latestTitle: latest.title, latestAt: latest.createdAt };
  });
  return { feed, digested, suppressedCount };
}
