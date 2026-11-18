"use client";

// FAIDA Predict — Dashboard (venue-first cockpit) + per-venue Workspace.
//
// The dashboard answers the founder's three questions at a glance:
//   1. What is the total balance / exposure / today's flow?   → KPI band
//   2. Which venue, market and robot are in trade right now?  → "In trade now"
//   3. Where do I go to work on a venue?                      → venue grid:
//      pick a venue → its workspace → robot creation, markets, orders.
//
// Every element names its venue (B11). The venue grid is driven by the
// registry rollup (`venues` in /api/dashboard), never by scattered data.

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  type DashboardDTO,
  type MarketDTO,
  type TraceDTO,
  type VenueStatDTO,
  FAMILY_LABEL,
} from "./types";
import { c, card, mono, fmtCents, Pill, Meter, SectionTitle, VenueBadge, StateChip, venueScopeStyle } from "./ui";
import { ROLE_LABEL, VENUE_LABEL, VENUES } from "@/lib/venues";
import { EMPTY_ENTRY_RULES, VENUE_ENTRY_RULES } from "@/lib/venue/rules";

// B12: role chips are neutral gray — the venue's own color (badge, card strip,
// workspace interior) carries the identity, so role text never fights the hue.
function roleChipClass(_role: string): string {
  return `${c.text3} bg-[#121722]`;
}

function pnlClass(v: number | null): string {
  if (v == null || v === 0) return c.text3;
  return v > 0 ? c.gain : c.loss;
}

function pnlText(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${fmtCents(v)}`;
}

// ── Dashboard (default view) — redesigned overview ───────────────────────────
// Structure follows the ratified redesign: greeting header, KPI band with the
// segmented exposure bar, compact venue tile row, robots table + decision
// feed, then the in-trade detail with the risk/activity rail. Every number is
// registry- or ledger-driven (B9/B11/B12/D-03) — nothing on this page is mock.

export function DashboardView(props: {
  dash: DashboardDTO | null;
  markets: MarketDTO[];
  busy: string | null;
  onSync: () => void;
  onCycle: () => void;
  onReconcile: () => void;
  hasUnknown: boolean;
  onControl: (body: Record<string, unknown>, okMsg: string) => void;
  onOpenVenue: (venueId: string) => void;
  onOpenRobot: (robotId: string) => void;
}) {
  const { dash, onCycle, onReconcile, hasUnknown, onSync, onControl, onOpenVenue, onOpenRobot } = props;
  const [intervalSec, setIntervalSec] = useState(60);
  // Greeting + date live in the browser clock; the server snapshot renders
  // a neutral string so server and client HTML stay identical (no hydration
  // drift) — useSyncExternalStore keeps this lint-clean (no setState-in-effect).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!dash) return <DashboardSkeleton />;
  const exposurePct = dash.allocatedCents > 0 ? (dash.exposureCents / dash.allocatedCents) * 100 : 0;
  const aiProvider = dash.providers.find((p) => p.enabled) ?? dash.providers[0];
  const ctl = dash.control;
  const paused = ctl?.pause.paused ?? false;
  const auto = ctl?.autopilot;
  const lastRun = auto?.lastRun ?? null;

  // per-robot open-position rollup for the robots table (paper marks)
  const robotStats = new Map<string, { open: number; pnl: number }>();
  for (const p of dash.positions) {
    const name = p.robot?.name ?? "—";
    const cur = robotStats.get(name) ?? { open: 0, pnl: 0 };
    cur.open += 1;
    cur.pnl += p.unrealizedCents ?? 0;
    robotStats.set(name, cur);
  }
  const robotsSorted = [...dash.robots].sort((a, b) => {
    const pa = robotStats.get(a.name)?.pnl ?? null;
    const pb = robotStats.get(b.name)?.pnl ?? null;
    if (pa == null && pb == null) return a.name.localeCompare(b.name);
    if (pa == null) return 1;
    if (pb == null) return -1;
    return pb - pa;
  });

  // "In trade now" — venue, market and robot per open position + marks.
  const positions = dash.positions;
  const venuesInTrade = new Set(positions.map((p) => p.market?.venue ?? "?")).size;
  const totalUnrealized = positions.reduce((a, p) => a + (p.unrealizedCents ?? 0), 0);
  const liveVenues = VENUES.filter((v) => v.adapter === "LIVE");
  const pendingVenues = VENUES.filter((v) => v.adapter === "PENDING");
  const activeRobots = dash.robots.filter((r) => ["RUNNING", "PAPER_ONLY"].includes(r.status)).length;
  const pausedRobots = dash.robots.filter((r) => r.status.startsWith("PAUSED")).length;

  // today's P&L context: decisions + fills recorded today (browser clock)
  const todayKey = new Date().toDateString();
  const decisionsToday = dash.traces.filter((t) => new Date(t.createdAt).toDateString() === todayKey).length;
  const fillsToday = dash.orders.filter((o) => o.state === "FILLED" && new Date(o.createdAt).toDateString() === todayKey).length;
  const todayPct = dash.balanceCents > 0 ? (dash.todayFlowCents / dash.balanceCents) * 100 : 0;
  const allocatedPct = dash.balanceCents > 0 ? (dash.allocatedCents / dash.balanceCents) * 100 : 0;

  const setupDone = dash.marketCount > 0 && dash.traces.length > 0 && !!auto?.enabled;
  const firstName = (dash.user.name ?? "Founder").split(" ")[0];
  const hour = mounted ? new Date().getHours() : -1;
  const greeting = hour < 0 ? "Welcome back" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateStr = mounted ? new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" }) : "—";
  const walletAddr = dash.wallet?.address ?? "";
  const walletShort = walletAddr ? `${walletAddr.slice(0, 6)}…${walletAddr.slice(-5)}` : "no wallet linked";

  // segmented exposure bar — one segment per venue with open notional (B12)
  const exposureSegments = VENUES.map((v) => {
    const s = dash.venues.find((x) => x.venue === v.id);
    return { id: v.id, hex: v.hex, cents: s?.exposureCents ?? 0 };
  }).filter((s) => s.cents > 0);
  const exposureTotal = exposureSegments.reduce((a, s) => a + s.cents, 0) || 1;

  return (
    <div className="flex flex-col gap-6">
      {/* hero — the big picture in one glance: balance, today, actions, venue split */}
      <section className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-[#0E121A] p-6 sm:p-8">
        <span aria-hidden className="pointer-events-none absolute -left-24 -top-32 h-80 w-80 rounded-full bg-[#3E8EFF] opacity-[0.16] blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute right-10 -top-24 h-64 w-64 rounded-full bg-[#F26BC8] opacity-[0.12] blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-[#14D9C4] opacity-[0.10] blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-24 -right-16 h-64 w-64 rounded-full bg-[#FFB25C] opacity-[0.10] blur-3xl" />

        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className={`text-[16px] ${c.text2}`}>
              {greeting}, <span className={`font-semibold ${c.text}`}>{firstName}</span> · {dateStr}
            </p>
            <div className={`mt-5 text-[14px] font-semibold uppercase tracking-[0.14em] ${c.text2}`}>Paper balance</div>
            <div className="mt-1 font-display text-[48px] font-bold leading-none tracking-tight text-white sm:text-[64px]">
              {fmtCents(dash.balanceCents)}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <span
                className={`rounded-full px-3.5 py-1.5 text-[15px] font-semibold ${
                  dash.todayFlowCents > 0
                    ? "bg-[#2FC08E]/15 text-[#4FDCA6]"
                    : dash.todayFlowCents < 0
                      ? "bg-[#F0525F]/15 text-[#FF7A85]"
                      : "bg-white/[0.06] text-[#C9D0DC]"
                }`}
              >
                Today {pnlText(dash.todayFlowCents)} ({todayPct >= 0 ? "+" : ""}
                {todayPct.toFixed(2)}%)
              </span>
              <span className="rounded-full bg-white/[0.06] px-3.5 py-1.5 text-[15px] text-[#C9D0DC]">
                {fmtCents(dash.allocatedCents)} with robots · {allocatedPct.toFixed(0)}%
              </span>
              <span className="rounded-full bg-white/[0.06] px-3.5 py-1.5 text-[15px] text-[#C9D0DC]">
                {activeRobots} running · {pausedRobots} paused
              </span>
              <span className="rounded-full bg-white/[0.06] px-3.5 py-1.5 text-[15px] text-[#C9D0DC]">
                {decisionsToday} decisions · {fillsToday} fills today
              </span>
              {dash.openAlerts > 0 && (
                <span className="rounded-full bg-[#E3A63B]/15 px-3.5 py-1.5 text-[15px] font-semibold text-[#F2BE5C]">
                  {dash.openAlerts} alert{dash.openAlerts === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              className="h-12 rounded-xl border-white/15 bg-white/[0.04] px-5 text-[16px] text-white hover:bg-white/[0.09]"
              onClick={() => onSync()}
              disabled={props.busy === "sync"}
            >
              {props.busy === "sync" ? "Syncing…" : "Sync all venues"}
            </Button>
            <Button
              className="h-12 rounded-xl bg-white px-5 text-[16px] font-semibold text-[#0B0E14] hover:bg-[#DCE3EE]"
              onClick={onCycle}
              disabled={props.busy !== null}
            >
              Run robot cycle
            </Button>
          </div>
        </div>

        {/* exposure split by venue color */}
        <div className="relative mt-8">
          <div className={`mb-2 flex flex-wrap items-baseline justify-between gap-2 text-[14px] ${c.text2}`}>
            <span>
              Open exposure <span className={`font-semibold ${c.text}`}>{fmtCents(dash.exposureCents)}</span> · {exposurePct.toFixed(0)}% of allocation
            </span>
            <span>Per-event cap {dash.exposureLimitPct}% · wallet {walletShort}</span>
          </div>
          <div className="flex h-3 gap-1 overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label="Open exposure split by venue">
            {exposureSegments.map((s) => (
              <span
                key={s.id}
                className="h-full rounded-full"
                style={{ width: `${Math.max(2, (s.cents / exposureTotal) * 100)}%`, backgroundColor: s.hex }}
                title={`${VENUE_LABEL[s.id] ?? s.id}: ${fmtCents(s.cents)}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* platform paused — the one state that overrides everything */}
      {paused && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#F0525F]/50 bg-[#F0525F]/10 px-5 py-4">
          <span className="rounded-lg bg-[#F0525F]/20 px-3 py-1.5 text-[14px] font-bold text-[#FF7A85]">■ Everything is paused</span>
          <span className={`text-[15px] ${c.text2}`}>Robots and new orders are stopped until you resume. Reason: {ctl?.pause.reason ?? "manual pause"}</span>
          <Button variant="outline" className="ml-auto h-10 rounded-xl border-[#F0525F]/50 bg-transparent text-[15px] text-[#FF7A85] hover:bg-[#F0525F]/10" onClick={() => onControl({ action: "RESUME" }, "Platform resumed")} disabled={props.busy !== null}>
            Resume
          </Button>
        </div>
      )}

      {/* get started — replaces an empty page with the three steps that fill it */}
      {!setupDone && (
        <section className="rounded-3xl border border-white/[0.06] bg-[#0E121A] p-6 sm:p-7">
          <h2 className="font-display text-[24px] font-bold tracking-tight text-white">Get your robots trading</h2>
          <p className={`mt-1 text-[16px] ${c.text2}`}>Three steps fill this dashboard with live markets and decisions. Everything stays paper money.</p>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <SetupStep n={1} done={dash.marketCount > 0} hex="#3E8EFF" title="Sync the venues" body="Pull live markets from Polymarket, Manifold, Limitless and Kalshi."
              action={dash.marketCount > 0 ? `${dash.marketCount} markets synced` : props.busy === "sync" ? "Syncing…" : "Sync now"}
              onAction={dash.marketCount > 0 ? undefined : () => onSync()} disabled={props.busy !== null} />
            <SetupStep n={2} done={dash.traces.length > 0} hex="#14D9C4" title="Run a robot cycle" body="Each robot checks its markets once and records every decision with its reasons."
              action={dash.traces.length > 0 ? `${dash.traces.length} decisions recorded` : "Run cycle"}
              onAction={dash.traces.length > 0 ? undefined : onCycle} disabled={props.busy !== null || dash.marketCount === 0} />
            <SetupStep n={3} done={!!auto?.enabled} hex="#F26BC8" title="Turn on autopilot" body="Robots run on their own every minute. You can pause everything at any time."
              action={auto?.enabled ? "Autopilot is on" : "Start autopilot"}
              onAction={auto?.enabled ? undefined : () => onControl({ action: "AUTOPILOT_START", intervalSec: 60 }, "Autopilot started — cycles every 60s")}
              disabled={props.busy !== null || dash.marketCount === 0} />
          </div>
        </section>
      )}

      {/* venues — one bold color block per venue */}
      <section>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-[24px] font-bold tracking-tight text-white">Venues</h2>
          <span className={`text-[15px] ${c.text2}`}>
            {liveVenues.length} live · {pendingVenues.length} not available yet
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {VENUES.map((v) => {
            const stat = dash.venues.find((s) => s.venue === v.id);
            return <VenueCard key={v.id} venueDef={v} stat={stat} onOpen={() => onOpenVenue(v.id)} />;
          })}
        </div>
      </section>

      {/* robots table + decision feed — the two working surfaces, side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <span className={`text-[15px] font-semibold ${c.text}`}>Robots</span>
              <span className={`text-[12.5px] ${c.text3}`}>
                {activeRobots} active · {pausedRobots} paused · open P&L is the paper mark
              </span>
            </div>
            <div className="fd-scroll max-h-[420px] overflow-y-auto">
              <table className="w-full">
                <thead className={`sticky top-0 ${c.surface}`}>
                  <tr className={`border-b text-left text-[12px] tracking-wider ${c.border} ${c.text3}`}>
                    <th className="px-4 py-2.5 font-semibold">ROBOT</th>
                    <th className="px-3 py-2.5 font-semibold">VENUE</th>
                    <th className="hidden px-3 py-2.5 font-semibold sm:table-cell">STRATEGY</th>
                    <th className="px-3 py-2.5 font-semibold">STATUS</th>
                    <th className="hidden px-3 py-2.5 font-semibold md:table-cell">ALLOC</th>
                    <th className="px-3 py-2.5 font-semibold">OPEN</th>
                    <th className="px-4 py-2.5 font-semibold">OPEN P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {robotsSorted.map((r) => {
                    const rs = robotStats.get(r.name);
                    const pnl = rs && rs.open > 0 ? rs.pnl : null;
                    return (
                      <tr
                        key={r.id}
                        className={`cursor-pointer border-b text-[14px] last:border-0 ${c.border} hover:bg-[#161D2B]`}
                        onClick={() => onOpenRobot(r.id)}
                        title={`Open ${r.name} — robot detail`}
                      >
                        <td className="px-4 py-2.5">
                          <button
                            className={`font-semibold ${c.text} hover:underline`}
                            onClick={(e) => { e.stopPropagation(); onOpenVenue(r.venue); }}
                            title={`Open the ${VENUE_LABEL[r.venue] ?? r.venue} workspace`}
                          >
                            {r.name}
                          </button>
                        </td>
                        <td className="px-3 py-2.5"><VenueBadge venue={r.venue} /></td>
                        <td className={`hidden px-3 py-2.5 sm:table-cell ${c.text2}`}>{FAMILY_LABEL[r.family] ?? r.family}</td>
                        <td className="px-3 py-2.5"><Pill status={r.status} /></td>
                        <td className={`hidden px-3 py-2.5 md:table-cell ${mono} ${c.text2}`}>{fmtCents(r.allocatedCents)}</td>
                        <td className={`px-3 py-2.5 ${mono} ${c.text}`}>
                          {rs?.open ?? 0}
                          <span className={`text-[12px] ${c.text3}`}>/{r.maxOpenPositions}</span>
                        </td>
                        <td className={`px-4 py-2.5 ${mono} font-semibold ${pnlClass(pnl)}`}>{pnlText(pnl)}</td>
                      </tr>
                    );
                  })}
                  {robotsSorted.length === 0 && (
                    <tr>
                      <td colSpan={7} className={`px-4 py-8 text-center text-[14px] ${c.text3}`}>
                        No robots yet — Robot Studio → New robot starts the creation wizard.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <DecisionFeed traces={dash.traces} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* in trade now */}
        <div className="lg:col-span-2">
          <div className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <span className={`text-[15px] font-semibold ${c.text}`}>In trade now</span>
              <span className={`text-[12px] ${c.text3}`}>marks = venue's last synced price (paper)</span>
            </div>
            <div className="fd-scroll max-h-[360px] overflow-y-auto">
              <table className="w-full">
                <thead className={`sticky top-0 ${c.surface}`}>
                  <tr className={`border-b text-left text-[12px] tracking-wider ${c.border} ${c.text3}`}>
                    <th className="px-4 py-2.5 font-semibold">VENUE</th>
                    <th className="px-3 py-2.5 font-semibold">MARKET</th>
                    <th className="px-3 py-2.5 font-semibold">ROBOT</th>
                    <th className="px-3 py-2.5 font-semibold">SIDE</th>
                    <th className="px-3 py-2.5 font-semibold">SIZE</th>
                    <th className="px-3 py-2.5 font-semibold">ENTRY → MARK</th>
                    <th className="px-3 py-2.5 font-semibold">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => {
                    const mark = p.side === "YES" ? p.market?.yesPriceCents : p.market?.noPriceCents;
                    return (
                      <tr key={p.id} className={`border-b text-[14px] last:border-0 ${c.border} hover:bg-[#161D2B]`}>
                        <td className="px-4 py-2.5">{p.market?.venue ? <VenueBadge venue={p.market.venue} /> : "—"}</td>
                        <td className={`max-w-[240px] px-3 py-2.5 ${c.text}`}>
                          <div className="truncate">{p.market?.question}</div>
                        </td>
                        <td className={`max-w-[140px] truncate px-3 py-2.5 ${c.text2}`}>{p.robot?.name}</td>
                        <td className="px-3 py-2.5">
                          <span className={`rounded px-1.5 py-0.5 text-[11.5px] font-bold ${p.side === "YES" ? `${c.gain} bg-[#2FC08E]/10` : `${c.warn} bg-[#E3A63B]/10`}`}>{p.side}</span>
                        </td>
                        <td className={`px-3 py-2.5 ${mono} ${c.text}`}>{fmtCents(p.sizeCents)}</td>
                        <td className={`px-3 py-2.5 ${mono} ${c.text2}`}>
                          {p.avgPriceCents}¢ → {mark != null ? `${mark}¢` : "—"}
                        </td>
                        <td className={`px-3 py-2.5 ${mono} font-semibold ${pnlClass(p.unrealizedCents)}`}>{pnlText(p.unrealizedCents)}</td>
                      </tr>
                    );
                  })}
                  {positions.length === 0 && (
                    <tr>
                      <td colSpan={7} className={`px-4 py-8 text-center text-[14px] ${c.text3}`}>
                        Nothing in trade right now — run a robot cycle, or open a venue workspace and place a paper ticket.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* right rail */}
        <div className="flex flex-col gap-4">
          <div className={`${card} p-4`}>
            <SectionTitle>Portfolio risk</SectionTitle>
            <div className="flex flex-col gap-3">
              <Meter label="Cluster exposure used" pct={exposurePct} detail={`of ${fmtCents(dash.allocatedCents)} allocation`} />
              <Meter label="AI budget" pct={aiProvider ? (aiProvider.spentCents / Math.max(1, aiProvider.monthlyBudgetCents)) * 100 : 0} detail={aiProvider?.enabled ? `${aiProvider.name} enabled` : "no AI key — heuristic mode (add one in Settings)"} tone="ai" />
              <Meter label="Outbox drained" pct={dash.outboxPending === 0 ? 100 : 60} detail={`${dash.outboxPending} pending event(s)`} tone={dash.outboxPending > 0 ? "warn" : "accent"} />
            </div>
          </div>
          <div className={`${card} p-4`}>
            <SectionTitle right={hasUnknown ? <Button size="sm" variant="outline" className={`h-7 border-[#E3A63B]/50 bg-[#121722] text-[#E3A63B] hover:bg-[#1A2432]`} onClick={onReconcile}>Resolve now</Button> : undefined}>
              Recent activity
            </SectionTitle>
            <div className="flex flex-col">
              {dash.notifications.slice(0, 6).map((n) => (
                <div key={n.id} className={`border-b py-2 last:border-0 ${c.border}`}>
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-sm ${n.severity === "CRITICAL" ? "bg-[#F0525F]" : n.severity === "WARNING" ? "bg-[#E3A63B]" : "bg-[#3E9BF0]"}`} />
                    <span className={`text-[13.5px] ${c.text2}`}>{n.title}</span>
                  </div>
                  <div className={`ml-3.5 mt-0.5 text-[12px] ${c.text3}`}>{n.body.slice(0, 90)}</div>
                </div>
              ))}
              {dash.notifications.length === 0 && (
                <div className={`py-3 text-center text-[13.5px] ${c.text3}`}>No notifications — all clear.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* platform control — autopilot (P3.2/S-06) + kill switch (C19/S-07) */}
      <div className={card}>
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="min-w-[190px]">
            <SectionTitle>Autopilot &amp; safety</SectionTitle>
            <div className={`mt-1 text-[12.5px] ${c.text3}`}>You own the switches. Robots never change them.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[60, 120, 300].map((s) => (
              <button key={s} onClick={() => setIntervalSec(s)}
                className={`rounded border px-2 py-1 text-[12.5px] transition-colors ${intervalSec === s ? "border-[#00B0F0] bg-[#00B0F0]/10 text-[#00B0F0]" : `border-[#2C3648] ${c.text3} hover:bg-[#1A2432]`}`}>
                {s}s
              </button>
            ))}
            {auto?.enabled ? (
              <Button size="sm" variant="outline" className={`h-7 border-[#2C3648] bg-[#121722] ${c.text} hover:bg-[#1A2432]`} onClick={() => onControl({ action: "AUTOPILOT_STOP" }, "Autopilot stopped")} disabled={props.busy !== null}>
                Stop autopilot
              </Button>
            ) : (
              <Button size="sm" className="h-7 bg-[#00B0F0] font-semibold text-[#001040] hover:bg-[#2FC1F5]" onClick={() => onControl({ action: "AUTOPILOT_START", intervalSec }, `Autopilot started — cycles every ${intervalSec}s`)} disabled={props.busy !== null}>
                Start autopilot
              </Button>
            )}
          </div>
          <div className={`text-[13px] lg:ml-auto ${c.text2} ${mono}`}>
            {lastRun
              ? `last run ${new Date(lastRun.at).toLocaleTimeString()} — ${lastRun.skipped ? `skipped (${lastRun.skipped})` : `${lastRun.cycles} robots · ${lastRun.trades} trade · ${lastRun.noTrades} no-trade${lastRun.errors ? ` · ${lastRun.errors} ERR` : ""}`}`
              : "autopilot never ran — press Start"}
          </div>
          <Button size="sm" variant="outline" className={`h-7 shrink-0 border-[#F0525F]/50 bg-transparent text-[#F0525F] hover:bg-[#F0525F]/10`} onClick={() => onControl({ action: "PAUSE", reason: "manual pause from Overview" }, "PLATFORM PAUSED — all cycles and orders refuse until resume")} disabled={props.busy !== null || paused}>
            {paused ? "Paused" : "Global pause"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── venue card — a solid block of the venue's own color (B12) ─────────────────
// Live venues render the full hue with dark text; venues without a live
// adapter render a dark, hatched card in their muted hue and say why.
const VENUE_TAGLINE: Record<string, string> = {
  POLYMARKET: "Main venue · Polygon · USDC",
  MANIFOLD: "Play money · safe test ground",
  LIMITLESS: "Crypto order book · Base · USDC",
  KALSHI: "US regulated exchange · USD",
  AZURO: "Sports betting · EVM",
  DRIFT_BET: "Solana prediction markets",
};

function VenueCard({ venueDef: v, stat, onOpen }: { venueDef: (typeof VENUES)[number]; stat: VenueStatDTO | undefined; onOpen: () => void }) {
  const live = v.adapter === "LIVE";
  const suspended = v.id === "DRIFT_BET";
  const pnl = stat && stat.openPositions > 0 ? stat.unrealizedCents : null;
  if (!live) {
    return (
      <button
        onClick={onOpen}
        aria-label={`Open ${v.label} workspace`}
        className="group relative flex min-h-[200px] flex-col overflow-hidden rounded-3xl border border-dashed p-6 text-left transition-colors hover:bg-white/[0.02]"
        style={{
          borderColor: `color-mix(in srgb, ${v.hex} 40%, transparent)`,
          backgroundImage: `repeating-linear-gradient(135deg, color-mix(in srgb, ${v.hex} 6%, transparent) 0 12px, transparent 12px 24px)`,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-display text-[24px] font-bold" style={{ color: `color-mix(in srgb, ${v.hex} 70%, #C9D0DC)` }}>{v.label}</div>
            <div className={`mt-1 text-[15px] ${c.text2}`}>{VENUE_TAGLINE[v.id] ?? ""}</div>
          </div>
          <span className="rounded-full bg-white/[0.06] px-3 py-1 text-[13px] font-semibold text-[#C9D0DC]">{suspended ? "Suspended" : "Coming soon"}</span>
        </div>
        <p className={`mt-auto pt-6 text-[15px] leading-relaxed ${c.text2}`}>
          {suspended
            ? "This market has been offline since the April 2026 exploit. Waiting on a decision for this slot."
            : "The connection is built and is waiting on a final contract test before it goes live."}
        </p>
      </button>
    );
  }
  return (
    <button
      onClick={onOpen}
      aria-label={`Open ${v.label} workspace`}
      className="group relative flex min-h-[200px] flex-col overflow-hidden rounded-3xl p-6 text-left text-[#071018] shadow-[0_18px_40px_-24px_rgba(0,0,0,0.8)] transition-transform duration-150 hover:-translate-y-1"
      style={{ backgroundColor: v.hex }}
    >
      <span aria-hidden className="pointer-events-none absolute -right-4 -top-10 font-display text-[160px] font-bold leading-none opacity-[0.13]">
        {v.label.slice(0, 1)}
      </span>
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-[26px] font-bold leading-tight">{v.label}</div>
          <div className="mt-1 text-[15px] font-medium opacity-75">{VENUE_TAGLINE[v.id] ?? ""}</div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-black/15 px-3 py-1 text-[13px] font-bold">
          <span className="h-2 w-2 rounded-full bg-[#071018]" aria-hidden />
          Live
        </span>
      </div>
      <div className="relative mt-auto grid grid-cols-3 gap-3 pt-6">
        <div>
          <div className="font-display text-[30px] font-bold leading-none">{stat?.markets ?? 0}</div>
          <div className="mt-1.5 text-[14px] font-medium opacity-70">markets</div>
        </div>
        <div>
          <div className="font-display text-[30px] font-bold leading-none">
            {stat?.robotsActive ?? 0}
            <span className="text-[18px] opacity-60">/{stat?.robotsTotal ?? 0}</span>
          </div>
          <div className="mt-1.5 text-[14px] font-medium opacity-70">robots on</div>
        </div>
        <div>
          <div className="font-display text-[22px] font-bold leading-[30px]">{pnl == null ? fmtCents(stat?.exposureCents ?? 0) : pnlText(pnl)}</div>
          <div className="mt-1.5 text-[14px] font-medium opacity-70">{pnl == null ? "in trade" : "open P&L"}</div>
        </div>
      </div>
    </button>
  );
}

function SetupStep(props: { n: number; done: boolean; hex: string; title: string; body: string; action: string; onAction?: () => void; disabled?: boolean }) {
  const { n, done, hex, title, body, action, onAction, disabled } = props;
  return (
    <div className={`flex flex-col gap-3 rounded-2xl border p-5 ${done ? "border-white/[0.06] bg-white/[0.02]" : "border-white/10 bg-[#121722]"}`}>
      <div className="flex items-center gap-3">
        <span
          className="grid h-10 w-10 place-items-center rounded-xl font-display text-[18px] font-bold"
          style={done ? { background: "rgba(47,192,142,0.15)", color: "#4FDCA6" } : { background: hex, color: "#071018" }}
          aria-hidden
        >
          {done ? "✓" : n}
        </span>
        <span className="text-[18px] font-semibold text-white">{title}</span>
      </div>
      <p className={`text-[15px] leading-relaxed ${c.text2}`}>{body}</p>
      {onAction ? (
        <Button
          className="mt-auto h-11 rounded-xl text-[15px] font-semibold"
          style={{ background: hex, color: "#071018" }}
          onClick={onAction}
          disabled={disabled}
        >
          {action}
        </Button>
      ) : (
        <span className="mt-auto text-[15px] font-semibold text-[#4FDCA6]">✓ {action}</span>
      )}
    </div>
  );
}

// ── Decision feed — the highest-value surface: every robot decision with its
// reason, venue-hued bar for scannability (redesign ratification). Rows reuse
// the shared TraceRow, so expanding one shows the full A-08 evidence.
function DecisionFeed({ traces }: { traces: TraceDTO[] }) {
  return (
    <div className={`${card} overflow-hidden`}>
      <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <span className={`text-[15px] font-semibold ${c.text}`}>Decision feed</span>
        <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold tracking-wide ${c.bright}`}>
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00B0F0] opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#00B0F0]" />
          </span>
          LIVE
        </span>
      </div>
      <div className="fd-scroll max-h-[420px] overflow-y-auto px-4 pb-3">
        {traces.length === 0 ? (
          <div className={`py-8 text-center text-[14px] ${c.text3}`}>
            No decisions yet — run a robot cycle and every verdict lands here with its risk checks.
          </div>
        ) : (
          traces.slice(0, 8).map((t) => (
            <div key={t.id} className="flex gap-2.5">
              <span
                className="vc-scope mt-2 h-8 w-[3px] shrink-0 rounded-full vc-bg"
                style={t.market?.venue ? venueScopeStyle(t.market.venue) : undefined}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <TraceRow t={t} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── venue workspace (drilldown) — rebuilt per the ratified redesign artifact ──
// Layout: venue header (avatar tile + display name + live/role chips + actions)
// → five-stat KPI band (incl. real data freshness from Market.updatedAt) →
// markets table (left ⅔: filter chips, 0-100 price bar, real volume column,
// single-line tabular numerics) → right rail (robots with paper-mark P&L,
// click-through to robot detail + the venue rules the engine actually
// enforces) → positions / orders / decisions sections. B12: the whole room
// inherits the venue accent via vc-scope.
export function VenueWorkspace(props: {
  venueId: string;
  dash: DashboardDTO | null;
  markets: MarketDTO[];
  busy: string | null;
  onBack: () => void;
  onSyncVenue: (venue: string) => void;
  onCycle: () => void;
  onTrade: (m: MarketDTO) => void;
  onCreateRobot: (venueId: string) => void;
  onControl: (body: Record<string, unknown>, okMsg: string) => void;
  onOpenRobot: (robotId: string) => void;
}) {
  const { venueId, dash, markets, busy, onBack, onSyncVenue, onCycle, onTrade, onCreateRobot, onOpenRobot } = props;
  const v = VENUES.find((x) => x.id === venueId);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [mktFilter, setMktFilter] = useState<"all" | "closing" | "thin">("all");
  if (!dash || !v) return <DashboardSkeleton />;
  const stat = dash.venues.find((s) => s.venue === venueId);
  const vRobots = dash.robots.filter((r) => r.venue === venueId);
  const vMarkets = markets.filter((m) => m.venue === venueId);
  const vPositions = dash.positions.filter((p) => p.market?.venue === venueId);
  const vOrders = dash.orders.filter((o) => o.market?.venue === venueId);
  const vTraces = dash.traces.filter((t) => t.market?.venue === venueId);
  const live = v.adapter === "LIVE";
  const rules = VENUE_ENTRY_RULES[venueId] ?? EMPTY_ENTRY_RULES;

  // per-robot paper-mark P&L (same rollup as the overview robots table)
  const robotPnl = new Map<string, { open: number; pnl: number }>();
  for (const p of vPositions) {
    const name = p.robot?.name ?? "—";
    const cur = robotPnl.get(name) ?? { open: 0, pnl: 0 };
    cur.open += 1;
    cur.pnl += p.unrealizedCents ?? 0;
    robotPnl.set(name, cur);
  }

  // A-04 visibility: positions on related markets share an eventKey; their
  // exposure stacks in the per-event risk check, so the cluster size is
  // shown right in the workspace ("stacks visibly", not just inside traces).
  const clusterOf = new Map<string, number>();
  for (const p of vPositions) {
    const key = (p.market as { eventKey?: string | null } | undefined)?.eventKey;
    if (key) clusterOf.set(key, (clusterOf.get(key) ?? 0) + 1);
  }

  // data freshness — age of the venue's last market sync (max Market.updatedAt)
  const syncedAt = stat?.syncedAt ? new Date(stat.syncedAt).getTime() : null;
  let freshLabel = "—";
  let freshSub = live ? "no sync recorded yet" : "adapter pending";
  if (mounted && syncedAt != null) {
    const ageMs = Date.now() - syncedAt;
    const ageMin = Math.floor(ageMs / 60_000);
    const ageH = Math.floor(ageMin / 60);
    freshLabel = ageMin < 1 ? "just now" : ageH < 1 ? `${ageMin}m ago` : ageH < 24 ? `${ageH}h ago` : `${Math.floor(ageH / 24)}d ago`;
    freshSub = "last venue sync";
  }

  // market filters — every chip computes from real fields, never decoration
  const closingSoon = vMarkets.filter((m) => m.closeDate && new Date(m.closeDate).getTime() - Date.now() < 14 * 86_400_000);
  const thinBook = vMarkets.filter(
    (m) => rules.minTouchDepthCents != null && (m.yesTouchDepthCents == null || m.yesTouchDepthCents < rules.minTouchDepthCents),
  );
  const shownMarkets = mktFilter === "closing" ? closingSoon : mktFilter === "thin" ? thinBook : vMarkets;

  // fee + source mix across the venue's synced markets (honest rules panel)
  const feeBps = vMarkets.map((m) => m.yesTakerFeeBps).filter((x): x is number => x != null);
  const feeRange = feeBps.length ? (Math.min(...feeBps) === Math.max(...feeBps) ? `${Math.min(...feeBps)} bps` : `${Math.min(...feeBps)}–${Math.max(...feeBps)} bps`) : null;
  const liveSrc = vMarkets.filter((m) => m.dataSource.endsWith("_LIVE")).length;
  const credential: Record<string, string> = {
    POLYMARKET: "Wallet (EVM · Polygon)",
    MANIFOLD: "Public API — play money",
    LIMITLESS: "Public REST — wallet (Base)",
    KALSHI: "API key (RSA / Ed25519)",
    AZURO: "Wallet (EVM)",
    DRIFT_BET: "— (adapter not built)",
  };

  const filterChip = (id: "all" | "closing" | "thin", label: string, count: number, title?: string) => (
    <button
      onClick={() => setMktFilter(id)}
      title={title}
      className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[12.5px] font-semibold transition-colors ${
        mktFilter === id ? "border-[var(--vc)] text-[var(--vc)]" : `${c.borderStrong} ${c.text3} hover:${c.text2}`
      }`}
    >
      {label} <span className={mono}>{count}</span>
    </button>
  );

  return (
    // B12: the whole workspace inherits the venue accent — header, strips,
    // buttons, bars and dots below all render in this venue's color, so
    // entering a different market visibly changes the room.
    <div className={`vc-scope flex flex-col gap-4 ${live ? "" : "vc-pending"}`} style={venueScopeStyle(venueId)}>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" className={`${c.borderStrong} ${c.elevated} ${c.text} hover:bg-[#1A2432]`} onClick={onBack}>
          ← Overview
        </Button>
        <span className={`text-[14px] ${c.text3}`}>venue workspace — everything on this venue in one place (B11)</span>
      </div>

      {/* venue header — avatar tile + display name + chips, actions right */}
      <div className={`${card} relative flex flex-col gap-4 overflow-hidden p-4 lg:flex-row lg:items-center lg:p-5`}>
        <span className="vc-glow absolute inset-0" aria-hidden />
        <span className="vc-strip absolute inset-x-0 top-0 h-[3px]" aria-hidden />
        <div className="relative flex min-w-0 flex-1 items-center gap-3.5">
          <span
            aria-hidden
            className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-[24px] font-bold"
            style={{ background: "var(--vc)", color: "#071018" }}
          >
            {v.label.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-[28px] font-bold tracking-tight text-[#E6EAF2]">{v.label}</h1>
              <span className={`rounded px-2 py-0.5 text-[12px] font-bold tracking-wide ${live ? "text-[#2FC08E] bg-[#2FC08E]/10" : "text-[#E3A63B] bg-[#E3A63B]/10"}`}>
                {live ? "Live" : "Pending"}
              </span>
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide ${roleChipClass(v.role)}`}>{ROLE_LABEL[v.role]}</span>
              <span className={`text-[13px] font-semibold ${live ? "vc-text" : c.text3}`}>{live ? "● market data streaming" : "○ adapter pending"}</span>
            </div>
            <div className={`mt-1 text-[13.5px] ${c.text2}`}>{v.note}</div>
          </div>
        </div>
        <div className="relative flex shrink-0 flex-wrap gap-2">
          {live && (
            <Button variant="outline" size="sm" className={`${c.borderStrong} ${c.elevated} ${c.text} hover:bg-[#1A2432]`} onClick={() => onSyncVenue(v.id)} disabled={busy === "sync"}>
              {busy === "sync" ? "Syncing…" : `Sync ${v.label}`}
            </Button>
          )}
          <Button variant="outline" size="sm" className={`${c.borderStrong} ${c.elevated} ${c.text} hover:bg-[#1A2432]`} onClick={onCycle} disabled={busy !== null}>
            Run robot cycle
          </Button>
          <Button
            size="sm"
            className="vc-btn font-semibold"
            disabled={!live}
            title={live ? undefined : "Adapter pending — robot creation is refused until it ships (B11)"}
            onClick={() => onCreateRobot(v.id)}
          >
            + New robot on {v.label}
          </Button>
        </div>
      </div>

      {/* pending-venue notice — honest roadmap state instead of an empty page */}
      {!live && (
        <div className={`flex flex-wrap items-center gap-3 rounded-lg border border-[#D9B25C]/40 bg-[#D9B25C]/10 px-4 py-3`}>
          <span className={`rounded bg-[#D9B25C]/20 px-2 py-1 text-[12px] font-bold tracking-wide ${c.paper}`}>ADAPTER PENDING — B9 ROADMAP</span>
          <span className={`text-[13.5px] ${c.text2}`}>
            No market data and no robots here yet. Robot creation is refused until the adapter lands (B11); the venue stays visible so the lineup never silently changes.
          </span>
        </div>
      )}

      {/* KPI band — five tiles incl. real data freshness (Market.updatedAt) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MiniStat label="MARKETS SYNCED" value={String(stat?.markets ?? 0)} sub={live ? "unresolved" : "—"} />
        <MiniStat label="ACTIVE ROBOTS" value={`${stat?.robotsActive ?? 0} / ${stat?.robotsTotal ?? 0}`} sub={`${stat?.robotsTotal ?? 0} scoped here`} />
        <MiniStat label="OPEN EXPOSURE" value={fmtCents(stat?.exposureCents ?? 0)} sub={`${stat?.openPositions ?? 0} position${stat?.openPositions === 1 ? "" : "s"} in trade`} />
        <MiniStat
          label="TODAY (PAPER MARK)"
          value={stat && stat.openPositions > 0 ? pnlText(stat.unrealizedCents) : "—"}
          sub="open mark-to-market"
          tone={stat && stat.openPositions > 0 ? (stat.unrealizedCents > 0 ? "gain" : stat.unrealizedCents < 0 ? "loss" : "text") : "text"}
        />
        <MiniStat label="DATA FRESHNESS" value={freshLabel} sub={freshSub} />
      </div>

      {/* markets (left) + robots & rules rail (right) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={`${card} overflow-hidden lg:col-span-2`}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2">
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <span className="vc-bg h-2 w-2 rounded-[3px]" aria-hidden />
              <span>Markets on <span className="vc-text">{v.label}</span></span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filterChip("all", "All", vMarkets.length)}
              {filterChip("closing", "Closing soon", closingSoon.length, "Close date within 14 days")}
              {rules.minTouchDepthCents != null &&
                filterChip("thin", "Thin book", thinBook.length, `Touch depth below the ${fmtCents(rules.minTouchDepthCents)} venue minimum — entries refused (S-05)`)}
            </div>
          </div>
          {shownMarkets.length > 0 ? (
            <div className="fd-scroll max-h-[460px] overflow-y-auto">
              <table className="w-full">
                <thead className={`sticky top-0 ${c.surface}`}>
                  <tr className={`border-b text-left text-[12px] tracking-wider ${c.border} ${c.text3}`}>
                    <th className="px-4 py-2.5 font-semibold">MARKET</th>
                    <th className="px-3 py-2.5 font-semibold" title="YES price with a 0-100¢ bar in the venue hue">YES</th>
                    <th className="hidden px-3 py-2.5 font-semibold sm:table-cell">NO</th>
                    <th className="hidden px-3 py-2.5 font-semibold md:table-cell" title="USDC notional at the touch (best ask YES / best bid NO)">TOUCH</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap" title="Venue-reported lifetime volume (USDC)">VOLUME</th>
                    <th className="hidden px-3 py-2.5 font-semibold lg:table-cell">SOURCE</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {shownMarkets.slice(0, 40).map((m) => {
                    const thin =
                      rules.minTouchDepthCents != null &&
                      (m.yesTouchDepthCents == null || m.yesTouchDepthCents < rules.minTouchDepthCents);
                    return (
                      <tr key={m.id} className={`border-b text-[14px] last:border-0 ${c.border} hover:bg-[#161D2B]`}>
                        <td className={`max-w-[210px] px-4 py-2.5 sm:max-w-[300px] ${c.text}`}>
                          <div className="truncate">{m.question}</div>
                          <div className={`text-[12px] ${c.text3}`}>
                            {m.category}
                            {m.closeDate ? ` · closes ${new Date(m.closeDate).toLocaleDateString("en-US", { day: "numeric", month: "short" })}` : ""}
                            {m.eventKey ? (
                              <span title={`A-04 event cluster ${m.eventKey} — positions here stack in the per-event exposure cap`}> · ⛭ cluster</span>
                            ) : null}
                            {m.ambiguityFlag ? " · ⚠ ambiguity check" : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`${mono} ${c.text}`}>{m.yesPriceCents ?? "—"}¢</span>
                          <span className={`mt-1 block h-1 w-16 rounded ${c.elevated}`} title={`YES at ${m.yesPriceCents ?? "?"}¢ on a 0-100¢ scale`}>
                            <span
                              className="block h-full rounded"
                              style={{ width: `${Math.min(100, Math.max(0, m.yesPriceCents ?? 0))}%`, background: "var(--vc)" }}
                            />
                          </span>
                        </td>
                        <td className={`hidden px-3 py-2.5 whitespace-nowrap sm:table-cell ${mono} ${c.text2}`}>{m.noPriceCents ?? "—"}¢</td>
                        <td className={`hidden px-3 py-2.5 whitespace-nowrap md:table-cell ${mono}`} title="USDC notional at the touch (best ask YES / best bid NO) — entry refused below the venue minimum (S-05 rule a)">
                          {m.yesTouchDepthCents != null || m.noTouchDepthCents != null ? (
                            <span className={thin ? c.warn : c.text2}>{m.yesTouchDepthCents ?? "—"}¢ / {m.noTouchDepthCents ?? "—"}¢</span>
                          ) : (
                            <span className={c.text3}>—</span>
                          )}
                        </td>
                        <td className={`px-3 py-2.5 whitespace-nowrap text-right ${mono} ${m.volumeCents ? c.text2 : c.text3}`}>
                          {m.volumeCents ? fmtCents(m.volumeCents) : "—"}
                        </td>
                        <td className="hidden px-3 py-2.5 lg:table-cell">
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${m.dataSource.endsWith("_LIVE") ? `${c.bright} bg-[#00B0F0]/10` : `${c.warn} bg-[#E3A63B]/10`}`}>
                            {m.dataSource.endsWith("_LIVE") ? "LIVE" : "CACHED"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Button size="sm" variant="outline" className={`h-7 border-[#2C3648] bg-[#121722] text-[13px] text-[#E6EAF2] hover:bg-[#1A2432]`} onClick={() => onTrade(m)} disabled={m.ambiguityFlag}>
                            {m.ambiguityFlag ? "Flagged" : "Trade"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={`px-4 py-7 text-center text-[14px] ${c.text3}`}>
              {mktFilter === "closing"
                ? `No ${v.label} markets close within 14 days — the All chip shows every synced market.`
                : mktFilter === "thin"
                  ? `No ${v.label} markets below the ${fmtCents(rules.minTouchDepthCents ?? 0)} touch minimum — the thin-book refusal has nothing to flag right now.`
                  : live
                    ? `No ${v.label} markets cached yet — press “Sync ${v.label}” above.`
                    : `No ${v.label} markets — the adapter ships per the B9 roadmap.`}
            </div>
          )}
        </div>

        {/* right rail: robots with paper-mark P&L + the rules the engine enforces */}
        <div className="flex flex-col gap-4">
          <div className={`${card} p-4`}>
            <div className="flex items-center justify-between">
              <span className={`text-[15px] font-semibold`}>Robots on <span className="vc-text">{v.label}</span></span>
              <span className={`text-[12.5px] ${c.text3}`}>{vRobots.length} scoped</span>
            </div>
            <div className="mt-3 flex flex-col gap-2.5">
              {vRobots.map((r) => {
                const rp = robotPnl.get(r.name);
                const pnl = rp && rp.open > 0 ? rp.pnl : null;
                return (
                  <button
                    key={r.id}
                    onClick={() => onOpenRobot(r.id)}
                    title={`Open ${r.name} — robot detail`}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${c.border} ${c.elevated} hover:border-[#2C3648] hover:bg-[#161D2B]`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[15px] font-semibold">{r.name}</span>
                      <span className={`shrink-0 whitespace-nowrap text-[14px] font-semibold ${mono} ${pnlClass(pnl)}`}>{pnlText(pnl)}</span>
                    </div>
                    <div className={`mt-1 flex items-center justify-between text-[13px] ${c.text3}`}>
                      <span className="truncate">{FAMILY_LABEL[r.family] ?? r.family} · {r.status.replace("_", " ").toLowerCase()}</span>
                      <span className={mono}>v{r.activeVersion}</span>
                    </div>
                    <div className={`mt-2 border-t pt-2 text-[13px] ${c.border} ${c.text2}`}>
                      <span className={mono}>alloc {fmtCents(r.allocatedCents)}</span>
                      <span className={`ml-3 ${mono}`}>cap {fmtCents(r.maxPositionCents)}</span>
                      <span className={`ml-3 ${mono}`}>open ≤ {r.maxOpenPositions}</span>
                    </div>
                    {r.statusReason && <div className={`mt-1.5 text-[12.5px] ${c.warn}`}>{r.statusReason}</div>}
                  </button>
                );
              })}
              {vRobots.length === 0 && (
                <div className={`py-5 text-center text-[14px] ${c.text3}`}>
                  {live
                    ? `No robots on ${v.label} yet — “+ New robot on ${v.label}” starts the wizard pre-scoped to this venue.`
                    : `Robots cannot be scoped to ${v.label} until its adapter ships (B11).`}
                </div>
              )}
            </div>
          </div>

          {/* venue rules — the real structural config the engine enforces (S-05) */}
          <div className={`${card} p-4`}>
            <div className="text-[15px] font-semibold">Venue rules</div>
            <div className="mt-2.5 flex flex-col">
              {[
                { k: "Adapter", val: live ? "LIVE · market data" : "PENDING · B9 roadmap" },
                { k: "Credential kind", val: credential[v.id] ?? "—" },
                { k: "Min touch depth", val: rules.minTouchDepthCents != null ? `${fmtCents(rules.minTouchDepthCents)} at the touch` : "not armed" },
                { k: "Per-market cap", val: rules.perMarketPositionCapCents != null ? `${fmtCents(rules.perMarketPositionCapCents)} user-wide` : "not armed" },
                { k: "Close window", val: rules.minMinutesBeforeClose != null ? `${rules.minMinutesBeforeClose} min before close` : "not armed" },
                { k: "Taker fee", val: feeRange ?? "snapshot missing" },
                { k: "Data source", val: vMarkets.length ? `${liveSrc} live · ${vMarkets.length - liveSrc} cached` : "—" },
              ].map((row) => (
                <div key={row.k} className={`flex items-baseline justify-between gap-3 border-b py-1.5 last:border-0 ${c.border}`}>
                  <span className={`shrink-0 text-[13.5px] ${c.text3}`}>{row.k}</span>
                  <span className={`text-right text-[13.5px] ${c.text2} ${row.k !== "Adapter" && row.k !== "Credential kind" ? mono : ""}`}>{row.val}</span>
                </div>
              ))}
            </div>
            <div className={`mt-2 text-[12px] leading-snug ${c.text3}`}>
              Enforced by the shared risk engine at cycle and ticket time — config in src/lib/venue/rules.ts, never hardcoded at call sites (C4.4).
            </div>
          </div>
        </div>
      </div>

      {/* positions on this venue */}
      {vPositions.length > 0 && (
        <div className={`${card} overflow-hidden`}>
          <div className="flex items-center gap-2 px-4 pt-3 pb-2 text-[15px] font-semibold">
            <span className="vc-bg h-2 w-2 rounded-[3px]" aria-hidden />
            <span>In trade on <span className="vc-text">{v.label}</span></span>
          </div>
          <div className="fd-scroll max-h-[260px] overflow-y-auto">
            <table className="w-full">
              <thead className={`sticky top-0 ${c.surface}`}>
                <tr className={`border-b text-left text-[12px] tracking-wider ${c.border} ${c.text3}`}>
                  <th className="px-4 py-2.5 font-semibold">MARKET</th>
                  <th className="px-3 py-2.5 font-semibold">ROBOT</th>
                  <th className="px-3 py-2.5 font-semibold">SIDE</th>
                  <th className="px-3 py-2.5 font-semibold">SIZE</th>
                  <th className="px-3 py-2.5 font-semibold">ENTRY → MARK</th>
                  <th className="px-4 py-2.5 font-semibold">P/L</th>
                </tr>
              </thead>
              <tbody>
                {vPositions.map((p) => {
                  const mark = p.side === "YES" ? p.market?.yesPriceCents : p.market?.noPriceCents;
                  const clusterKey = (p.market as { eventKey?: string | null } | undefined)?.eventKey;
                  const clusterSize = clusterKey ? clusterOf.get(clusterKey) ?? 1 : 0;
                  return (
                    <tr key={p.id} className={`border-b text-[14px] last:border-0 ${c.border}`}>
                      <td className={`max-w-[300px] truncate px-4 py-2.5 ${c.text}`}>
                        {p.market?.question}
                        {clusterKey && clusterSize > 1 && (
                          <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-bold ${c.warn} bg-[#E3A63B]/10`} title={`A-04: ${clusterSize} positions in event cluster ${clusterKey} stack in the per-event exposure cap`}>
                            ⛭ CLUSTER ×{clusterSize}
                          </span>
                        )}
                      </td>
                      <td className={`max-w-[140px] truncate px-3 py-2.5 ${c.text2}`}>{p.robot?.name}</td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-[11.5px] font-bold ${p.side === "YES" ? `${c.gain} bg-[#2FC08E]/10` : `${c.warn} bg-[#E3A63B]/10`}`}>{p.side}</span>
                      </td>
                      <td className={`px-3 py-2.5 whitespace-nowrap ${mono} ${c.text}`}>{fmtCents(p.sizeCents)}</td>
                      <td className={`px-3 py-2.5 whitespace-nowrap ${mono} ${c.text2}`}>{p.avgPriceCents}¢ → {mark != null ? `${mark}¢` : "—"}</td>
                      <td className={`px-4 py-2.5 whitespace-nowrap ${mono} font-semibold ${pnlClass(p.unrealizedCents)}`}>{pnlText(p.unrealizedCents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* orders + traces on this venue */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={`${card} overflow-hidden`}>
          <div className="flex items-center gap-2 px-4 pt-3 pb-2 text-[15px] font-semibold">
            <span className="vc-bg h-2 w-2 rounded-[3px]" aria-hidden />
            <span>Recent orders on <span className="vc-text">{v.label}</span></span>
          </div>
          <div className="fd-scroll max-h-[240px] overflow-y-auto">
            {vOrders.length > 0 ? (
              <table className="w-full">
                <thead className={`sticky top-0 ${c.surface}`}>
                  <tr className={`border-b text-left text-[12px] tracking-wider ${c.border} ${c.text3}`}>
                    <th className="px-4 py-2 font-semibold">MARKET</th>
                    <th className="px-3 py-2 font-semibold">SIDE</th>
                    <th className="px-3 py-2 font-semibold">SIZE</th>
                    <th className="px-4 py-2 font-semibold">STATE</th>
                  </tr>
                </thead>
                <tbody>
                  {vOrders.map((o) => (
                    <tr key={o.id} className={`border-b text-[14px] last:border-0 ${c.border}`}>
                      <td className={`max-w-[220px] truncate px-4 py-2 ${c.text}`}>{o.market?.question}{o.robot ? ` · ${o.robot.name}` : ""}</td>
                      <td className={`px-3 py-2 whitespace-nowrap ${c.text2}`}>{o.side.replace("BUY_", "BUY ")}</td>
                      <td className={`px-3 py-2 whitespace-nowrap ${mono} ${c.text2}`}>{fmtCents(o.sizeCents)}</td>
                      <td className="px-4 py-2"><StateChip state={o.state} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className={`px-4 py-6 text-center text-[14px] ${c.text3}`}>No orders on {v.label} yet.</div>
            )}
          </div>
        </div>

        <div className={`${card} overflow-hidden`}>
          <div className="flex items-center gap-2 px-4 pt-3 pb-2 text-[15px] font-semibold">
            <span className="vc-bg h-2 w-2 rounded-[3px]" aria-hidden />
            <span>Recent decisions on <span className="vc-text">{v.label}</span></span>
          </div>
          <div className="fd-scroll max-h-[240px] overflow-y-auto">
            {vTraces.length > 0 ? (
              vTraces.map((t) => <TraceRow key={t.id} t={t} />)
            ) : (
              <div className={`px-4 py-6 text-center text-[14px] ${c.text3}`}>No robot decisions recorded on {v.label} yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── A-08 front-end depth: one expandable trace row, shared by the dashboard
// traces list and every venue workspace. Collapsed = the glanceable verdict;
// expanded = the full evidence: provenance envelope (A-02) and the pre-trade
// risk checks with their pass/fail verdicts and details. "A forecast without
// provenance is not evidence" — clicking any trace shows exactly that.
function TraceRow({ t }: { t: TraceDTO }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`border-b py-2.5 last:border-0 ${c.border}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-2 text-left" aria-expanded={open}>
        <span className={`rounded px-2 py-0.5 text-[12px] font-bold ${t.decision === "TRADE" ? `${c.bright} bg-[#00B0F0]/10` : `${c.text3} bg-[#121722]`}`}>{t.decision}</span>
        <ModelChip modelKey={t.modelKey} provenance={t.provenance} />
        <span className={`text-[14px] font-semibold ${c.text}`}>{t.robot?.name}</span>
        {t.market?.venue && <VenueBadge venue={t.market.venue} withLabel={false} />}
        <span className={`text-[13px] ${c.text3}`}>on {t.market?.question.slice(0, 60)}</span>
        {t.modelEstimatePct != null && (
          <span className={`ml-auto text-[13px] ${c.text2} ${mono}`}>est {t.modelEstimatePct}% · mkt {t.marketPriceCents}¢ · edge {t.edgeNetPct} pts</span>
        )}
        <span className={`text-[12px] ${open ? c.bright : c.text3}`}>{open ? "▾" : "▸"}</span>
      </button>
      <div className={`mt-1 text-[13px] ${c.text2}`}>{t.reason}</div>
      {open && <TraceDetail t={t} />}
    </div>
  );
}

function TraceDetail({ t }: { t: TraceDTO }) {
  const prov = parseProvenance(t.provenance);
  const checks = parseRiskChecks(t.riskChecks);
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1">
      <span className={`shrink-0 text-[12.5px] ${c.text3}`}>{k}</span>
      <span className={`text-right text-[12.5px] ${c.text2}`}>{v}</span>
    </div>
  );
  return (
    <div className="mt-2 rounded-lg border border-[#1E2533] bg-[#10151F] p-3">
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
        <div>
          <div className={`mb-1 text-[12px] font-bold tracking-wider ${c.text3}`}>PROVENANCE ENVELOPE (A-02)</div>
          {row("model", <span className={mono}>{t.modelKey ?? "—"}</span>)}
          {prov?.kind && row("kind", prov.kind)}
          {prov?.provider && row("provider / model", `${prov.provider}${prov.model ? " · " + prov.model : ""}`)}
          {prov?.estimatorVersion && row("estimator version", <span className={mono}>{prov.estimatorVersion}</span>)}
          {prov?.latencyMs != null && row("latency", `${prov.latencyMs} ms`)}
          {prov?.cache && row("cache", prov.cache === "HIT" ? "HIT (cached, zero cost)" : prov.cache)}
          {row("screening", <span className={prov?.screening === "FLAGGED" ? "text-[#F0525F]" : "text-[#2FC08E]"}>{prov?.screening ?? "—"}{prov?.screeningReasons?.length ? ` — ${prov.screeningReasons.join("; ")}` : ""}</span>)}
          {prov?.fallbackFrom && row("fallback from", <span className="text-[#F0B252]">{prov.fallbackFrom}</span>)}
          {prov?.costCents != null && row("AI cost", fmtCents(prov.costCents))}
          {prov?.evidenceHash && row("evidence hash", <span className={mono} title={prov.evidenceHash}>{prov.evidenceHash.slice(0, 18)}…</span>)}
        </div>
        <div>
          <div className={`mb-1 text-[12px] font-bold tracking-wider ${c.text3}`}>PRE-TRADE RISK CHECKS</div>
          {checks.length === 0 && <div className={`text-[12.5px] ${c.text3}`}>no checks recorded on this trace</div>}
          {checks.map((ck, i) => (
            <div key={i} className="py-1">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1 py-px text-[11px] font-bold ${ck.passed ? "text-[#2FC08E] bg-[#2FC08E]/10" : "text-[#F0525F] bg-[#F0525F]/10"}`}>{ck.passed ? "PASS" : "FAIL"}</span>
                <span className={`text-[12.5px] font-semibold ${c.text}`}>{ck.check}</span>
              </div>
              <div className={`ml-1 border-l pl-2 text-[12px] ${c.text3}`} style={{ borderColor: ck.passed ? "#1D4A3C" : "#4A1D25" }}>{ck.detail}</div>
            </div>
          ))}
        </div>
      </div>
      <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-[12px] ${c.border} ${c.text3}`}>
        <span>trace <span className={mono}>{t.id.slice(0, 10)}…</span></span>
        <span>trigger <b className={c.text2}>{t.trigger ?? "—"}</b></span>
        <span>strategy <span className={mono}>{t.strategyVersionId ? t.strategyVersionId.slice(0, 10) + "…" : "—"}</span> (C5)</span>
        <span>decided {new Date(t.createdAt).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}

function parseProvenance(p?: string | null): ProvenanceShape | null {
  if (!p) return null;
  try {
    return JSON.parse(p) as ProvenanceShape;
  } catch {
    return null;
  }
}

interface ProvenanceShape {
  kind?: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  cache?: string;
  screening?: string;
  screeningReasons?: string[];
  estimatorVersion?: string;
  fallbackFrom?: string;
  evidenceHash?: string;
  costCents?: number;
}

function parseRiskChecks(rc?: string | null): Array<{ check: string; passed: boolean; detail: string }> {
  if (!rc) return [];
  try {
    const arr = JSON.parse(rc) as Array<{ check: string; passed: boolean; detail: string }>;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function MiniStat({ label, value, sub, tone = "text" }: { label: string; value: string; sub: string; tone?: "text" | "gain" | "loss" }) {
  return (
    <div className={`${card} p-3.5`}>
      <div className={`text-[11px] font-semibold tracking-wider ${c.text3}`}>{label}</div>
      <div className={`mt-1 text-[20px] font-semibold ${mono} ${tone === "gain" ? c.gain : tone === "loss" ? c.loss : c.text}`}>{value}</div>
      <div className={`mt-0.5 text-[11.5px] ${c.text3}`}>{sub}</div>
    </div>
  );
}

// Phase 5 (A-02): which estimator produced this forecast — visible on every
// trace. BL = baseline heuristic, AI:<PROVIDER> = registry AI model; a cache
// hit or a screening flag is stated so provenance is glanceable (D-03 style).
function ModelChip({ modelKey, provenance }: { modelKey?: string | null; provenance?: string | null }) {
  if (!modelKey) return null;
  let cache: string | null = null;
  let flagged = false;
  try {
    const p = provenance ? (JSON.parse(provenance) as { cache?: string; screening?: string }) : null;
    cache = p?.cache ?? null;
    flagged = p?.screening === "FLAGGED";
  } catch {
    /* provenance is optional metadata */
  }
  const isAI = modelKey.startsWith("ai:");
  const label = isAI ? `AI:${modelKey.slice(3).split("/")[0]}` : "BL";
  return (
    <span
      title={`${modelKey}${cache ? " · cache " + cache : ""}${flagged ? " · A-06 screening FLAGGED" : ""}`}
      className={`rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide ${
        isAI ? `text-[#C9A6FF] bg-[#C9A6FF]/10` : `${c.text3} bg-[#121722]`
      }`}
    >
      {label}
      {cache === "HIT" && <span className="text-[#2FC08E]"> ·C</span>}
      {flagged && <span className="text-[#F0525F]"> ·A-06</span>}
    </span>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4 py-8">
      <div className={`h-7 w-56 animate-pulse rounded ${c.elevated}`} />
      <div className={`h-4 w-72 animate-pulse rounded ${c.elevated}`} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`h-28 animate-pulse rounded-xl ${c.elevated}`} />)}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={`h-24 animate-pulse rounded-xl ${c.elevated}`} />)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={`h-80 animate-pulse rounded-xl ${c.elevated} lg:col-span-2`} />
        <div className={`h-80 animate-pulse rounded-xl ${c.elevated}`} />
      </div>
    </div>
  );
}
