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

import { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { Activity, ArrowLeft, Bot, CalendarDays, Coins, Gauge, Layers, Pause, PauseCircle, PieChart as PieIcon, Play, Plus, RefreshCw, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type DashboardDTO,
  type LedgerRowDTO,
  type MarketDTO,
  type TraceDTO,
  type VenueStatDTO,
  FAMILY_LABEL,
} from "./types";
import { c, mono, fmtCents, VenueBadge } from "./ui";
import { ROLE_LABEL, VENUE_LABEL, VENUES, venueColor } from "@/lib/venues";
import { ago, AreaChart, Badge, btn, decisionBadge, EmptyState, KV, Metric, money, orderStateBadge, PageSkeleton, Panel, pct, robotStatusBadge, Segmented, T, TableWrap, td, th, toneOf, toneText, trow, VenueTag } from "./ds";
import type { Nav } from "./shell";
import { EMPTY_ENTRY_RULES, VENUE_ENTRY_RULES } from "@/lib/venue/rules";



function pnlText(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${fmtCents(v)}`;
}

// ── Overview (default view) ───────────────────────────────────────────────
// Executive summary for beginners and professionals alike: portfolio KPIs
// and performance, venues, robot monitoring, market opportunities, decision
// feed and system health. Every figure comes from /api/dashboard, the paper
// ledger and synced markets; nothing on this page is mock data.

const PERF_RANGES = [
  { id: "1D", label: "1D", ms: 86400e3 },
  { id: "1W", label: "1W", ms: 7 * 86400e3 },
  { id: "1M", label: "1M", ms: 30 * 86400e3 },
  { id: "ALL", label: "ALL", ms: Infinity },
] as const;

export function DashboardView(props: {
  dash: DashboardDTO | null;
  markets: MarketDTO[];
  ledger: LedgerRowDTO[];
  busy: string | null;
  onSync: () => void;
  onCycle: () => void;
  onReconcile: () => void;
  hasUnknown: boolean;
  onControl: (body: Record<string, unknown>, okMsg: string) => void;
  onOpenVenue: (venueId: string) => void;
  onOpenRobot: (robotId: string) => void;
  onOpenMarket: (marketId: string) => void;
  onNavigate: (n: Nav) => void;
  onRobotStatus: (id: string, status: string, name: string) => void;
}) {
  const { dash, markets, ledger, busy, onSync, onCycle, onReconcile, hasUnknown, onControl, onOpenVenue, onOpenRobot, onOpenMarket, onNavigate, onRobotStatus } = props;
  const [intervalSec, setIntervalSec] = useState(60);
  const [perf, setPerf] = useState<(typeof PERF_RANGES)[number]["id"]>("ALL");
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!dash) return <PageSkeleton />;

  const ctl = dash.control;
  const auto = ctl?.autopilot;
  const paused = ctl?.pause.paused ?? false;
  const positions = dash.positions;
  const unrealized = positions.reduce((a, p) => a + (p.unrealizedCents ?? 0), 0);
  const openCost = positions.reduce((a, p) => a + p.sizeCents, 0);
  const portfolio = dash.balanceCents + openCost + unrealized;
  const ledgerAsc = [...ledger].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const deposits = ledgerAsc.filter((l) => l.type === "DEPOSIT" || l.type === "WITHDRAWAL").reduce((a, l) => a + l.amountCents, 0);
  const overall = deposits > 0 ? portfolio - deposits : null;
  const activeRobots = dash.robots.filter((r) => r.status === "RUNNING" || r.status === "PAPER_ONLY").length;
  const pausedRobots = dash.robots.filter((r) => r.status.startsWith("PAUSED")).length;
  const available = dash.balanceCents;
  const todayPct = dash.balanceCents > 0 ? (dash.todayFlowCents / dash.balanceCents) * 100 : 0;
  const balanceSpark = ledgerAsc.slice(-30).map((l) => l.balanceAfterCents);

  const r = PERF_RANGES.find((x) => x.id === perf)!;
  const cutoff = r.ms === Infinity ? 0 : Date.now() - r.ms;
  const perfData = ledgerAsc
    .filter((l) => new Date(l.createdAt).getTime() >= cutoff)
    .map((l) => ({ x: new Date(l.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", ...(perf === "1D" ? { hour: "2-digit", minute: "2-digit" } : {}) }), y: l.balanceAfterCents / 100 }));
  if (perfData.length > 0 && openCost + unrealized !== 0) perfData.push({ x: "Now (incl. open marks)", y: portfolio / 100 });

  const firstName = (dash.user.name ?? "Founder").split(" ")[0];
  const hour = mounted ? new Date().getHours() : -1;
  const greeting = hour < 0 ? "Welcome back" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const setupDone = dash.marketCount > 0 && dash.traces.length > 0 && !!auto?.enabled;

  // robot rollup
  const rs = new Map<string, { open: number; pnl: number | null }>();
  for (const p of positions) {
    const k = p.robot?.name ?? "";
    const cur = rs.get(k) ?? { open: 0, pnl: null };
    cur.open += 1;
    if (p.unrealizedCents != null) cur.pnl = (cur.pnl ?? 0) + p.unrealizedCents;
    rs.set(k, cur);
  }
  const lastAct = new Map<string, string>();
  for (const t of dash.traces) if (t.robot?.name && !lastAct.has(t.robot.name)) lastAct.set(t.robot.name, t.createdAt);

  // opportunities: biggest recorded move, then volume; tradeable only
  const opps = [...markets]
    .filter((m) => !m.ambiguityFlag && m.yesPriceCents != null)
    .sort((a, b) => Math.abs(b.change24hCents ?? 0) - Math.abs(a.change24hCents ?? 0) || (b.volumeCents ?? 0) - (a.volumeCents ?? 0))
    .slice(0, 6);

  const unresolved = dash.orders.filter((o) => o.state === "UNKNOWN" || o.state === "RECONCILING").length;
  const aiSpent = dash.providers.reduce((a, p) => a + p.spentCents, 0);
  const aiBudget = dash.providers.reduce((a, p) => a + p.monthlyBudgetCents, 0);
  const liveVenues = VENUES.filter((v) => v.adapter === "LIVE");
  const venuesWithData = liveVenues.filter((v) => (dash.venues.find((s) => s.venue === v.id)?.markets ?? 0) > 0).length;
  const lastRun = auto?.lastRun ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <Image src="/brand/logo_mark.png" alt="" width={52} height={52} className="hidden object-contain sm:block" />
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <h1 className="text-[26px] font-bold tracking-tight text-[var(--fd-strong)] sm:text-[30px]">{greeting}, {firstName}</h1>
          <p className="mt-1 text-[15px] text-[var(--fd-text2)]">Your autonomous prediction trading command centre</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button className={btn.secondary} onClick={onSync} disabled={busy === "sync"}>
            <RefreshCw size={16} className={busy === "sync" ? "animate-spin" : ""} /> {busy === "sync" ? "Syncing…" : "Sync venues"}
          </button>
          <button className={btn.primary} onClick={onCycle} disabled={busy !== null}><Play size={16} /> Run robot cycle</button>
        </div>
      </div>

      {!setupDone && (
        <Panel title="Get your robots trading" subtitle="Three steps fill this dashboard with live markets and decisions. Everything stays paper money.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <SetupStep n={1} done={dash.marketCount > 0} hex="#2583FF" title="Sync the venues" body="Pull live markets from Polymarket, Manifold, Limitless and Kalshi."
              action={dash.marketCount > 0 ? `${dash.marketCount} markets synced` : busy === "sync" ? "Syncing…" : "Sync now"}
              onAction={dash.marketCount > 0 ? undefined : onSync} disabled={busy !== null} />
            <SetupStep n={2} done={dash.traces.length > 0} hex="#08D9E8" title="Run a robot cycle" body="Each robot checks its markets once and records every decision with its reasons."
              action={dash.traces.length > 0 ? `${dash.traces.length} decisions recorded` : "Run cycle"}
              onAction={dash.traces.length > 0 ? undefined : onCycle} disabled={busy !== null || dash.marketCount === 0} />
            <SetupStep n={3} done={!!auto?.enabled} hex="#9B7BFF" title="Turn on autopilot" body="Robots run on their own on a schedule. You can pause everything at any time."
              action={auto?.enabled ? "Autopilot is on" : "Start autopilot"}
              onAction={auto?.enabled ? undefined : () => onControl({ action: "AUTOPILOT_START", intervalSec: 60 }, "Autopilot started: cycles every 60s")}
              disabled={busy !== null || dash.marketCount === 0} />
          </div>
        </Panel>
      )}

      <section aria-label="Portfolio summary" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Metric label="Paper balance" value={money(dash.balanceCents)} icon={<Wallet size={17} />} hex={T.blue} spark={balanceSpark} sub="Cash, simulated" />
        <Metric label="Portfolio value" value={money(portfolio)} icon={<PieIcon size={17} />} hex={T.cyan} sub="Cash + open positions at mark" />
        <Metric label="Today's P&L" value={money(dash.todayFlowCents, { sign: true })} tone={toneOf(dash.todayFlowCents)} icon={<CalendarDays size={17} />} hex={T.purple} sub={pct(todayPct, 2, true)} />
        <Metric label="Overall P&L" value={overall != null ? money(overall, { sign: true }) : "—"} tone={toneOf(overall)} icon={<TrendingUp size={17} />} hex={T.green} sub={overall != null && deposits > 0 ? `${pct((overall / deposits) * 100, 2, true)} since start` : "Needs ledger history"} />
        <Metric label="Open exposure" value={money(dash.exposureCents)} icon={<Gauge size={17} />} hex={T.amber} sub={`${dash.allocatedCents > 0 ? pct((dash.exposureCents / dash.allocatedCents) * 100, 0) : "0%"} of allocation · cap ${dash.exposureLimitPct}%/event`} />
        <Metric label="Available capital" value={money(available)} icon={<Coins size={17} />} hex={T.green} sub={`${money(dash.allocatedCents)} allocated to robots`} />
        <Metric label="Active robots" value={`${activeRobots} / ${dash.robots.length}`} icon={<Bot size={17} />} hex={T.blue} sub={pausedRobots ? `${pausedRobots} paused` : "None paused"} />
        <Metric label="Open positions" value={positions.length} icon={<Layers size={17} />} hex={T.cyan} sub={positions.length ? `${money(unrealized, { sign: true })} unrealized` : "Nothing in trade"} />
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel
          title="Portfolio performance"
          subtitle="Cash balance from the paper ledger; the last point adds open positions at mark"
          action={<Segmented label="Performance range" options={PERF_RANGES.map((x) => ({ id: x.id, label: x.label }))} value={perf} onChange={setPerf} />}
        >
          <AreaChart data={perfData} height={300} format={(v) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} emptyTitle="No performance history in this range" emptyBody="The chart starts with your first trade." />
        </Panel>
        <Panel title="Robot status" action={<button className="text-[14px] font-semibold text-[var(--fd-blue-text)] hover:underline" onClick={() => onNavigate({ view: "robots" })}>View all</button>}>
          {dash.robots.length === 0 ? (
            <EmptyState compact title="No robots yet" action={<button className={btn.primary} onClick={() => onNavigate({ view: "studio" })}>Create robot</button>} />
          ) : (
            <ul className="flex flex-col">
              {dash.robots.slice(0, 6).map((rb) => {
                const st = rs.get(rb.name);
                return (
                  <li key={rb.id}>
                    <button onClick={() => onOpenRobot(rb.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-[color:var(--fd-ink)]/[0.03]">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: venueColor(rb.venue) }} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-[var(--fd-strong)]">{rb.name}</span>
                        <span className="block truncate text-[13px] text-[var(--fd-text3)]">{VENUE_LABEL[rb.venue]} · {FAMILY_LABEL[rb.family] ?? rb.family}</span>
                      </span>
                      {robotStatusBadge(rb.status)}
                      <span className={`fd-num w-20 text-right text-[14px] font-semibold ${toneText[toneOf(st?.pnl)]}`}>{st?.pnl != null ? money(st.pnl, { sign: true }) : "—"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <section>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[20px] font-semibold text-[var(--fd-strong)]">Venues</h2>
          <span className="text-[14px] text-[var(--fd-text2)]">{venuesWithData} of {liveVenues.length} live venues have data · click a venue to open its workspace</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {VENUES.map((v) => <VenueCard key={v.id} venueDef={v} stat={dash.venues.find((s) => s.venue === v.id)} onOpen={() => onOpenVenue(v.id)} />)}
        </div>
      </section>

      <Panel title="Robot monitoring" pad={false} action={<button className={btn.small} onClick={() => onNavigate({ view: "studio" })}><Plus size={14} /> New robot</button>}>
        {dash.robots.length === 0 ? (
          <EmptyState compact title="No robots yet" body="Robot Studio walks you through creating one. New robots start in paper mode." />
        ) : (
          <TableWrap minWidth={1000}>
            <thead>
              <tr>
                <th className={th}>Robot</th><th className={th}>Venue</th><th className={th}>Strategy</th><th className={th}>Status</th>
                <th className={`${th} text-right`}>Allocation</th><th className={`${th} text-right`}>Open</th><th className={`${th} text-right`}>Open P&L</th>
                <th className={th}>Last activity</th><th className={`${th} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {dash.robots.map((rb) => {
                const st = rs.get(rb.name);
                const canPause = rb.status === "RUNNING" || rb.status === "PAPER_ONLY";
                const canResume = rb.status === "PAUSED_BY_USER" || rb.status === "PAUSED_BY_RISK" || rb.status === "ERROR";
                return (
                  <tr key={rb.id} className={`${trow} cursor-pointer`} onClick={() => onOpenRobot(rb.id)}>
                    <td className={`${td} font-semibold`}>{rb.name}</td>
                    <td className={td}><VenueTag venue={rb.venue} /></td>
                    <td className={`${td} text-[var(--fd-text-soft)]`}>{FAMILY_LABEL[rb.family] ?? rb.family}</td>
                    <td className={td}>{robotStatusBadge(rb.status)}</td>
                    <td className={`${td} fd-num text-right`}>{money(rb.allocatedCents)}</td>
                    <td className={`${td} fd-num text-right`}>{st?.open ?? 0}<span className="text-[var(--fd-text3)]">/{rb.maxOpenPositions}</span></td>
                    <td className={`${td} fd-num text-right font-semibold ${toneText[toneOf(st?.pnl)]}`}>{st?.pnl != null ? money(st.pnl, { sign: true }) : "—"}</td>
                    <td className={`${td} text-[var(--fd-text-soft)]`}>{lastAct.has(rb.name) ? ago(lastAct.get(rb.name)) : <span className="text-[var(--fd-text3)]">No decisions yet</span>}</td>
                    <td className={`${td} text-right`} onClick={(e) => e.stopPropagation()}>
                      {canPause && <button className={btn.small} disabled={busy !== null} onClick={() => onRobotStatus(rb.id, "PAUSED_BY_USER", rb.name)}><Pause size={14} /> Pause</button>}
                      {canResume && <button className={btn.small} disabled={busy !== null} onClick={() => onRobotStatus(rb.id, "PAPER_ONLY", rb.name)}><Play size={14} /> Resume</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Market opportunities" subtitle="Largest recorded moves first, then volume" action={<button className="text-[14px] font-semibold text-[var(--fd-blue-text)] hover:underline" onClick={() => onNavigate({ view: "markets", tab: "trending" })}>View all</button>}>
          {opps.length === 0 ? (
            <EmptyState compact title="No markets synced yet" action={<button className={btn.primary} onClick={onSync}>Sync now</button>} />
          ) : (
            <ul className="flex flex-col gap-2">
              {opps.map((m) => (
                <li key={m.id}>
                  <button onClick={() => onOpenMarket(m.id)} className="flex w-full items-center gap-3 rounded-xl border border-[var(--fd-line)] bg-[var(--fd-bg2)] px-4 py-3 text-left transition-colors hover:border-[var(--fd-border2)]">
                    <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: venueColor(m.venue) }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-medium text-[var(--fd-strong)]">{m.question}</span>
                      <span className="mt-0.5 block text-[12.5px] text-[var(--fd-text3)]">
                        {VENUE_LABEL[m.venue]} · vol {money(m.volumeCents, { compact: true })} · liq {money(m.liquidityCents, { compact: true })}{m.closeDate ? ` · closes ${new Date(m.closeDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                      </span>
                    </span>
                    {m.change24hCents != null && m.change24hCents !== 0 && (
                      <span className={`fd-num text-[13px] font-semibold ${m.change24hCents > 0 ? "text-[var(--fd-green-text)]" : "text-[var(--fd-red-text)]"}`}>{m.change24hCents > 0 ? "+" : ""}{m.change24hCents}¢</span>
                    )}
                    <span className="fd-num rounded-lg bg-[#00D69A]/12 px-2 py-1 text-[13px] font-semibold text-[var(--fd-green-text)]">YES {m.yesPriceCents}¢</span>
                    <span className="fd-num hidden rounded-lg bg-[#FF5268]/12 px-2 py-1 text-[13px] font-semibold text-[var(--fd-red-text)] sm:inline">NO {m.noPriceCents ?? "—"}¢</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Decision feed" subtitle="Latest robot decisions with their reasoning" action={<button className="text-[14px] font-semibold text-[var(--fd-blue-text)] hover:underline" onClick={() => onNavigate({ view: "intel", tab: "decisions" })}>View all</button>}>
          {dash.traces.length === 0 ? (
            <EmptyState compact title="No decisions yet" body="Run a robot cycle and every verdict lands here with its risk checks." />
          ) : (
            <ul className="flex flex-col">
              {dash.traces.slice(0, 6).map((t) => {
                const checks = (() => { try { return JSON.parse(t.riskChecks) as Array<{ passed: boolean }>; } catch { return []; } })();
                const passed = checks.filter((c) => c.passed).length;
                return (
                  <li key={t.id} className="flex gap-3 border-t border-[var(--fd-line)] py-3 first:border-t-0">
                    <span className="mt-1 h-10 w-1 shrink-0 rounded-full" style={{ background: venueColor(t.market?.venue ?? "") }} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {decisionBadge(t.decision)}
                        <span className="text-[14px] font-semibold text-[var(--fd-strong)]">{t.robot?.name}</span>
                        {t.modelEstimatePct != null && <span className="fd-num text-[12.5px] text-[var(--fd-purple-text)]">conf. {t.modelEstimatePct.toFixed(0)}%</span>}
                        {checks.length > 0 && <span className={`text-[12.5px] ${passed === checks.length ? "text-[var(--fd-green-text)]" : "text-[var(--fd-amber-text)]"}`}>{passed}/{checks.length} checks</span>}
                        <span className="fd-num ml-auto text-[12.5px] text-[var(--fd-text3)]">{new Date(t.createdAt).toISOString().slice(11, 16)} UTC</span>
                      </div>
                      <div className="mt-1 truncate text-[13.5px] text-[var(--fd-text-soft)]">{t.market?.question}</div>
                      <div className="mt-0.5 line-clamp-2 text-[13px] text-[var(--fd-text2)]">{t.reason}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {positions.length > 0 && (
        <Panel title="In trade now" pad={false} subtitle="Marks use each venue's last synced price">
          <TableWrap minWidth={820}>
            <thead><tr><th className={th}>Venue</th><th className={th}>Market</th><th className={th}>Robot</th><th className={th}>Side</th><th className={`${th} text-right`}>Size</th><th className={`${th} text-right`}>Entry → mark</th><th className={`${th} text-right`}>P&L</th></tr></thead>
            <tbody>
              {positions.map((p) => {
                const mark = p.side === "YES" ? p.market?.yesPriceCents : p.market?.noPriceCents;
                return (
                  <tr key={p.id} className={trow}>
                    <td className={td}>{p.market?.venue ? <VenueTag venue={p.market.venue} /> : "—"}</td>
                    <td className={`${td} max-w-[320px] truncate`}>{p.market?.question}</td>
                    <td className={`${td} text-[var(--fd-text-soft)]`}>{p.robot?.name}</td>
                    <td className={td}><Badge tone={p.side === "YES" ? "green" : "red"}>{p.side}</Badge></td>
                    <td className={`${td} fd-num text-right`}>{money(p.sizeCents)}</td>
                    <td className={`${td} fd-num text-right text-[var(--fd-text-soft)]`}>{p.avgPriceCents}¢ → {mark != null ? `${mark}¢` : "—"}</td>
                    <td className={`${td} fd-num text-right font-semibold ${toneText[toneOf(p.unrealizedCents)]}`}>{p.unrealizedCents != null ? money(p.unrealizedCents, { sign: true }) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Panel>
      )}

      <Panel title="System health" icon={<Activity size={18} />} action={<button className="text-[14px] font-semibold text-[var(--fd-blue-text)] hover:underline" onClick={() => onNavigate({ view: "risk", tab: "health" })}>Details</button>}>
        <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
          <div>
            <KV k="Venue connectivity" v={<Badge tone={venuesWithData === liveVenues.length ? "green" : venuesWithData > 0 ? "amber" : "red"} dot>{venuesWithData}/{liveVenues.length} venues with data</Badge>} />
            <KV k="Data freshness" v={(() => { const ts = dash.venues.map((s) => s.syncedAt).filter(Boolean) as string[]; const last = ts.sort().at(-1); return last ? `Last sync ${ago(last)}` : "Never synced"; })()} />
            <KV k="Robot execution" v={lastRun ? `${ago(lastRun.at)} · ${lastRun.cycles} robots · ${lastRun.trades} trades${lastRun.errors ? ` · ${lastRun.errors} errors` : ""}` : "Autopilot has not run"} />
            <KV k="Risk engine" v={paused ? <Badge tone="red" dot>Platform paused</Badge> : <Badge tone="green" dot>Enforcing</Badge>} />
          </div>
          <div>
            <KV k="Pending safety checks" v={unresolved > 0 ? <span className="flex items-center gap-2"><Badge tone="amber">{unresolved} unresolved orders</Badge>{hasUnknown && <button className={btn.small} onClick={onReconcile}>Resolve now</button>}</span> : <Badge tone="green">None</Badge>} />
            <KV k="Event outbox" v={dash.outboxPending === 0 ? <Badge tone="green">Drained</Badge> : <Badge tone="amber">{dash.outboxPending} pending</Badge>} />
            <KV k="AI budget" v={aiBudget > 0 ? `${money(aiSpent)} of ${money(aiBudget)}` : "No AI provider enabled · baseline estimator"} />
            <KV k="Alerts" v={dash.openAlerts > 0 ? <Badge tone="amber">{dash.openAlerts} open</Badge> : <Badge tone="green">None</Badge>} />
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 rounded-xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] p-4 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-[var(--fd-strong)]">Autopilot</div>
            <div className="text-[13.5px] text-[var(--fd-text2)]">{auto?.enabled ? `On: robots cycle every ${auto.intervalSec}s` : "Off: robots only run when you start a cycle"} · you own the switches, robots never change them</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!auto?.enabled && (
              <Segmented label="Autopilot interval" options={[{ id: "60", label: "60s" }, { id: "120", label: "2m" }, { id: "300", label: "5m" }]} value={String(intervalSec)} onChange={(v) => setIntervalSec(Number(v))} />
            )}
            {auto?.enabled ? (
              <button className={btn.secondary} onClick={() => onControl({ action: "AUTOPILOT_STOP" }, "Autopilot stopped")} disabled={busy !== null}>Stop autopilot</button>
            ) : (
              <button className={btn.primary} onClick={() => onControl({ action: "AUTOPILOT_START", intervalSec }, `Autopilot started: cycles every ${intervalSec}s`)} disabled={busy !== null || paused}>Start autopilot</button>
            )}
            <button className={btn.danger} onClick={() => onControl({ action: "PAUSE", reason: "manual pause from Overview" }, "Everything paused")} disabled={busy !== null || paused}>
              <PauseCircle size={16} /> {paused ? "Paused" : "Pause everything"}
            </button>
          </div>
        </div>
      </Panel>
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
        className="group relative flex min-h-[200px] flex-col overflow-hidden rounded-3xl border border-dashed p-6 text-left transition-colors hover:bg-[color:var(--fd-ink)]/[0.02]"
        style={{
          borderColor: `color-mix(in srgb, ${v.hex} 40%, transparent)`,
          backgroundImage: `repeating-linear-gradient(135deg, color-mix(in srgb, ${v.hex} 6%, transparent) 0 12px, transparent 12px 24px)`,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-display text-[24px] font-bold" style={{ color: `color-mix(in srgb, ${v.hex} 70%, var(--fd-text-soft))` }}>{v.label}</div>
            <div className={`mt-1 text-[15px] ${c.text2}`}>{VENUE_TAGLINE[v.id] ?? ""}</div>
          </div>
          <span className="rounded-full bg-[color:var(--fd-ink)]/[0.06] px-3 py-1 text-[13px] font-semibold text-[var(--fd-text-soft)]">{suspended ? "Suspended" : "Coming soon"}</span>
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
    <div className={`flex flex-col gap-3 rounded-2xl border p-5 ${done ? "border-[color:var(--fd-ink)]/[0.06] bg-[color:var(--fd-ink)]/[0.02]" : "border-[color:var(--fd-ink)]/10 bg-[var(--fd-elevated)]"}`}>
      <div className="flex items-center gap-3">
        <span
          className="grid h-10 w-10 place-items-center rounded-xl font-display text-[18px] font-bold"
          style={done ? { background: "rgba(47,192,142,0.15)", color: "#4FDCA6" } : { background: hex, color: "#071018" }}
          aria-hidden
        >
          {done ? "✓" : n}
        </span>
        <span className="text-[18px] font-semibold text-[var(--fd-strong)]">{title}</span>
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
        <span className="mt-auto text-[15px] font-semibold text-[var(--fd-green-text)]">✓ {action}</span>
      )}
    </div>
  );
}

// ── Venue workspace ───────────────────────────────────────────────────────
// One architecture for every venue: header with connection and adapter
// status, KPIs, markets (left) and robots + rules (right), then positions,
// orders, decisions, connection health and data quality. The workspace wears
// the venue's color. Pending and suspended venues say why, and never offer
// actions their adapter can't perform.
export function VenueWorkspace(props: {
  venueId: string;
  dash: DashboardDTO | null;
  markets: MarketDTO[];
  busy: string | null;
  onBack: () => void;
  onSyncVenue: (venue: string) => void;
  onCycle: () => void;
  onTrade: (m: MarketDTO) => void;
  onOpenMarket: (id: string) => void;
  onCreateRobot: (venueId: string) => void;
  onControl: (body: Record<string, unknown>, okMsg: string) => void;
  onOpenRobot: (robotId: string) => void;
}) {
  const { venueId, dash, markets, busy, onBack, onSyncVenue, onCycle, onTrade, onOpenMarket, onCreateRobot, onOpenRobot } = props;
  const v = VENUES.find((x) => x.id === venueId);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [mktFilter, setMktFilter] = useState<"all" | "closing" | "thin">("all");
  if (!dash || !v) return <PageSkeleton />;
  const stat = dash.venues.find((s) => s.venue === venueId);
  const vRobots = dash.robots.filter((r) => r.venue === venueId);
  const vMarkets = markets.filter((m) => m.venue === venueId);
  const vPositions = dash.positions.filter((p) => p.market?.venue === venueId);
  const vOrders = dash.orders.filter((o) => o.market?.venue === venueId);
  const vTraces = dash.traces.filter((t) => t.market?.venue === venueId);
  const live = v.adapter === "LIVE";
  const suspended = v.id === "DRIFT_BET";
  const rules = VENUE_ENTRY_RULES[venueId] ?? EMPTY_ENTRY_RULES;
  const hex = v.hex;

  const robotPnl = new Map<string, { open: number; pnl: number | null }>();
  for (const p of vPositions) {
    const name = p.robot?.name ?? "—";
    const cur = robotPnl.get(name) ?? { open: 0, pnl: null };
    cur.open += 1;
    if (p.unrealizedCents != null) cur.pnl = (cur.pnl ?? 0) + p.unrealizedCents;
    robotPnl.set(name, cur);
  }

  const syncedAt = stat?.syncedAt ? new Date(stat.syncedAt).getTime() : null;
  const ageMin = mounted && syncedAt != null ? Math.floor((Date.now() - syncedAt) / 60000) : null;
  const freshLabel = ageMin == null ? "—" : ageMin < 1 ? "Just now" : ageMin < 60 ? `${ageMin}m ago` : ageMin < 1440 ? `${Math.floor(ageMin / 60)}h ago` : `${Math.floor(ageMin / 1440)}d ago`;
  const stale = ageMin != null && ageMin > 360;

  const closingSoon = vMarkets.filter((m) => m.closeDate && new Date(m.closeDate).getTime() - Date.now() < 14 * 86_400_000 && new Date(m.closeDate).getTime() > Date.now());
  const thinBook = vMarkets.filter((m) => rules.minTouchDepthCents != null && (m.yesTouchDepthCents == null || m.yesTouchDepthCents < rules.minTouchDepthCents));
  const shown = mktFilter === "closing" ? closingSoon : mktFilter === "thin" ? thinBook : vMarkets;
  const feeBps = vMarkets.map((m) => m.yesTakerFeeBps).filter((x): x is number => x != null);
  const feeRange = feeBps.length ? (Math.min(...feeBps) === Math.max(...feeBps) ? `${Math.min(...feeBps)} bps` : `${Math.min(...feeBps)}–${Math.max(...feeBps)} bps`) : null;
  const liveSrc = vMarkets.filter((m) => m.dataSource.endsWith("_LIVE") || m.dataSource.endsWith("_SYNC")).length;
  const missingPrice = vMarkets.filter((m) => m.yesPriceCents == null || m.noPriceCents == null).length;
  const flagged = vMarkets.filter((m) => m.ambiguityFlag).length;
  const credential: Record<string, string> = {
    POLYMARKET: "Wallet (EVM · Polygon)",
    MANIFOLD: "Public API, play money",
    LIMITLESS: "Public REST · wallet (Base)",
    KALSHI: "API key (RSA / Ed25519)",
    AZURO: "Wallet (EVM)",
    DRIFT_BET: "Adapter not built",
  };
  const unrealized = vPositions.reduce((a, p) => a + (p.unrealizedCents ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-[13.5px] text-[var(--fd-text3)]">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 hover:text-[var(--fd-strong)]"><ArrowLeft size={14} /> Overview</button>
        <span className="mx-1.5" aria-hidden>/</span><span className="text-[var(--fd-text-soft)]">Venues</span>
        <span className="mx-1.5" aria-hidden>/</span><span className="text-[var(--fd-text-soft)]">{v.label}</span>
      </nav>

      <section className="relative overflow-hidden rounded-2xl border bg-[var(--fd-surface)] p-5 sm:p-6" style={{ borderColor: `color-mix(in srgb, ${hex} ${live ? 35 : 18}%, transparent)` }}>
        <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(720px 240px at 0% 0%, color-mix(in srgb, ${hex} ${live ? 18 : 8}%, transparent), transparent 70%)` }} />
        <div className="relative flex flex-wrap items-center gap-5">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-[28px] font-bold" style={live ? { background: hex, color: "#071018" } : { background: `color-mix(in srgb, ${hex} 14%, transparent)`, color: `color-mix(in srgb, ${hex} 60%, var(--fd-text2))` }} aria-hidden>
            {v.label.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[28px] font-bold tracking-tight text-[var(--fd-strong)] sm:text-[32px]">{v.label}</h1>
              {live ? <Badge tone="green" dot>Connected</Badge> : suspended ? <Badge tone="red" dot>Suspended</Badge> : <Badge tone="amber" dot>Adapter pending</Badge>}
              <Badge>{ROLE_LABEL[v.role].toLowerCase()}</Badge>
            </div>
            <p className="mt-1.5 text-[15px] text-[var(--fd-text2)]">
              {({ POLYMARKET: "Main venue · Polygon · USDC order book", MANIFOLD: "Play money · zero-risk test ground", LIMITLESS: "Crypto order book on Base · USDC", KALSHI: "CFTC-regulated US exchange · USD", AZURO: "On-chain sports betting · EVM", DRIFT_BET: "Solana prediction markets" } as Record<string, string>)[v.id]}
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {live && (
              <button className={btn.secondary} onClick={() => onSyncVenue(v.id)} disabled={busy === "sync"}>
                <RefreshCw size={16} className={busy === "sync" ? "animate-spin" : ""} /> {busy === "sync" ? "Syncing…" : "Sync"}
              </button>
            )}
            <button className={btn.secondary} onClick={onCycle} disabled={busy !== null || !live}><Play size={16} /> Run robot cycle</button>
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-[14.5px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: live ? hex : "var(--fd-border2)", color: live ? "#071018" : "var(--fd-text2)" }}
              disabled={!live}
              title={live ? undefined : "Robots can't be created here until the adapter is live"}
              onClick={() => onCreateRobot(v.id)}
            >
              <Plus size={16} /> Create robot
            </button>
          </div>
        </div>
      </section>

      {!live && (
        <div role="note" className="rounded-2xl border px-5 py-4 text-[14.5px] leading-relaxed text-[var(--fd-text)]" style={{ borderColor: suspended ? "rgba(255,82,104,0.35)" : "rgba(255,181,71,0.35)", background: suspended ? "rgba(255,82,104,0.08)" : "rgba(255,181,71,0.08)" }}>
          {suspended
            ? "This venue has been offline since the April 2026 exploit, so no adapter was built. The venue stays listed so the lineup never changes silently; a replacement for this slot is waiting on a founder decision."
            : "The adapter is built but not verified yet: it goes live once its contract test passes against recorded market data. Until then there is no market data here and robot creation is disabled."}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Metric label="Markets synced" value={stat?.markets ?? 0} hex={hex} sub={live ? "Open markets" : "Adapter not live"} />
        <Metric label="Active robots" value={`${stat?.robotsActive ?? 0} / ${stat?.robotsTotal ?? 0}`} hex={hex} sub="Running / scoped here" />
        <Metric label="Open exposure" value={money(stat?.exposureCents ?? 0)} hex={hex} sub={`${stat?.openPositions ?? 0} positions`} />
        <Metric label="Today (open marks)" value={vPositions.length ? money(unrealized, { sign: true }) : "—"} tone={vPositions.length ? toneOf(unrealized) : "flat"} hex={hex} sub="Mark-to-market" />
        <Metric label="Data freshness" value={freshLabel} tone={stale ? "loss" : "text"} hex={hex} sub={stale ? "Stale: sync again" : live ? "Last venue sync" : "—"} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title={<span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: hex }} />Markets on {v.label}</span>}
          pad={false}
          action={
            <Segmented label="Market filter" value={mktFilter} onChange={setMktFilter} options={[
              { id: "all", label: `All ${vMarkets.length}` },
              { id: "closing", label: `Closing soon ${closingSoon.length}` },
              ...(rules.minTouchDepthCents != null ? [{ id: "thin" as const, label: `Thin book ${thinBook.length}` }] : []),
            ]} />
          }
        >
          <div className="mt-3">
            {shown.length === 0 ? (
              <EmptyState compact title={!live ? `No ${v.label} markets` : mktFilter === "all" ? `No ${v.label} markets synced yet` : "No markets match this filter"} body={live && mktFilter === "all" ? "Press Sync above to pull this venue's open markets." : undefined} />
            ) : (
              <TableWrap minWidth={760}>
                <thead><tr><th className={th}>Market</th><th className={th}>YES</th><th className={`${th} text-right`}>NO</th><th className={`${th} text-right`}>Top-of-book depth</th><th className={`${th} text-right`}>Volume</th><th className={th}><span className="sr-only">Trade</span></th></tr></thead>
                <tbody>
                  {shown.slice(0, 40).map((m) => {
                    const thin = rules.minTouchDepthCents != null && (m.yesTouchDepthCents == null || m.yesTouchDepthCents < rules.minTouchDepthCents);
                    return (
                      <tr key={m.id} className={`${trow} cursor-pointer`} onClick={() => onOpenMarket(m.id)}>
                        <td className={`${td} max-w-[320px]`}>
                          <div className="truncate font-medium">{m.question}</div>
                          <div className="mt-0.5 text-[12.5px] text-[var(--fd-text3)]">
                            <span className="capitalize">{m.category}</span>
                            {m.closeDate ? ` · closes ${new Date(m.closeDate).toLocaleDateString("en-US", { day: "numeric", month: "short" })}` : ""}
                            {m.eventKey ? " · event cluster" : ""}{m.ambiguityFlag ? " · flagged" : ""}
                          </div>
                        </td>
                        <td className={td}>
                          <div className="flex items-center gap-2.5">
                            <span className="fd-num w-10 font-semibold text-[var(--fd-strong)]">{m.yesPriceCents ?? "—"}¢</span>
                            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[color:var(--fd-ink)]/[0.07]" aria-hidden><span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, m.yesPriceCents ?? 0))}%`, background: hex }} /></span>
                          </div>
                        </td>
                        <td className={`${td} fd-num text-right text-[var(--fd-text-soft)]`}>{m.noPriceCents ?? "—"}¢</td>
                        <td className={`${td} fd-num text-right ${thin ? "text-[var(--fd-amber-text)]" : "text-[var(--fd-text-soft)]"}`} title={thin ? "Below the venue minimum: entries are refused" : undefined}>{m.yesTouchDepthCents != null ? money(m.yesTouchDepthCents) : "—"}</td>
                        <td className={`${td} fd-num text-right text-[var(--fd-text-soft)]`}>{money(m.volumeCents, { compact: true })}</td>
                        <td className={`${td} text-right`}>
                          <button className={btn.small} onClick={(e) => { e.stopPropagation(); onTrade(m); }} disabled={m.ambiguityFlag || !live}>Trade</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            )}
          </div>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title={`Robots on ${v.label}`} action={<span className="text-[13px] text-[var(--fd-text3)]">{vRobots.length} scoped</span>}>
            {vRobots.length === 0 ? (
              <EmptyState compact title="No robots here yet" body={live ? "Create one pre-scoped to this venue." : "Robots can be scoped here once the adapter is live."} />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {vRobots.map((r) => {
                  const rp = robotPnl.get(r.name);
                  return (
                    <li key={r.id}>
                      <button onClick={() => onOpenRobot(r.id)} className="w-full rounded-xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] p-3.5 text-left transition-colors hover:border-[var(--fd-border2)]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[15px] font-semibold text-[var(--fd-strong)]">{r.name}</span>
                          <span className={`fd-num text-[14px] font-semibold ${toneText[toneOf(rp?.pnl)]}`}>{rp?.pnl != null ? money(rp.pnl, { sign: true }) : "—"}</span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-2 text-[13px] text-[var(--fd-text2)]">
                          <span className="truncate">{FAMILY_LABEL[r.family] ?? r.family} · v{r.activeVersion}</span>
                          {robotStatusBadge(r.status)}
                        </div>
                        <div className="fd-num mt-2 text-[12.5px] text-[var(--fd-text3)]">{money(r.allocatedCents)} allocated · cap {money(r.maxPositionCents)} · ≤ {r.maxOpenPositions} open</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel title="Venue rules" subtitle="Enforced by the risk engine at cycle and ticket time">
            <KV k="Adapter" v={live ? "Live · market data" : suspended ? "Suspended" : "Pending"} />
            <KV k="Credential" v={credential[v.id] ?? "—"} />
            <KV k="Minimum book depth" v={rules.minTouchDepthCents != null ? money(rules.minTouchDepthCents) : "Not required"} mono />
            <KV k="Per-market cap" v={rules.perMarketPositionCapCents != null ? money(rules.perMarketPositionCapCents) : "Not set"} mono />
            <KV k="Close window" v={rules.minMinutesBeforeClose != null ? `${rules.minMinutesBeforeClose} min before close` : "Not set"} mono />
            <KV k="Taker fee" v={feeRange ?? "Not reported"} mono />
          </Panel>
        </div>
      </div>

      {vPositions.length > 0 && (
        <Panel title={`In trade on ${v.label}`} pad={false}>
          <TableWrap minWidth={720}>
            <thead><tr><th className={th}>Market</th><th className={th}>Robot</th><th className={th}>Side</th><th className={`${th} text-right`}>Size</th><th className={`${th} text-right`}>Entry → mark</th><th className={`${th} text-right`}>P&L</th></tr></thead>
            <tbody>
              {vPositions.map((p) => {
                const mark = p.side === "YES" ? p.market?.yesPriceCents : p.market?.noPriceCents;
                return (
                  <tr key={p.id} className={trow}>
                    <td className={`${td} max-w-[320px] truncate`}>{p.market?.question}</td>
                    <td className={`${td} text-[var(--fd-text-soft)]`}>{p.robot?.name}</td>
                    <td className={td}><Badge tone={p.side === "YES" ? "green" : "red"}>{p.side}</Badge></td>
                    <td className={`${td} fd-num text-right`}>{money(p.sizeCents)}</td>
                    <td className={`${td} fd-num text-right text-[var(--fd-text-soft)]`}>{p.avgPriceCents}¢ → {mark != null ? `${mark}¢` : "—"}</td>
                    <td className={`${td} fd-num text-right font-semibold ${toneText[toneOf(p.unrealizedCents)]}`}>{p.unrealizedCents != null ? money(p.unrealizedCents, { sign: true }) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Recent orders" pad={false}>
          {vOrders.length === 0 ? <EmptyState compact title={`No orders on ${v.label} yet`} /> : (
            <TableWrap minWidth={520}>
              <thead><tr><th className={th}>Market</th><th className={th}>Side</th><th className={`${th} text-right`}>Size</th><th className={th}>State</th></tr></thead>
              <tbody>
                {vOrders.map((o) => (
                  <tr key={o.id} className={trow}>
                    <td className={`${td} max-w-[240px] truncate`}>{o.market?.question}{o.robot ? <span className="text-[var(--fd-text3)]"> · {o.robot.name}</span> : null}</td>
                    <td className={td}><Badge tone={o.side.includes("YES") ? "green" : "red"}>{o.side.replace("_", " ")}</Badge></td>
                    <td className={`${td} fd-num text-right`}>{money(o.sizeCents)}</td>
                    <td className={td}>{orderStateBadge(o.state)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
        <Panel title="Recent decisions">
          {vTraces.length === 0 ? <EmptyState compact title={`No robot decisions on ${v.label} yet`} /> : <div>{vTraces.map((t) => <TraceRow key={t.id} t={t} />)}</div>}
        </Panel>
        <Panel title="Connection health">
          <KV k="Adapter status" v={live ? <Badge tone="green" dot>Live</Badge> : suspended ? <Badge tone="red" dot>Suspended</Badge> : <Badge tone="amber" dot>Pending</Badge>} />
          <KV k="Last successful sync" v={stat?.syncedAt ? `${new Date(stat.syncedAt).toUTCString().replace(" GMT", " UTC")}` : "Never"} />
          <KV k="Freshness" v={stale ? <Badge tone="amber">Stale</Badge> : stat?.syncedAt ? <Badge tone="green">Fresh</Badge> : "—"} />
          <KV k="Order sending" v="Paper only: live sends stay behind the gates" />
        </Panel>
        <Panel title="Data quality">
          <KV k="Markets from live data" v={vMarkets.length ? `${liveSrc} of ${vMarkets.length}` : "—"} mono />
          <KV k="Missing prices" v={missingPrice} mono />
          <KV k="Flagged for ambiguous resolution" v={flagged} mono />
          <KV k="Below minimum book depth" v={rules.minTouchDepthCents != null ? thinBook.length : "Rule not used here"} mono />
        </Panel>
      </div>
    </div>
  );
}

// ── A-08 front-end depth: one expandable trace row, shared by the dashboard
// traces list and every venue workspace. Collapsed = the glanceable verdict;
// expanded = the full evidence: provenance envelope (A-02) and the pre-trade
// risk checks with their pass/fail verdicts and details. "A forecast without
// provenance is not evidence" — clicking any trace shows exactly that.
export function TraceRow({ t }: { t: TraceDTO }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`border-b py-2.5 last:border-0 ${c.border}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-2 text-left" aria-expanded={open}>
        <span className={`rounded px-2 py-0.5 text-[12px] font-bold ${t.decision === "TRADE" ? `${c.bright} bg-[#2583FF]/10` : `${c.text3} bg-[var(--fd-elevated)]`}`}>{t.decision}</span>
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

export function TraceDetail({ t }: { t: TraceDTO }) {
  const prov = parseProvenance(t.provenance);
  const checks = parseRiskChecks(t.riskChecks);
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1">
      <span className={`shrink-0 text-[13.5px] ${c.text3}`}>{k}</span>
      <span className={`text-right text-[13.5px] ${c.text2}`}>{v}</span>
    </div>
  );
  return (
    <div className="mt-2 rounded-xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] p-4">
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
        <div>
          <div className={`mb-2 text-[13px] font-semibold uppercase tracking-wider ${c.text3}`}>Model & provenance</div>
          {row("model", <span className={mono}>{t.modelKey ?? "—"}</span>)}
          {prov?.kind && row("kind", prov.kind)}
          {prov?.provider && row("provider / model", `${prov.provider}${prov.model ? " · " + prov.model : ""}`)}
          {prov?.estimatorVersion && row("estimator version", <span className={mono}>{prov.estimatorVersion}</span>)}
          {prov?.latencyMs != null && row("latency", `${prov.latencyMs} ms`)}
          {prov?.cache && row("cache", prov.cache === "HIT" ? "HIT (cached, zero cost)" : prov.cache)}
          {row("screening", <span className={prov?.screening === "FLAGGED" ? "text-[var(--fd-red-text)]" : "text-[var(--fd-green-text)]"}>{prov?.screening ?? "—"}{prov?.screeningReasons?.length ? ` — ${prov.screeningReasons.join("; ")}` : ""}</span>)}
          {prov?.fallbackFrom && row("fallback from", <span className="text-[var(--fd-amber-text)]">{prov.fallbackFrom}</span>)}
          {prov?.costCents != null && row("AI cost", fmtCents(prov.costCents))}
          {prov?.evidenceHash && row("evidence hash", <span className={mono} title={prov.evidenceHash}>{prov.evidenceHash.slice(0, 18)}…</span>)}
        </div>
        <div>
          <div className={`mb-2 text-[13px] font-semibold uppercase tracking-wider ${c.text3}`}>Pre-trade risk checks</div>
          {checks.length === 0 && <div className={`text-[13.5px] ${c.text3}`}>No checks recorded on this decision</div>}
          {checks.map((ck, i) => (
            <div key={i} className="py-1">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1 py-px text-[12px] font-bold ${ck.passed ? "text-[var(--fd-green-text)] bg-[#00D69A]/10" : "text-[var(--fd-red-text)] bg-[#FF5268]/10"}`}>{ck.passed ? "PASS" : "FAIL"}</span>
                <span className={`text-[13.5px] font-semibold ${c.text}`}>{ck.check}</span>
              </div>
              <div className={`ml-1 border-l pl-2 text-[13px] ${c.text3}`} style={{ borderColor: ck.passed ? "#1D4A3C" : "#4A1D25" }}>{ck.detail}</div>
            </div>
          ))}
        </div>
      </div>
      <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-[13px] ${c.border} ${c.text3}`}>
        <span>trace <span className={mono}>{t.id.slice(0, 10)}…</span></span>
        <span>trigger <b className={c.text2}>{t.trigger ?? "—"}</b></span>
        <span>strategy <span className={mono}>{t.strategyVersionId ? t.strategyVersionId.slice(0, 10) + "…" : "—"}</span></span>
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
        isAI ? `text-[var(--fd-purple-text)] bg-[var(--fd-purple-text)]/10` : `${c.text3} bg-[var(--fd-elevated)]`
      }`}
    >
      {label}
      {cache === "HIT" && <span className="text-[var(--fd-green-text)]"> ·C</span>}
      {flagged && <span className="text-[var(--fd-red-text)]"> ·A-06</span>}
    </span>
  );
}

