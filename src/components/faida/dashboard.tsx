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

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type DashboardDTO,
  type MarketDTO,
  type VenueStatDTO,
  FAMILY_LABEL,
} from "./types";
import { c, card, mono, fmtCents, Pill, Meter, SectionTitle, VenueBadge, StateChip, venueScopeStyle } from "./ui";
import { ROLE_LABEL, VENUES } from "@/lib/venues";

// B12: role chips are neutral gray — the venue's own color (badge, card strip,
// workspace interior) carries the identity, so role text never fights the hue.
function roleChipClass(_role: string): string {
  return `${c.text3} bg-[#151D30]`;
}

function pnlClass(v: number | null): string {
  if (v == null || v === 0) return c.text3;
  return v > 0 ? c.gain : c.loss;
}

function pnlText(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${fmtCents(v)}`;
}

// ── Dashboard (default view) ─────────────────────────────────────────────────
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
}) {
  const { dash, onCycle, onReconcile, hasUnknown, onSync, onControl, onOpenVenue } = props;
  const [intervalSec, setIntervalSec] = useState(60);
  if (!dash) return <DashboardSkeleton />;
  const exposurePct = dash.allocatedCents > 0 ? (dash.exposureCents / dash.allocatedCents) * 100 : 0;
  const aiProvider = dash.providers.find((p) => p.enabled) ?? dash.providers[0];
  const ctl = dash.control;
  const paused = ctl?.pause.paused ?? false;
  const auto = ctl?.autopilot;
  const lastRun = auto?.lastRun ?? null;

  // "In trade now" — venue, market and robot per open position + marks.
  const positions = dash.positions;
  const venuesInTrade = new Set(positions.map((p) => p.market?.venue ?? "?")).size;
  const totalUnrealized = positions.reduce((a, p) => a + (p.unrealizedCents ?? 0), 0);
  const liveVenues = VENUES.filter((v) => v.adapter === "LIVE");
  const activeRobots = dash.robots.filter((r) => ["RUNNING", "PAPER_ONLY"].includes(r.status)).length;
  const pausedRobots = dash.robots.filter((r) => r.status.startsWith("PAUSED")).length;

  return (
    <div className="flex flex-col gap-5">
      {/* title row */}
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-semibold">Dashboard</h1>
        <span className={`text-[12px] ${c.text3}`}>all values labeled SIMULATED / PAPER — nothing here is live money</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" className={`${c.borderStrong} ${c.elevated} ${c.text} hover:bg-[#1B2540]`} onClick={() => onSync()} disabled={props.busy === "sync"}>
            {props.busy === "sync" ? "Syncing…" : "Sync all venues"}
          </Button>
          <Button size="sm" className="bg-[#00B0F0] font-semibold text-[#001040] hover:bg-[#2FC1F5]" onClick={onCycle} disabled={props.busy !== null}>
            Run robot cycle
          </Button>
        </div>
      </div>

      {/* KPI band — balance, exposure, today, in-trade (MT5-equivalent cockpit row) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="TOTAL PAPER BALANCE" value={fmtCents(dash.balanceCents)} tag="SIMULATED" />
        <Kpi
          label="RISK EXPOSURE"
          value={fmtCents(dash.exposureCents)}
          tag="OPEN POSITIONS"
          meter={{ pct: exposurePct, detail: `${dash.exposureLimitPct}% per-event cap in effect` }}
        />
        <Kpi label="TODAY NET FLOW" value={fmtCents(dash.todayFlowCents)} tag="PAPER LEDGER" tone={dash.todayFlowCents < 0 ? "loss" : "gain"} />
        <Kpi
          label="IN TRADE NOW"
          value={`${positions.length} position${positions.length === 1 ? "" : "s"} · ${venuesInTrade} venue${venuesInTrade === 1 ? "" : "s"}`}
          tag={`MARK ${pnlText(totalUnrealized)}`}
          tone={totalUnrealized > 0 ? "gain" : totalUnrealized < 0 ? "loss" : "text"}
        />
      </div>

      {/* status strip — passive, glanceable (MT5 status-bar equivalent) */}
      <div className={`${card} flex flex-wrap items-center gap-2 px-4 py-2.5`}>
        <span className={`rounded px-2 py-1 text-[10px] font-bold tracking-wide ${auto?.enabled ? `${c.bright} bg-[#00B0F0]/10` : `${c.text3} bg-[#151D30]`}`}>
          AUTOPILOT {auto?.enabled ? `ON · every ${auto.intervalSec}s` : "OFF"}
        </span>
        <span className={`rounded px-2 py-1 text-[10px] font-bold tracking-wide ${c.accent} bg-[#3E9BF0]/10`}>
          {liveVenues.length} ADAPTER{liveVenues.length === 1 ? "" : "S"} LIVE · {liveVenues.map((v) => v.short).join(" / ")}
        </span>
        <span className={`rounded px-2 py-1 text-[10px] font-bold tracking-wide ${c.text2} bg-[#151D30]`}>
          {dash.marketCount} MARKETS SYNCED
        </span>
        <span className={`rounded px-2 py-1 text-[10px] font-bold tracking-wide ${c.text2} bg-[#151D30]`}>
          {activeRobots} ROBOTS ACTIVE · {pausedRobots} PAUSED
        </span>
        {dash.openAlerts > 0 && (
          <span className={`rounded px-2 py-1 text-[10px] font-bold tracking-wide ${c.warn} bg-[#E3A63B]/10`}>
            ⚠ {dash.openAlerts} ALERT{dash.openAlerts === 1 ? "" : "S"}
          </span>
        )}
        {dash.outboxPending > 0 && (
          <span className={`rounded px-2 py-1 text-[10px] font-bold tracking-wide ${c.warn} bg-[#E3A63B]/10`}>
            OUTBOX {dash.outboxPending} PENDING
          </span>
        )}
        <span className={`ml-auto rounded px-2 py-1 text-[10px] font-bold tracking-wide ${c.paper} bg-[#D9B25C]/10`}>PAPER LEDGER — LIVE MONEY GATED (PHASE 7)</span>
      </div>

      {/* C19 kill-switch banner — the one state that overrides everything */}
      {paused && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#F0525F]/50 bg-[#F0525F]/10 px-4 py-3">
          <span className="rounded bg-[#F0525F]/20 px-2 py-1 text-[10px] font-bold tracking-wide text-[#F0525F]">■ PLATFORM PAUSED — C19 KILL SWITCH</span>
          <span className={`text-[11.5px] ${c.text2}`}>Every robot cycle and every new order is refused until resume. Reason: {ctl?.pause.reason ?? "manual pause"}</span>
          <Button size="sm" variant="outline" className="ml-auto h-7 border-[#F0525F]/50 bg-transparent text-[#F0525F] hover:bg-[#F0525F]/10" onClick={() => onControl({ action: "RESUME" }, "Platform resumed")} disabled={props.busy !== null}>
            Resume platform
          </Button>
        </div>
      )}

      {/* venue grid — the hub: pick a venue → its workspace (robots, markets, orders) */}
      <div>
        <SectionTitle right={<span className={`text-[11px] ${c.text3}`}>registry-driven (B9) · venue-scoped robots (B11) · color-coded venues (B12)</span>}>
          Venues — select a venue to manage its robots, markets and orders
        </SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {VENUES.map((v) => {
            const stat = dash.venues.find((s) => s.venue === v.id);
            return <VenueCard key={v.id} venueDef={v} stat={stat} onOpen={() => onOpenVenue(v.id)} />;
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* in trade now */}
        <div className="lg:col-span-2">
          <div className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <span className={`text-[13px] font-semibold tracking-wide ${c.text}`}>In trade now — venue · market · robot</span>
              <span className={`text-[10px] ${c.text3}`}>marks = venue's last synced price (paper)</span>
            </div>
            <div className="fd-scroll max-h-[360px] overflow-y-auto">
              <table className="w-full">
                <thead className={`sticky top-0 ${c.surface}`}>
                  <tr className={`border-b text-left text-[10px] tracking-wider ${c.border} ${c.text3}`}>
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
                      <tr key={p.id} className={`border-b text-[12px] last:border-0 ${c.border} hover:bg-[#131A2C]`}>
                        <td className="px-4 py-2.5">{p.market?.venue ? <VenueBadge venue={p.market.venue} /> : "—"}</td>
                        <td className={`max-w-[240px] px-3 py-2.5 ${c.text}`}>
                          <div className="truncate">{p.market?.question}</div>
                        </td>
                        <td className={`max-w-[140px] truncate px-3 py-2.5 ${c.text2}`}>{p.robot?.name}</td>
                        <td className="px-3 py-2.5">
                          <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold ${p.side === "YES" ? `${c.gain} bg-[#2FC08E]/10` : `${c.warn} bg-[#E3A63B]/10`}`}>{p.side}</span>
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
                      <td colSpan={7} className={`px-4 py-8 text-center text-[12px] ${c.text3}`}>
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
            <SectionTitle right={hasUnknown ? <Button size="sm" variant="outline" className={`h-7 border-[#E3A63B]/50 bg-[#151D30] text-[#E3A63B] hover:bg-[#1B2540]`} onClick={onReconcile}>Resolve now</Button> : undefined}>
              Recent activity
            </SectionTitle>
            <div className="flex flex-col">
              {dash.notifications.slice(0, 6).map((n) => (
                <div key={n.id} className={`border-b py-2 last:border-0 ${c.border}`}>
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-sm ${n.severity === "CRITICAL" ? "bg-[#F0525F]" : n.severity === "WARNING" ? "bg-[#E3A63B]" : "bg-[#3E9BF0]"}`} />
                    <span className={`text-[11.5px] ${c.text2}`}>{n.title}</span>
                  </div>
                  <div className={`ml-3.5 mt-0.5 text-[10px] ${c.text3}`}>{n.body.slice(0, 90)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* platform control — autopilot (P3.2/S-06) + kill switch (C19/S-07) */}
      <div className={card}>
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="min-w-[190px]">
            <SectionTitle>Platform control (C19 · P3.2)</SectionTitle>
            <div className={`mt-1 text-[10.5px] ${c.text3}`}>humans own the switches — robots never (B8)</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[60, 120, 300].map((s) => (
              <button key={s} onClick={() => setIntervalSec(s)}
                className={`rounded border px-2 py-1 text-[10.5px] transition-colors ${intervalSec === s ? "border-[#00B0F0] bg-[#00B0F0]/10 text-[#00B0F0]" : `border-[#2E3C5F] ${c.text3} hover:bg-[#1B2540]`}`}>
                {s}s
              </button>
            ))}
            {auto?.enabled ? (
              <Button size="sm" variant="outline" className={`h-7 border-[#2E3C5F] bg-[#151D30] ${c.text} hover:bg-[#1B2540]`} onClick={() => onControl({ action: "AUTOPILOT_STOP" }, "Autopilot stopped")} disabled={props.busy !== null}>
                Stop autopilot
              </Button>
            ) : (
              <Button size="sm" className="h-7 bg-[#00B0F0] font-semibold text-[#001040] hover:bg-[#2FC1F5]" onClick={() => onControl({ action: "AUTOPILOT_START", intervalSec }, `Autopilot started — cycles every ${intervalSec}s`)} disabled={props.busy !== null}>
                Start autopilot
              </Button>
            )}
          </div>
          <div className={`text-[11px] lg:ml-auto ${c.text2} ${mono}`}>
            {lastRun
              ? `last run ${new Date(lastRun.at).toLocaleTimeString()} — ${lastRun.skipped ? `skipped (${lastRun.skipped})` : `${lastRun.cycles} robots · ${lastRun.trades} trade · ${lastRun.noTrades} no-trade${lastRun.errors ? ` · ${lastRun.errors} ERR` : ""}`}`
              : "autopilot never ran — press Start"}
          </div>
          <Button size="sm" variant="outline" className={`h-7 shrink-0 border-[#F0525F]/50 bg-transparent text-[#F0525F] hover:bg-[#F0525F]/10`} onClick={() => onControl({ action: "PAUSE", reason: "manual pause from Dashboard" }, "PLATFORM PAUSED — all cycles and orders refuse until resume")} disabled={props.busy !== null || paused}>
            {paused ? "Paused" : "Global pause"}
          </Button>
        </div>
      </div>

      {/* decision traces */}
      <div className={card}>
        <div className="p-4 pb-2"><SectionTitle>Decision traces — every robot decision, trade or no-trade (A-08)</SectionTitle></div>
        <div className="flex flex-col px-4 pb-4">
          {dash.traces.slice(0, 5).map((t) => (
            <div key={t.id} className={`border-b py-2.5 last:border-0 ${c.border}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${t.decision === "TRADE" ? `${c.bright} bg-[#00B0F0]/10` : `${c.text3} bg-[#151D30]`}`}>{t.decision}</span>
                <span className={`text-[12px] font-semibold ${c.text}`}>{t.robot?.name}</span>
                {t.market?.venue && <VenueBadge venue={t.market.venue} withLabel={false} />}
                <span className={`text-[11px] ${c.text3}`}>on {t.market?.question.slice(0, 60)}</span>
                {t.modelEstimatePct != null && (
                  <span className={`ml-auto text-[11px] ${c.text2} ${mono}`}>est {t.modelEstimatePct}% · mkt {t.marketPriceCents}¢ · edge {t.edgeNetPct} pts</span>
                )}
              </div>
              <div className={`mt-1 text-[11px] ${c.text2}`}>{t.reason}</div>
            </div>
          ))}
          {dash.traces.length === 0 && <div className={`py-4 text-center text-[12px] ${c.text3}`}>No cycles run yet — press “Run robot cycle”.</div>}
        </div>
      </div>
    </div>
  );
}

// ── venue card (dashboard grid) — B12: each venue wears its own color ────────
function VenueCard({ venueDef: v, stat, onOpen }: { venueDef: (typeof VENUES)[number]; stat: VenueStatDTO | undefined; onOpen: () => void }) {
  const inTrade = (stat?.openPositions ?? 0) > 0;
  const pending = v.adapter === "PENDING";
  return (
    <button
      onClick={onOpen}
      aria-label={`Open ${v.label} workspace`}
      style={venueScopeStyle(v.id)}
      className={`vc-scope ${card} venue-card group relative flex flex-col gap-2.5 overflow-hidden text-left ${pending ? "vc-pending" : ""} ${inTrade ? "vc-border" : ""}`}
    >
      {/* venue identity strip — the card's color bar */}
      <span className={`vc-strip block h-[3px] w-full shrink-0 ${pending ? "opacity-80" : ""}`} />
      {inTrade && (
        <span className="vc-chip absolute right-3 top-3.5 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide">IN TRADE</span>
      )}
      <div className="flex flex-col gap-2.5 px-4 pb-4 pt-2.5">
        <div className="flex flex-wrap items-center gap-2 pr-14">
          <VenueBadge venue={v.id} />
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${roleChipClass(v.role)}`}>{ROLE_LABEL[v.role]}</span>
          <span className={`text-[10.5px] font-semibold ${pending ? c.text3 : "vc-text"}`}>
            {pending ? "○ adapter pending" : "● adapter live"}
          </span>
        </div>
        <div className={`line-clamp-2 text-[10.5px] leading-snug ${c.text3}`}>{v.note}</div>
        <div className={`mt-0.5 grid grid-cols-3 gap-2 border-t pt-2.5 text-center ${c.border}`}>
          <div>
            <div className={`text-[9px] tracking-wider ${c.text3}`}>MARKETS</div>
            <div className={`text-[13px] font-semibold ${mono} ${c.text}`}>{stat?.markets ?? 0}</div>
          </div>
          <div>
            <div className={`text-[9px] tracking-wider ${c.text3}`}>ROBOTS</div>
            <div className={`text-[13px] font-semibold ${mono} ${c.text}`}>
              {stat?.robotsActive ?? 0}
              <span className={`text-[10px] ${c.text3}`}>/{stat?.robotsTotal ?? 0}</span>
            </div>
          </div>
          <div>
            <div className={`text-[9px] tracking-wider ${c.text3}`}>IN TRADE</div>
            <div className={`text-[13px] font-semibold ${mono} ${inTrade ? "vc-text" : c.text}`}>
              {stat?.openPositions ?? 0}
              <span className={`text-[9.5px] font-normal ${c.text3}`}> · {fmtCents(stat?.exposureCents ?? 0)}</span>
            </div>
          </div>
        </div>
        <div className={`flex items-center justify-between text-[10.5px] ${c.text3}`}>
          <span>
            unrealized <span className={`${mono} font-semibold ${pnlClass(stat ? (stat.openPositions > 0 ? stat.unrealizedCents : null) : null)}`}>
              {stat && stat.openPositions > 0 ? pnlText(stat.unrealizedCents) : "—"}
            </span> <span className={c.text3}>(paper mark)</span>
          </span>
          <span className={`font-semibold vc-text opacity-0 transition-opacity group-hover:opacity-100`}>Open workspace →</span>
        </div>
      </div>
    </button>
  );
}

// ── venue workspace (drilldown) ──────────────────────────────────────────────
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
}) {
  const { venueId, dash, markets, busy, onBack, onSyncVenue, onCycle, onTrade, onCreateRobot } = props;
  const v = VENUES.find((x) => x.id === venueId);
  if (!dash || !v) return <DashboardSkeleton />;
  const stat = dash.venues.find((s) => s.venue === venueId);
  const vRobots = dash.robots.filter((r) => r.venue === venueId);
  const vMarkets = markets.filter((m) => m.venue === venueId);
  const vPositions = dash.positions.filter((p) => p.market?.venue === venueId);
  const vOrders = dash.orders.filter((o) => o.market?.venue === venueId);
  const vTraces = dash.traces.filter((t) => t.market?.venue === venueId);
  const live = v.adapter === "LIVE";
  // Phase 4 — A-04 visibility: positions on related markets share an eventKey;
  // their exposure stacks in the per-event risk check, so the cluster size is
  // shown right in the workspace ("stacks visibly", not just inside traces).
  const clusterOf = new Map<string, number>();
  for (const p of vPositions) {
    const key = (p.market as { eventKey?: string | null } | undefined)?.eventKey;
    if (key) clusterOf.set(key, (clusterOf.get(key) ?? 0) + 1);
  }

  return (
    // B12: the whole workspace inherits the venue accent — header, strips,
    // buttons, headings and dots below all render in this venue's color, so
    // entering a different market visibly changes the room.
    <div className={`vc-scope flex flex-col gap-4 ${live ? "" : "vc-pending"}`} style={venueScopeStyle(venueId)}>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" className={`${c.borderStrong} ${c.elevated} ${c.text} hover:bg-[#1B2540]`} onClick={onBack}>
          ← Back to dashboard
        </Button>
        <span className={`text-[12px] ${c.text3}`}>venue workspace — everything on this venue in one place (B11)</span>
      </div>

      {/* venue header — glow + strip carry the venue color into the room */}
      <div className={`${card} relative flex flex-col gap-3 overflow-hidden p-4 lg:flex-row lg:items-center`}>
        <span className="vc-glow absolute inset-0" aria-hidden />
        <span className="vc-strip absolute inset-x-0 top-0 h-[3px]" aria-hidden />
        <div className="relative min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-bold vc-text">{v.label}</span>
            <VenueBadge venue={v.id} />
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${roleChipClass(v.role)}`}>{ROLE_LABEL[v.role]}</span>
            <span className={`text-[11px] font-semibold ${live ? "vc-text" : c.text3}`}>{live ? "● adapter live (market data)" : "○ adapter pending"}</span>
          </div>
          <div className={`mt-1.5 text-[11.5px] ${c.text2}`}>{v.note}</div>
        </div>
        <div className="relative flex shrink-0 flex-wrap gap-2">
          {live && (
            <Button variant="outline" size="sm" className={`${c.borderStrong} ${c.elevated} ${c.text} hover:bg-[#1B2540]`} onClick={() => onSyncVenue(v.id)} disabled={busy === "sync"}>
              {busy === "sync" ? "Syncing…" : `Sync ${v.label}`}
            </Button>
          )}
          <Button variant="outline" size="sm" className={`${c.borderStrong} ${c.elevated} ${c.text} hover:bg-[#1B2540]`} onClick={onCycle} disabled={busy !== null}>
            Run robot cycle
          </Button>
          <Button
            size="sm"
            className="vc-btn font-semibold"
            disabled={!live}
            title={live ? undefined : "Adapter pending — robot creation is refused until it ships (B11)"}
            onClick={() => onCreateRobot(v.id)}
          >
            + Create robot on {v.label}
          </Button>
        </div>
      </div>

      {/* pending-venue notice — honest roadmap state instead of an empty page */}
      {!live && (
        <div className={`flex flex-wrap items-center gap-3 rounded-lg border border-[#D9B25C]/40 bg-[#D9B25C]/10 px-4 py-3`}>
          <span className={`rounded bg-[#D9B25C]/20 px-2 py-1 text-[10px] font-bold tracking-wide ${c.paper}`}>ADAPTER PENDING — B9 ROADMAP</span>
          <span className={`text-[11.5px] ${c.text2}`}>
            No market data and no robots here yet. Robot creation is refused until the adapter lands (B11); the venue stays visible so the lineup never silently changes.
          </span>
        </div>
      )}

      {/* stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MiniStat label="MARKETS" value={String(stat?.markets ?? 0)} sub={live ? "synced, unresolved" : "—"} />
        <MiniStat label="ROBOTS" value={`${stat?.robotsActive ?? 0}/${stat?.robotsTotal ?? 0}`} sub="active / total" />
        <MiniStat label="OPEN POSITIONS" value={String(stat?.openPositions ?? 0)} sub="in trade now" />
        <MiniStat label="EXPOSURE" value={fmtCents(stat?.exposureCents ?? 0)} sub="open notional" />
        <MiniStat
          label="UNREALIZED"
          value={stat && stat.openPositions > 0 ? pnlText(stat.unrealizedCents) : "—"}
          sub="paper mark"
          tone={stat && stat.openPositions > 0 ? (stat.unrealizedCents > 0 ? "gain" : stat.unrealizedCents < 0 ? "loss" : "text") : "text"}
        />
      </div>

      {/* robots + markets */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={`${card} p-4`}>
          <SectionTitle right={<span className={`text-[11px] ${c.text3}`}>{vRobots.length} robot{vRobots.length === 1 ? "" : "s"} scoped here</span>}>
            Robots on <span className="vc-text">{v.label}</span>
          </SectionTitle>
          <div className="flex flex-col gap-2.5">
            {vRobots.map((r) => (
              <div key={r.id} className={`rounded-lg border p-3 ${c.border} ${c.elevated}`}>
                <div className="flex items-center justify-between">
                  <Pill status={r.status} />
                  <span className={`text-[10px] ${c.text3}`}>v{r.activeVersion}</span>
                </div>
                <div className="mt-2 text-[13px] font-semibold">{r.name}</div>
                <div className={`mt-0.5 text-[11px] ${c.text3}`}>{FAMILY_LABEL[r.family] ?? r.family}</div>
                <div className={`mt-2 border-t pt-2 text-[11px] ${c.border} ${c.text2}`}>
                  <span className={mono}>alloc {fmtCents(r.allocatedCents)}</span>
                  <span className={`ml-3 ${mono}`}>pos cap {fmtCents(r.maxPositionCents)}</span>
                  <span className={`ml-3 ${mono}`}>open ≤ {r.maxOpenPositions}</span>
                </div>
                {r.statusReason && <div className={`mt-1.5 text-[10.5px] ${c.warn}`}>{r.statusReason}</div>}
              </div>
            ))}
            {vRobots.length === 0 && (
              <div className={`py-5 text-center text-[12px] ${c.text3}`}>
                {live
                  ? `No robots on ${v.label} yet — “+ Create robot on ${v.label}” above starts the wizard pre-scoped to this venue.`
                  : `Robots cannot be scoped to ${v.label} until its adapter ships (B11).`}
              </div>
            )}
          </div>
        </div>

        <div className={`${card} overflow-hidden`}>
          <div className="flex items-center gap-2 px-4 pt-3 pb-2 text-[13px] font-semibold">
            <span className="vc-bg h-2 w-2 rounded-[3px]" aria-hidden />
            <span>Markets on <span className="vc-text">{v.label}</span></span>
          </div>
          {vMarkets.length > 0 ? (
            <div className="fd-scroll max-h-[420px] overflow-y-auto">
              <table className="w-full">
                <thead className={`sticky top-0 ${c.surface}`}>
                  <tr className={`border-b text-left text-[10px] tracking-wider ${c.border} ${c.text3}`}>
                    <th className="px-4 py-2.5 font-semibold">MARKET</th>
                    <th className="px-3 py-2.5 font-semibold">YES</th>
                    <th className="px-3 py-2.5 font-semibold">NO</th>
                    <th className="px-3 py-2.5 font-semibold" title="USDC notional at the touch (best ask YES / best bid NO)">TOUCH</th>
                    <th className="px-3 py-2.5 font-semibold">SOURCE</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {vMarkets.slice(0, 40).map((m) => {
                    const depth =
                      m.yesTouchDepthCents != null || m.noTouchDepthCents != null
                        ? `${m.yesTouchDepthCents ?? "—"}¢ / ${m.noTouchDepthCents ?? "—"}¢`
                        : null;
                    const thin =
                      m.yesTouchDepthCents != null && m.yesTouchDepthCents < 5000;
                    return (
                    <tr key={m.id} className={`border-b text-[12px] last:border-0 ${c.border} hover:bg-[#131A2C]`}>
                      <td className={`max-w-[300px] px-4 py-2.5 ${c.text}`}>
                        <div className="truncate">{m.question}</div>
                        <div className={`text-[10px] ${c.text3}`}>
                          {m.category}
                          {m.eventKey ? ` · ⛭ event cluster ${m.eventKey}` : ""}
                          {m.ambiguityFlag ? " · ⚠ ambiguity check" : ""}
                        </div>
                      </td>
                      <td className={`px-3 py-2.5 ${mono} ${c.text}`}>{m.yesPriceCents ?? "—"}¢</td>
                      <td className={`px-3 py-2.5 ${mono} ${c.text2}`}>{m.noPriceCents ?? "—"}¢</td>
                      <td className={`px-3 py-2.5 ${mono} ${c.text2}`} title="USDC notional at the touch (best ask YES / best bid NO) — entry refused below the venue minimum (S-05 rule a)">
                        {depth ? (
                          <span className={thin ? c.warn : c.text2}>{depth}</span>
                        ) : (
                          <span className={c.text3}>—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${m.dataSource.endsWith("_LIVE") ? `${c.bright} bg-[#00B0F0]/10` : `${c.warn} bg-[#E3A63B]/10`}`}>
                          {m.dataSource.endsWith("_LIVE") ? "LIVE" : "CACHED"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Button size="sm" variant="outline" className={`h-7 border-[#2E3C5F] bg-[#151D30] text-[11px] text-[#E9EEF7] hover:bg-[#1B2540]`} onClick={() => onTrade(m)} disabled={m.ambiguityFlag}>
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
            <div className={`px-4 py-7 text-center text-[12px] ${c.text3}`}>
              {live ? `No ${v.label} markets cached yet — press “Sync ${v.label}” above.` : `No ${v.label} markets — the adapter ships per the B9 roadmap.`}
            </div>
          )}
        </div>
      </div>

      {/* positions on this venue */}
      {vPositions.length > 0 && (
        <div className={`${card} overflow-hidden`}>
          <div className="flex items-center gap-2 px-4 pt-3 pb-2 text-[13px] font-semibold">
            <span className="vc-bg h-2 w-2 rounded-[3px]" aria-hidden />
            <span>In trade on <span className="vc-text">{v.label}</span></span>
          </div>
          <div className="fd-scroll max-h-[260px] overflow-y-auto">
            <table className="w-full">
              <thead className={`sticky top-0 ${c.surface}`}>
                <tr className={`border-b text-left text-[10px] tracking-wider ${c.border} ${c.text3}`}>
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
                    <tr key={p.id} className={`border-b text-[12px] last:border-0 ${c.border}`}>
                      <td className={`max-w-[300px] truncate px-4 py-2.5 ${c.text}`}>
                        {p.market?.question}
                        {clusterKey && clusterSize > 1 && (
                          <span className={`ml-2 rounded px-1.5 py-0.5 text-[9px] font-bold ${c.warn} bg-[#E3A63B]/10`} title={`A-04: ${clusterSize} positions in event cluster ${clusterKey} stack in the per-event exposure cap`}>
                            ⛭ CLUSTER ×{clusterSize}
                          </span>
                        )}
                      </td>
                      <td className={`max-w-[140px] truncate px-3 py-2.5 ${c.text2}`}>{p.robot?.name}</td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold ${p.side === "YES" ? `${c.gain} bg-[#2FC08E]/10` : `${c.warn} bg-[#E3A63B]/10`}`}>{p.side}</span>
                      </td>
                      <td className={`px-3 py-2.5 ${mono} ${c.text}`}>{fmtCents(p.sizeCents)}</td>
                      <td className={`px-3 py-2.5 ${mono} ${c.text2}`}>{p.avgPriceCents}¢ → {mark != null ? `${mark}¢` : "—"}</td>
                      <td className={`px-4 py-2.5 ${mono} font-semibold ${pnlClass(p.unrealizedCents)}`}>{pnlText(p.unrealizedCents)}</td>
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
          <div className="flex items-center gap-2 px-4 pt-3 pb-2 text-[13px] font-semibold">
            <span className="vc-bg h-2 w-2 rounded-[3px]" aria-hidden />
            <span>Recent orders on <span className="vc-text">{v.label}</span></span>
          </div>
          <div className="fd-scroll max-h-[240px] overflow-y-auto">
            {vOrders.length > 0 ? (
              <table className="w-full">
                <thead className={`sticky top-0 ${c.surface}`}>
                  <tr className={`border-b text-left text-[10px] tracking-wider ${c.border} ${c.text3}`}>
                    <th className="px-4 py-2 font-semibold">MARKET</th>
                    <th className="px-3 py-2 font-semibold">SIDE</th>
                    <th className="px-3 py-2 font-semibold">SIZE</th>
                    <th className="px-4 py-2 font-semibold">STATE</th>
                  </tr>
                </thead>
                <tbody>
                  {vOrders.map((o) => (
                    <tr key={o.id} className={`border-b text-[12px] last:border-0 ${c.border}`}>
                      <td className={`max-w-[220px] truncate px-4 py-2 ${c.text}`}>{o.market?.question}{o.robot ? ` · ${o.robot.name}` : ""}</td>
                      <td className={`px-3 py-2 ${c.text2}`}>{o.side.replace("BUY_", "BUY ")}</td>
                      <td className={`px-3 py-2 ${mono} ${c.text2}`}>{fmtCents(o.sizeCents)}</td>
                      <td className="px-4 py-2"><StateChip state={o.state} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className={`px-4 py-6 text-center text-[12px] ${c.text3}`}>No orders on {v.label} yet.</div>
            )}
          </div>
        </div>

        <div className={`${card} overflow-hidden`}>
          <div className="flex items-center gap-2 px-4 pt-3 pb-2 text-[13px] font-semibold">
            <span className="vc-bg h-2 w-2 rounded-[3px]" aria-hidden />
            <span>Recent decisions on <span className="vc-text">{v.label}</span></span>
          </div>
          <div className="fd-scroll max-h-[240px] overflow-y-auto">
            {vTraces.length > 0 ? (
              vTraces.map((t) => (
                <div key={t.id} className={`border-b px-4 py-2.5 last:border-0 ${c.border}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${t.decision === "TRADE" ? `${c.bright} bg-[#00B0F0]/10` : `${c.text3} bg-[#151D30]`}`}>{t.decision}</span>
                    <span className={`text-[12px] font-semibold ${c.text}`}>{t.robot?.name}</span>
                    {t.modelEstimatePct != null && (
                      <span className={`ml-auto text-[11px] ${c.text2} ${mono}`}>est {t.modelEstimatePct}% · mkt {t.marketPriceCents}¢ · edge {t.edgeNetPct} pts</span>
                    )}
                  </div>
                  <div className={`mt-1 text-[11px] ${c.text2}`}>{t.reason}</div>
                </div>
              ))
            ) : (
              <div className={`px-4 py-6 text-center text-[12px] ${c.text3}`}>No robot decisions recorded on {v.label} yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, sub, tone = "text" }: { label: string; value: string; sub: string; tone?: "text" | "gain" | "loss" }) {
  return (
    <div className={`${card} p-3.5`}>
      <div className={`text-[9px] font-semibold tracking-wider ${c.text3}`}>{label}</div>
      <div className={`mt-1 text-[18px] font-semibold ${mono} ${tone === "gain" ? c.gain : tone === "loss" ? c.loss : c.text}`}>{value}</div>
      <div className={`mt-0.5 text-[9.5px] ${c.text3}`}>{sub}</div>
    </div>
  );
}

function Kpi({ label, value, tag, meter, tone = "text" }: { label: string; value: string; tag: string; meter?: { pct: number; detail: string }; tone?: "text" | "gain" | "loss" }) {
  return (
    <div className={`${card} p-4`}>
      <div className={`flex items-center justify-between text-[10px] font-semibold tracking-wider ${c.text3}`}>
        <span>{label}</span>
        <span className={`rounded px-1.5 py-0.5 text-[9px] ${c.bright} bg-[#00B0F0]/10`}>{tag}</span>
      </div>
      <div className={`mt-2 text-[20px] font-semibold ${mono} ${tone === "gain" ? c.gain : tone === "loss" ? c.loss : c.text}`}>{value}</div>
      {meter && (
        <div className="mt-2">
          <div className={`h-1.5 rounded bg-[#151D30]`}>
            <div className="h-full rounded bg-[#3E9BF0]" style={{ width: `${Math.min(100, Math.max(2, meter.pct))}%` }} />
          </div>
          <div className={`mt-1 text-[10px] ${c.text3}`}>{meter.detail}</div>
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4 py-10">
      <div className={`h-6 w-40 animate-pulse rounded ${c.elevated}`} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`h-24 animate-pulse rounded-xl ${c.elevated}`} />)}
      </div>
      <div className={`h-64 animate-pulse rounded-xl ${c.elevated}`} />
    </div>
  );
}
