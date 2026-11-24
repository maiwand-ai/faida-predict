"use client";

// FAIDA Predict — Home. The page you open every morning:
//   1. How much is it all worth, and what did I make? (hero + profit by period)
//   2. Where is my money working? (venue cards)
//   3. What just happened, and why? (live activity, AI-spotted value)
//   4. Who is doing well? (robot leaderboard)
//   5. Does anything need me? (open bets, alerts)
// Every figure is real: the paper ledger, positions, robot decisions and the
// venue rollup. Nothing here is decorative or simulated.

import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ArrowRight, Bell, Bot, Brain, CheckCircle2, CircleSlash, Compass, Pause, Play, Plus, RefreshCw, ShieldAlert, Sparkles, TrendingDown, TrendingUp, Trophy, XCircle,
} from "lucide-react";
import type { DashboardDTO, LedgerRowDTO } from "./types";
import { FAMILY_LABEL } from "./types";
import { VENUES, VENUE_LABEL, venueColor } from "@/lib/venues";
import { ago, AreaChart, Badge, btn, EmptyState, money, PageSkeleton, Panel, Segmented, T, toneOf, toneText } from "./ds";
import type { Nav } from "./shell";
import { StatusChip } from "./shell";
import { decisionWords, robotStateLine, systemStatus } from "./status";
import { availabilityFor, STATUS_TONE, useAvailability } from "./help";
import { AskFaida } from "./ask";
import { STATUS_LABEL, VENUE_GUIDES } from "@/lib/venue/availability";

const DISMISS_KEY = "faida.inbox.dismissed";
const VENUE_TAGLINE: Record<string, string> = {
  POLYMARKET: "The biggest prediction market",
  MANIFOLD: "Play money: a safe test ground",
  LIMITLESS: "Crypto order book on Base",
  KALSHI: "US-regulated exchange, in dollars",
  AZURO: "Sports betting on-chain",
  DRIFT_BET: "Solana prediction markets",
};

const RANGES = [
  { id: "1W", label: "1W", ms: 7 * 86400e3 },
  { id: "1M", label: "1M", ms: 30 * 86400e3 },
  { id: "3M", label: "3M", ms: 90 * 86400e3 },
  { id: "ALL", label: "All", ms: Infinity },
] as const;

function periodStarts(now: Date) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(day);
  week.setDate(day.getDate() - ((day.getDay() + 6) % 7)); // Monday
  return {
    today: day.getTime(),
    week: week.getTime(),
    month: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    year: new Date(now.getFullYear(), 0, 1).getTime(),
  };
}

export function HomeView(props: {
  dash: DashboardDTO | null;
  ledger: LedgerRowDTO[];
  busy: string | null;
  onSync: () => void;
  onCycle: () => void;
  onControl: (body: Record<string, unknown>, okMsg: string) => void;
  onOpenRobot: (id: string) => void;
  onOpenVenue: (id: string) => void;
  onNavigate: (n: Nav) => void;
  onNewRobot: () => void;
  onClosePosition: (positionId: string) => void;
  onOpenMarket: (id: string) => void;
}) {
  const { dash, ledger, busy, onSync, onCycle, onControl, onOpenRobot, onOpenVenue, onNavigate, onNewRobot, onClosePosition, onOpenMarket } = props;
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("1M");
  const [dismissed, setDismissed] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]") as string[]; } catch { return []; }
  });
  const { data: avail } = useAvailability();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const nowDate = mounted ? new Date() : null;
  const now = nowDate ? nowDate.getTime() : 0;
  if (!dash) return <PageSkeleton />;

  // ── money ──
  const positions = dash.positions;
  const unrealized = positions.reduce((a, p) => a + (p.unrealizedCents ?? 0), 0);
  const openCost = positions.reduce((a, p) => a + p.sizeCents, 0);
  const total = dash.balanceCents + openCost + unrealized;
  const asc = [...ledger].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const deposits = asc.filter((l) => l.type === "DEPOSIT" || l.type === "WITHDRAWAL").reduce((a, l) => a + l.amountCents, 0);
  const allTime = deposits > 0 ? total - deposits : null;
  const allTimePct = allTime != null && deposits > 0 ? (allTime / deposits) * 100 : null;
  const starts = now ? periodStarts(new Date(now)) : null;
  const realized = (from: number) => {
    const rows = asc.filter((l) => (l.type === "SETTLEMENT" || l.type === "FEE") && new Date(l.createdAt).getTime() >= from);
    return { cents: rows.reduce((a, l) => a + l.amountCents, 0), bets: rows.filter((l) => l.type === "SETTLEMENT").length };
  };
  const periods = starts
    ? [
        { id: "today", label: "Today", ...realized(starts.today) },
        { id: "week", label: "This week", ...realized(starts.week) },
        { id: "month", label: "This month", ...realized(starts.month) },
        { id: "year", label: "This year", ...realized(starts.year) },
      ]
    : [];
  const r = RANGES.find((x) => x.id === range)!;
  const cutoff = r.ms === Infinity || !now ? 0 : now - r.ms;
  const chart = asc
    .filter((l) => new Date(l.createdAt).getTime() >= cutoff)
    .map((l) => ({ x: new Date(l.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }), y: l.balanceAfterCents / 100 }));
  if (chart.length > 0) chart.push({ x: "Now", y: total / 100 });

  // ── people & state ──
  const st = systemStatus(dash);
  const auto = dash.control?.autopilot;
  const paused = dash.control?.pause.paused ?? false;
  const firstName = (dash.user.name ?? "there").split(" ")[0];
  const hour = now ? new Date(now).getHours() : -1;
  const greeting = hour < 0 ? "Welcome back" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateLine = now ? new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "";
  const setup = [
    { done: dash.marketCount > 0, label: "Load markets", action: onSync, disabled: busy !== null },
    { done: dash.traces.length > 0, label: "Do a first check", action: onCycle, disabled: busy !== null || dash.marketCount === 0 },
    { done: !!auto?.enabled, label: "Turn on autopilot", action: () => onControl({ action: "AUTOPILOT_START", intervalSec: 60 }, "Autopilot on: robots check every 60s"), disabled: busy !== null || dash.marketCount === 0 },
  ];
  const setupLeft = setup.filter((s) => !s.done).length;
  const nextStep = setup.find((s) => !s.done);

  const robotPnl = new Map<string, { open: number; pnl: number }>();
  for (const p of positions) {
    const k = p.robot?.name ?? "";
    const cur = robotPnl.get(k) ?? { open: 0, pnl: 0 };
    cur.open += 1;
    cur.pnl += p.unrealizedCents ?? 0;
    robotPnl.set(k, cur);
  }
  const leaderboard = [...dash.robots]
    .sort((a, b) => (robotPnl.get(b.name)?.pnl ?? 0) - (robotPnl.get(a.name)?.pnl ?? 0) || Number(b.status === "PAPER_ONLY" || b.status === "RUNNING") - Number(a.status === "PAPER_ONLY" || a.status === "RUNNING"))
    .slice(0, 5);

  const seen = new Set<string>();
  const aiValue = dash.traces
    .filter((t) => t.modelEstimatePct != null && t.marketPriceCents != null && t.market?.question)
    .map((t) => ({ t, gap: (t.modelEstimatePct ?? 0) - (t.marketPriceCents ?? 0) }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .filter(({ t }) => (seen.has(t.market!.question) ? false : (seen.add(t.market!.question), true)))
    .slice(0, 4);

  const inbox = dash.notifications.filter((n) => !dismissed.includes(n.id));
  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-200);
    setDismissed(next);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  const venuesSorted = [...VENUES].sort((a, b) => Number(b.adapter === "LIVE") - Number(a.adapter === "LIVE"));

  return (
    <div className="flex flex-col gap-7">
      {/* greeting + quick actions */}
      <header className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-[var(--fd-text2)]">{dateLine}</div>
          <h1 className="mt-0.5 text-[28px] font-bold tracking-tight text-[var(--fd-strong)] sm:text-[34px]">{greeting}, {firstName}</h1>
          <div className="mt-2 lg:hidden"><StatusChip dash={dash} onNavigate={onNavigate} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <QuickAction icon={<Plus size={16} />} label="New robot" onClick={onNewRobot} primary />
          <QuickAction icon={<Compass size={16} />} label="Find markets" onClick={() => onNavigate({ view: "markets", tab: "trending" })} />
          <QuickAction icon={<Play size={16} />} label="Check now" onClick={onCycle} disabled={busy !== null || paused} title="Every running robot looks at its markets once, right now" />
          <QuickAction
            icon={auto?.enabled ? <Pause size={16} /> : <Sparkles size={16} />}
            label={auto?.enabled ? "Autopilot on" : "Autopilot off"}
            active={!!auto?.enabled}
            onClick={() => (auto?.enabled ? onControl({ action: "AUTOPILOT_STOP" }, "Autopilot off") : onControl({ action: "AUTOPILOT_START", intervalSec: 60 }, "Autopilot on: robots check every 60s"))}
            disabled={busy !== null || (paused && !auto?.enabled) || dash.marketCount === 0}
            title={auto?.enabled ? `Robots check every ${auto.intervalSec}s. Click to turn off.` : "Let robots check markets on their own every minute"}
          />
        </div>
      </header>

      {/* first-run: one slim progress bar instead of a wall of cards */}
      {setupLeft > 0 && nextStep && (
        <section className="fd-glass flex flex-wrap items-center gap-4 rounded-3xl border border-[var(--fd-border)] bg-[var(--fd-surface)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-[var(--fd-strong)]">Get your robots trading · {3 - setupLeft} of 3 done</div>
            <div className="mt-2 flex gap-1.5">
              {setup.map((s) => <span key={s.label} className={`h-1.5 flex-1 rounded-full ${s.done ? "fd-brand-bg" : "bg-[color:var(--fd-ink)]/[0.08]"}`} />)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[var(--fd-text2)]">
              {setup.map((s) => <span key={s.label} className={s.done ? "text-[var(--fd-green-text)]" : ""}>{s.done ? "✓ " : ""}{s.label}</span>)}
            </div>
          </div>
          <button className={btn.primary} onClick={nextStep.action} disabled={nextStep.disabled}>{nextStep.label} <ArrowRight size={16} /></button>
        </section>
      )}

      {/* hero: worth + profit */}
      <section className="fd-glass relative overflow-hidden rounded-[32px] border border-[var(--fd-border)] bg-[var(--fd-surface)]">
        <span aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full opacity-40 blur-3xl" style={{ background: "var(--fd-brand-a)" }} />
        <span aria-hidden className="pointer-events-none absolute -bottom-32 right-10 h-72 w-72 rounded-full opacity-25 blur-3xl" style={{ background: "var(--fd-brand-b)" }} />
        <div className="relative grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-[var(--fd-text2)]">
              Total value <Badge tone="amber" dot>Practice money</Badge>
            </div>
            <div className="mt-2 font-[family-name:var(--font-space-grotesk)] text-[44px] font-bold leading-none tracking-tight tabular-nums text-[var(--fd-strong)] sm:text-[58px]">{money(total)}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[14px]">
              {allTime != null ? (
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold ${allTime >= 0 ? "bg-[#00D69A]/15 text-[var(--fd-green-text)]" : "bg-[#FF5268]/15 text-[var(--fd-red-text)]"}`}>
                  {allTime >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                  {money(allTime, { sign: true })}{allTimePct != null ? ` (${allTimePct >= 0 ? "+" : ""}${allTimePct.toFixed(2)}%)` : ""}
                </span>
              ) : null}
              <span className="text-[var(--fd-text2)]">since you started</span>
            </div>
            <div className="mt-6 flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium text-[var(--fd-text3)]">Value over time</span>
              <Segmented label="Chart range" options={RANGES.map((x) => ({ id: x.id, label: x.label }))} value={range} onChange={setRange} />
            </div>
            <div className="mt-2">
              <AreaChart data={chart} height={220} hex={allTime != null && allTime < 0 ? T.red : T.green} format={(v) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} emptyTitle="Your chart starts with your first bet" emptyBody="Turn on autopilot and every closed bet adds a point here." />
            </div>
          </div>

          <aside className="border-t border-[var(--fd-line)] p-6 sm:p-8 lg:border-l lg:border-t-0">
            <div className="text-[14px] font-medium text-[var(--fd-text2)]">Profit from closed bets</div>
            <ul className="mt-3 flex flex-col gap-1">
              {periods.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3 rounded-2xl px-3 py-2.5 hover:bg-[color:var(--fd-ink)]/[0.04]">
                  <span>
                    <span className="block text-[14.5px] font-medium text-[var(--fd-text)]">{p.label}</span>
                    <span className="block text-[12.5px] text-[var(--fd-text3)]">{p.bets} closed bet{p.bets === 1 ? "" : "s"}</span>
                  </span>
                  <span className={`fd-num text-[18px] font-semibold ${toneText[toneOf(p.cents)]}`}>{money(p.cents, { sign: true })}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--fd-line)] pt-4">
              <MiniStat label="Cash" value={money(dash.balanceCents)} />
              <MiniStat label="In open bets" value={money(openCost)} sub={`${positions.length} open`} />
              <MiniStat label="Open profit" value={positions.length ? money(unrealized, { sign: true }) : "—"} tone={toneOf(positions.length ? unrealized : null)} />
              <MiniStat label="Robots working" value={`${st.running} / ${dash.robots.length}`} />
            </div>
            <button className="mt-4 text-[14px] font-semibold text-[var(--fd-brand-text)] hover:underline" onClick={() => onNavigate({ view: "trading", tab: "performance" })}>Full performance →</button>
          </aside>
        </div>
      </section>

      <AskFaida onOpenMarket={onOpenMarket} onNavigate={onNavigate} />

      {/* venues */}
      <section>
        <SectionHead title="Your venues" sub="Where your robots place bets" action={<button className="text-[14px] font-semibold text-[var(--fd-brand-text)] hover:underline" onClick={() => onNavigate({ view: "markets", tab: "trending" })}>All markets →</button>} />
        <div className="fd-scroll -mx-1 grid auto-cols-[minmax(250px,1fr)] grid-flow-col gap-4 overflow-x-auto px-1 pb-2 xl:grid-flow-row xl:grid-cols-3 xl:overflow-visible">
          {venuesSorted.map((v) => {
            const live = v.adapter === "LIVE";
            const stat = dash.venues.find((s) => s.venue === v.id);
            const pnl = stat && stat.openPositions > 0 ? stat.unrealizedCents : null;
            const a = availabilityFor(avail, v.id);
            const playOnly = VENUE_GUIDES.find((g) => g.venue === v.id)?.realMoney === false;
            return (
              <button key={v.id} onClick={() => onOpenVenue(v.id)} aria-label={`Open ${v.label}`}
                className={`fd-glass group relative overflow-hidden rounded-3xl border bg-[var(--fd-surface)] p-5 text-left transition-transform duration-150 hover:-translate-y-0.5 ${live ? "" : "opacity-60"}`}
                style={{ borderColor: `color-mix(in srgb, ${v.hex} ${live ? 45 : 20}%, transparent)` }}>
                <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full opacity-30 blur-2xl transition-opacity group-hover:opacity-50" style={{ background: v.hex }} />
                <div className="relative flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl text-[18px] font-bold text-[#071018]" style={{ background: live ? v.hex : `color-mix(in srgb, ${v.hex} 40%, var(--fd-elevated))` }}>{v.label.slice(0, 1)}</span>
                    <span>
                      <span className="block text-[17px] font-semibold text-[var(--fd-strong)]">{v.label}</span>
                      <span className="block text-[12.5px] text-[var(--fd-text2)]">{VENUE_TAGLINE[v.id] ?? ""}</span>
                    </span>
                  </div>
                  {live ? <Badge tone="green" dot>Live</Badge> : <Badge tone={v.id === "DRIFT_BET" ? "red" : "neutral"}>{v.id === "DRIFT_BET" ? "Suspended" : "Soon"}</Badge>}
                </div>
                <dl className="relative mt-5 grid grid-cols-3 gap-2">
                  <div><dt className="text-[12px] text-[var(--fd-text3)]">Markets</dt><dd className="fd-num text-[18px] font-semibold text-[var(--fd-strong)]">{stat?.markets ?? 0}</dd></div>
                  <div><dt className="text-[12px] text-[var(--fd-text3)]">Robots on</dt><dd className="fd-num text-[18px] font-semibold text-[var(--fd-strong)]">{stat?.robotsActive ?? 0}<span className="text-[13px] text-[var(--fd-text3)]">/{stat?.robotsTotal ?? 0}</span></dd></div>
                  <div><dt className="text-[12px] text-[var(--fd-text3)]">{pnl == null ? "In bets" : "Open P&L"}</dt><dd className={`fd-num text-[18px] font-semibold ${pnl == null ? "text-[var(--fd-strong)]" : toneText[toneOf(pnl)]}`}>{pnl == null ? money(stat?.exposureCents ?? 0, { compact: true }) : money(pnl, { sign: true, compact: true })}</dd></div>
                </dl>
                {live && a && (
                  <div className="relative mt-4 flex items-center gap-2 border-t border-[var(--fd-line)] pt-3 text-[12.5px] text-[var(--fd-text2)]">
                    {playOnly ? <span>Play money, available everywhere</span> : <><span>Real money in {a.country}:</span><Badge tone={STATUS_TONE[a.status]} dot>{STATUS_LABEL[a.status]}</Badge></>}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* what happened + who's winning */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel title="Live activity" subtitle="What your robots just did, and why" action={<button className="text-[14px] font-semibold text-[var(--fd-brand-text)] hover:underline" onClick={() => onNavigate({ view: "intel", tab: "decisions" })}>Full log →</button>}>
          {dash.traces.length === 0 ? (
            <EmptyState compact icon={<Sparkles size={22} />} title="Nothing yet" body="When robots check their markets, every decision shows up here with its reason." />
          ) : (
            <ol className="relative flex flex-col">
              {dash.traces.slice(0, 7).map((t, i, arr) => {
                const w = decisionWords(t.decision);
                const look = w === "Opened a trade" ? { c: "#00D69A", i: <CheckCircle2 size={16} /> } : w === "Closed a trade" ? { c: "#FFB547", i: <XCircle size={16} /> } : w === "Blocked by a safety check" ? { c: "#FF5268", i: <ShieldAlert size={16} /> } : { c: "#7C889B", i: <CircleSlash size={16} /> };
                return (
                  <li key={t.id} className="relative flex gap-3.5 pb-4 last:pb-0">
                    {i < arr.length - 1 && <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-24px)] w-px bg-[var(--fd-line)]" />}
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${look.c} 18%, transparent)`, color: look.c }} aria-hidden>{look.i}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[14.5px] font-semibold text-[var(--fd-strong)]">{t.robot?.name ?? "A robot"}</span>
                        <span className="text-[14px] text-[var(--fd-text-soft)]">{w.charAt(0).toLowerCase() + w.slice(1)}</span>
                        <span className="ml-auto text-[12.5px] text-[var(--fd-text3)]">{ago(t.createdAt)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 truncate text-[13.5px] text-[var(--fd-text)]">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: venueColor(t.market?.venue ?? "") }} aria-hidden />
                        <span className="truncate">{t.market?.question}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[13px] text-[var(--fd-text2)]">{t.reason}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <Panel title="Robot leaderboard" icon={<Trophy size={18} />} action={<button className="text-[14px] font-semibold text-[var(--fd-brand-text)] hover:underline" onClick={() => onNavigate({ view: "robots" })}>All robots →</button>}>
          {leaderboard.length === 0 ? (
            <EmptyState compact icon={<Bot size={22} />} title="No robots yet" body="Start one from a ready-made robot in a minute." action={<button className={btn.primary} onClick={onNewRobot}>New robot</button>} />
          ) : (
            <ol className="flex flex-col gap-1">
              {leaderboard.map((rb, i) => {
                const rp = robotPnl.get(rb.name);
                return (
                  <li key={rb.id}>
                    <button onClick={() => onOpenRobot(rb.id)} className="flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left hover:bg-[color:var(--fd-ink)]/[0.04]">
                      <span className={`fd-num grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-bold ${i === 0 ? "fd-brand-bg" : "bg-[color:var(--fd-ink)]/[0.06] text-[var(--fd-text2)]"}`}>{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[15px] font-semibold text-[var(--fd-strong)]">{rb.name}</span>
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: venueColor(rb.venue) }} title={VENUE_LABEL[rb.venue]} aria-hidden />
                        </span>
                        <span className="block truncate text-[12.5px] text-[var(--fd-text2)]">{FAMILY_LABEL[rb.family] ?? rb.family} · {robotStateLine(rb.status, rb.statusReason, rp?.open ?? 0)}</span>
                      </span>
                      <span className={`fd-num text-[14.5px] font-semibold ${rp ? toneText[toneOf(rp.pnl)] : "text-[var(--fd-text3)]"}`}>{rp ? money(rp.pnl, { sign: true }) : "—"}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </div>

      {/* open bets · AI value · alerts */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel title={`Open bets (${positions.length})`} action={positions.length > 0 ? <button className="text-[14px] font-semibold text-[var(--fd-brand-text)] hover:underline" onClick={() => onNavigate({ view: "trading", tab: "positions" })}>Portfolio →</button> : undefined}>
          {positions.length === 0 ? (
            <EmptyState compact title="No open bets" body="Robots open one when they find a price they like." />
          ) : (
            <ul className="flex flex-col gap-2">
              {positions.slice(0, 5).map((p) => {
                const mark = p.side === "YES" ? p.market?.yesPriceCents : p.market?.noPriceCents;
                return (
                  <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-[var(--fd-bg2)] px-3.5 py-3">
                    <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: venueColor(p.market?.venue ?? "") }} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium text-[var(--fd-strong)]">{p.market?.question}</div>
                      <div className="mt-0.5 text-[12.5px] text-[var(--fd-text3)]"><span className={p.side === "YES" ? "text-[var(--fd-green-text)]" : "text-[var(--fd-red-text)]"}>{p.side}</span> · {money(p.sizeCents)} at {p.avgPriceCents}¢ → {mark != null ? `${mark}¢` : "—"}</div>
                    </div>
                    <span className={`fd-num text-[14px] font-semibold ${toneText[toneOf(p.unrealizedCents)]}`}>{p.unrealizedCents != null ? money(p.unrealizedCents, { sign: true }) : "—"}</span>
                    <button className={btn.small} disabled={busy !== null} onClick={() => onClosePosition(p.id)}>Close</button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="AI spotted value" icon={<Brain size={18} />} subtitle="Where the AI's odds differ most from the market price">
          {aiValue.length === 0 ? (
            <EmptyState compact icon={<Brain size={22} />} title="No estimates yet" body="After the first market check, the biggest gaps between the AI's odds and the price show up here." />
          ) : (
            <ul className="flex flex-col gap-2">
              {aiValue.map(({ t, gap }) => (
                <li key={t.id} className="rounded-2xl bg-[var(--fd-bg2)] px-3.5 py-3">
                  <div className="line-clamp-2 text-[14px] font-medium text-[var(--fd-strong)]">{t.market?.question}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--fd-text2)]">
                    <span>AI <b className="fd-num text-[var(--fd-purple-text)]">{t.modelEstimatePct!.toFixed(0)}%</b></span>
                    <span>· Market <b className="fd-num text-[var(--fd-text)]">{t.marketPriceCents}¢</b></span>
                    <span className={`fd-num ml-auto rounded-full px-2 py-0.5 font-semibold ${gap >= 0 ? "bg-[#00D69A]/15 text-[var(--fd-green-text)]" : "bg-[#FF5268]/15 text-[var(--fd-red-text)]"}`}>{gap >= 0 ? `YES looks cheap +${gap.toFixed(0)}` : `NO looks cheap ${gap.toFixed(0)}`} pts</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Alerts (${inbox.length + st.issues.length})`} icon={<Bell size={18} />} className="lg:col-span-2 2xl:col-span-1">
          {st.issues.length > 0 && (
            <ul className="mb-2 flex flex-col gap-2">
              {st.issues.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-[var(--fd-bg2)] px-3.5 py-3">
                  <Badge tone={i.tone} dot>{i.tone === "red" ? "Urgent" : "To fix"}</Badge>
                  <span className="min-w-0 flex-1 text-[13.5px] text-[var(--fd-text)]">{i.text}</span>
                  <button className="text-[13px] font-semibold text-[var(--fd-brand-text)] hover:underline" onClick={() => onNavigate(i.to)}>{i.fix} →</button>
                </li>
              ))}
            </ul>
          )}
          {inbox.length === 0 ? (
            st.issues.length === 0 && <EmptyState compact icon={<Bell size={22} />} title="You're all caught up" />
          ) : (
            <ul className="flex flex-col gap-2">
              {inbox.slice(0, 4).map((n) => (
                <li key={n.id} className="rounded-2xl bg-[var(--fd-bg2)] px-3.5 py-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 text-[14px] font-semibold text-[var(--fd-strong)]">{n.title}</div>
                    {n.severity === "CRITICAL" ? <Badge tone="red" dot>Urgent</Badge> : n.severity === "WARNING" ? <Badge tone="amber" dot>Warning</Badge> : null}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[13px] text-[var(--fd-text2)]">{n.body} · {ago(n.createdAt)}</p>
                  <button className="mt-1 text-[13px] font-semibold text-[var(--fd-brand-text)] hover:underline" onClick={() => dismiss(n.id)}>Got it</button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="flex justify-center">
        <button className={btn.ghost} onClick={onSync} disabled={busy === "sync"}>
          <RefreshCw size={15} className={busy === "sync" ? "animate-spin" : ""} /> {busy === "sync" ? "Refreshing markets…" : "Refresh markets from every venue"}
        </button>
      </div>
    </div>
  );
}

function SectionHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2 px-1">
      <div>
        <h2 className="text-[20px] font-semibold text-[var(--fd-strong)]">{title}</h2>
        {sub && <p className="text-[13.5px] text-[var(--fd-text2)]">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function MiniStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "gain" | "loss" | "flat" }) {
  return (
    <div className="rounded-2xl bg-[var(--fd-bg2)] px-3 py-2.5">
      <div className="text-[12px] text-[var(--fd-text3)]">{label}</div>
      <div className={`fd-num text-[15.5px] font-semibold ${tone ? toneText[tone] : "text-[var(--fd-strong)]"}`}>{value}</div>
      {sub && <div className="text-[11.5px] text-[var(--fd-text3)]">{sub}</div>}
    </div>
  );
}

function QuickAction({ icon, label, onClick, primary, active, disabled, title }: { icon: ReactNode; label: string; onClick: () => void; primary?: boolean; active?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-11 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        primary ? "fd-brand-bg fd-glow" : active ? "border border-[#00D69A]/40 bg-[#00D69A]/12 text-[var(--fd-green-text)]" : "fd-glass border border-[var(--fd-border)] bg-[var(--fd-surface)] text-[var(--fd-text)] hover:border-[var(--fd-border2)]"
      }`}
    >
      {icon} {label}
    </button>
  );
}
