"use client";

// FAIDA Predict — individual robot workspace. One robot, every angle:
// dashboard, performance, positions, orders, decision journal, strategy
// versions, AI intelligence, risk, execution logs and settings. Data comes
// from GET /api/robots/[id]/detail (positions, orders, edge gate, 30-day
// realized ledger flow), GET /api/decisions?robotId= (the full journal) and
// GET /api/strategies?robotId= (versions). Status changes go through the
// existing PATCH transition table; nothing here bypasses a gate.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar as RBar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, Bot, CheckCircle2, Lock, Pause, Pencil, Play, RotateCw, XCircle } from "lucide-react";
import { type RobotDetailDTO, type StrategyConfigDTO, FAMILY_LABEL } from "./types";
import { VENUE_LABEL, venueColor } from "@/lib/venues";
import {
  ago, AreaChart, Badge, Bar, btn, decisionBadge, EmptyState, KV, Metric, money, orderStateBadge, PageSkeleton, Panel, pct,
  robotStatusBadge, T, Tabs, TableWrap, td, th, toneOf, toneText, trow, VenueTag,
} from "./ds";
import { TraceDetail } from "./dashboard";
import { useDecisions } from "./intel";

const GATE_LABEL: Record<string, string> = {
  MODEL_CALIBRATED: "Edge evidence",
  PROVENANCE_COMPLETENESS: "Provenance completeness",
  EVIDENCE_CLEAN: "Evidence cleanliness",
  BACKTEST_EVIDENCE: "Backtest evidence",
  PAPER_SESSION: "Paper session",
  RECORDED_CONSENT_C25: "Recorded consent",
};

type VersionRow = { id: string; version: number; config: StrategyConfigDTO; orderCount: number; isActive: boolean; createdAt: string };

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "performance", label: "Performance" },
  { id: "positions", label: "Positions" },
  { id: "orders", label: "Orders" },
  { id: "decisions", label: "Decisions" },
  { id: "strategy", label: "Strategy" },
  { id: "ai", label: "AI Intelligence" },
  { id: "risk", label: "Risk" },
  { id: "logs", label: "Execution Logs" },
  { id: "settings", label: "Settings" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function RobotDetail(props: {
  robotId: string;
  busy: string | null;
  onBack: () => void;
  onBackLabel: string;
  onOpenVenue: (venueId: string) => void;
  onOpenMarket: (marketId: string) => void;
  onEditStrategy: () => void;
  onCycleRobot: (robotId: string, name: string) => Promise<unknown> | void;
  onRobotStatus: (robotId: string, status: string, name: string) => Promise<unknown> | void;
  onClosePosition: (positionId: string) => Promise<unknown> | void;
}) {
  const { robotId, busy, onBack, onBackLabel, onOpenVenue, onEditStrategy, onCycleRobot, onRobotStatus, onClosePosition } = props;
  const [data, setData] = useState<RobotDetailDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [tab, setTab] = useState<TabId>("dashboard");
  const [tick, setTick] = useState(0);
  const journal = useDecisions(robotId, 200);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/robots/${robotId}/detail`);
        const json = (await res.json().catch(() => null)) as RobotDetailDTO | { error: string } | null;
        if (!alive) return;
        if (!res.ok || !json || "error" in json) {
          setErr(json && "error" in json ? json.error : "Robot details are unavailable");
          return;
        }
        setData(json);
        setErr(null);
      } catch {
        if (alive) setErr("Could not load this robot. Try again in a moment.");
      }
    })();
    (async () => {
      try {
        const res = await fetch(`/api/strategies?robotId=${robotId}`);
        const json = (await res.json()) as { versions?: VersionRow[] };
        if (alive && json.versions) setVersions(json.versions);
      } catch { /* optional panel */ }
    })();
    const t = setTimeout(() => setTick((x) => x + 1), 20000);
    return () => { alive = false; clearTimeout(t); };
  }, [robotId, tick]);

  const perf = useMemo(() => {
    const flow = data?.flow ?? [];
    let peak = 0;
    let dd = 0;
    for (const f of flow) { peak = Math.max(peak, f.cumCents); dd = Math.max(dd, peak - f.cumCents); }
    const days = flow.filter((f) => f.netCents !== 0);
    const up = days.filter((f) => f.netCents > 0);
    const down = days.filter((f) => f.netCents < 0);
    const gains = up.reduce((a, f) => a + f.netCents, 0);
    const losses = -down.reduce((a, f) => a + f.netCents, 0);
    let sharpe: number | null = null;
    if (days.length >= 10 && data && data.robot.allocatedCents > 0) {
      const rets = days.map((d) => d.netCents / data.robot.allocatedCents);
      const mean = rets.reduce((a, x) => a + x, 0) / rets.length;
      const sd = Math.sqrt(rets.reduce((a, x) => a + (x - mean) ** 2, 0) / (rets.length - 1));
      sharpe = sd > 0 ? (mean / sd) * Math.sqrt(365) : null;
    }
    const sum = (n: number) => flow.slice(-n).reduce((a, f) => a + f.netCents, 0);
    // an all-zero window is "no realized activity", not a flat line
    const active = flow.some((f) => f.netCents !== 0);
    return {
      flow: active ? flow : [], dd, up: up.length, down: down.length, profitFactor: losses > 0 ? gains / losses : null, sharpe,
      realized30: flow.at(-1)?.cumCents ?? 0, week: sum(7), month: sum(30), avgDay: days.length ? (gains - losses) / days.length : null,
    };
  }, [data]);

  if (err) {
    return (
      <Panel>
        <EmptyState title={err} action={<button className={btn.secondary} onClick={onBack}><ArrowLeft size={16} /> {onBackLabel}</button>} />
      </Panel>
    );
  }
  if (!data) return <PageSkeleton />;

  const { robot, positions, orders, gate, todayNetCents, unrealizedCents } = data;
  const hex = venueColor(robot.venue);
  const exposure = positions.reduce((a, p) => a + p.sizeCents, 0);
  const totalPnl = perf.realized30 + (unrealizedCents ?? 0);
  const traces = journal ?? data.traces;
  const filled = orders.filter((o) => o.state === "FILLED" || o.state === "PARTIALLY_FILLED").length;
  const execRate = orders.length ? (filled / orders.length) * 100 : null;
  const canPause = robot.status === "RUNNING" || robot.status === "PAPER_ONLY";
  const canResume = robot.status === "PAUSED_BY_USER" || robot.status === "PAUSED_BY_RISK" || robot.status === "ERROR";
  const activeVersion = versions?.find((v) => v.isActive) ?? null;
  const lastExec = traces[0]?.createdAt ?? null;
  const dailyBudget = Math.round((robot.allocatedCents * robot.dailyLossStopPct) / 100);
  const todayLoss = Math.max(0, -todayNetCents);
  const ddBudget = Math.round((robot.allocatedCents * robot.drawdownStopPct) / 100);
  const aiTraces = traces.filter((t) => t.modelEstimatePct != null);

  const positionsTable = (
    positions.length === 0 ? (
      <EmptyState compact title="No open positions" body="Positions appear here when this robot enters a market." />
    ) : (
      <TableWrap minWidth={760}>
        <thead><tr><th className={th}>Market</th><th className={th}>Side</th><th className={`${th} text-right`}>Entry</th><th className={`${th} text-right`}>Current</th><th className={`${th} text-right`}>Size</th><th className={`${th} text-right`}>Unrealized</th><th className={th}>Opened</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {positions.map((p) => {
            const mark = p.side === "YES" ? p.market?.yesPriceCents : p.market?.noPriceCents;
            return (
              <tr key={p.id} className={trow}>
                <td className={`${td} max-w-[340px] truncate`}>{p.market?.question}</td>
                <td className={td}><Badge tone={p.side === "YES" ? "green" : "red"}>{p.side}</Badge></td>
                <td className={`${td} fd-num text-right`}>{p.avgPriceCents}¢</td>
                <td className={`${td} fd-num text-right`}>{mark != null ? `${mark}¢` : "—"}</td>
                <td className={`${td} fd-num text-right`}>{money(p.sizeCents)}</td>
                <td className={`${td} fd-num text-right font-semibold ${toneText[toneOf(p.unrealizedCents)]}`}>{p.unrealizedCents != null ? money(p.unrealizedCents, { sign: true }) : "—"}</td>
                <td className={`${td} text-[var(--fd-text-soft)]`}>{ago(p.openedAt)}</td>
                <td className={`${td} text-right`}>
                  <button className={btn.small} disabled={busy !== null || robot.mode === "LIVE_PILOT"} onClick={async () => { await onClosePosition(p.id); setTick((x) => x + 1); }}>Close</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
    )
  );

  const ordersTable = (
    orders.length === 0 ? (
      <EmptyState compact title="No orders yet" body="This robot has not placed an order." />
    ) : (
      <TableWrap minWidth={760}>
        <thead><tr><th className={th}>Time (UTC)</th><th className={th}>Market</th><th className={th}>Side</th><th className={`${th} text-right`}>Price</th><th className={`${th} text-right`}>Size</th><th className={`${th} text-right`}>Fee</th><th className={th}>State</th></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className={trow}>
              <td className={`${td} fd-num whitespace-nowrap text-[var(--fd-text-soft)]`}>{new Date(o.createdAt).toISOString().replace("T", " ").slice(5, 19)}</td>
              <td className={`${td} max-w-[320px] truncate`}>{o.market?.question}</td>
              <td className={td}><Badge tone={o.side.includes("YES") ? "green" : "red"}>{o.side.replace("_", " ")}</Badge></td>
              <td className={`${td} fd-num text-right`}>{o.priceCents}¢</td>
              <td className={`${td} fd-num text-right`}>{money(o.sizeCents)}</td>
              <td className={`${td} fd-num text-right text-[var(--fd-text-soft)]`}>{money(o.feeCents)}</td>
              <td className={td}>{orderStateBadge(o.state)}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    )
  );

  const journalList = (items: typeof traces, withDetail: boolean) =>
    items.length === 0 ? (
      <EmptyState compact title="No decisions recorded yet" body="Run a cycle on this robot, or turn on autopilot." />
    ) : (
      <ul className="flex flex-col gap-2">
        {items.map((t) => <JournalItem key={t.id} t={t} withDetail={withDetail} />)}
      </ul>
    );

  return (
    <div className="flex flex-col gap-6">
      {/* header */}
      <div className="flex flex-col gap-3">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13.5px] text-[var(--fd-text3)]">
          <button onClick={onBack} className="inline-flex items-center gap-1.5 hover:text-[var(--fd-strong)]"><ArrowLeft size={14} /> {onBackLabel}</button>
          <span aria-hidden>/</span>
          <button onClick={() => onOpenVenue(robot.venue)} className="hover:text-[var(--fd-strong)]">{VENUE_LABEL[robot.venue] ?? robot.venue}</button>
          <span aria-hidden>/</span>
          <span className="text-[var(--fd-text-soft)]">{robot.name}</span>
        </nav>
        <div className="relative overflow-hidden rounded-2xl border border-[var(--fd-border)] bg-[var(--fd-surface)] p-5 sm:p-6">
          <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(600px 200px at 0% 0%, color-mix(in srgb, ${hex} 14%, transparent), transparent 70%)` }} />
          <div className="relative flex flex-wrap items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl" style={{ background: `color-mix(in srgb, ${hex} 20%, transparent)`, color: hex, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hex} 40%, transparent)` }} aria-hidden>
              <Bot size={28} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-[26px] font-bold tracking-tight text-[var(--fd-strong)] sm:text-[28px]">{robot.name}</h1>
                {robotStatusBadge(robot.status)}
                {robot.status !== "PAPER_ONLY" && <Badge tone="amber" dot>{robot.paperMode ? "Paper" : robot.mode}</Badge>}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-[var(--fd-text2)]">
                <VenueTag venue={robot.venue} />
                <span>{FAMILY_LABEL[robot.family] ?? robot.family}</span>
                <span>Strategy v{robot.activeVersion}</span>
                <span>Last decision {lastExec ? ago(lastExec) : "never"}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={btn.secondary} onClick={() => onCycleRobot(robot.id, robot.name)} disabled={busy !== null || !canPause} title={canPause ? "Evaluate once now" : "Only running or paper robots cycle"}>
                <RotateCw size={16} /> Run cycle
              </button>
              <button className={btn.secondary} onClick={onEditStrategy}><Pencil size={16} /> Edit strategy</button>
              {canPause && <button className={btn.secondary} onClick={() => onRobotStatus(robot.id, "PAUSED_BY_USER", robot.name)} disabled={busy !== null}><Pause size={16} /> Pause</button>}
              {canResume && <button className={btn.primary} onClick={() => onRobotStatus(robot.id, "PAPER_ONLY", robot.name)} disabled={busy !== null}><Play size={16} /> Resume (paper)</button>}
            </div>
          </div>
          {robot.statusReason && (
            <div className="relative mt-4 rounded-xl border border-[#FFB547]/35 bg-[#FFB547]/10 px-4 py-2.5 text-[14px] text-[var(--fd-amber-text)]">Status note: {robot.statusReason}</div>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Allocated capital" value={money(robot.allocatedCents)} hex={hex} sub={`Max ${money(robot.maxPositionCents)} per position`} />
        <Metric label="Current exposure" value={money(exposure)} sub={robot.allocatedCents > 0 ? `${pct((exposure / robot.allocatedCents) * 100, 0)} of allocation` : "—"} hex={T.amber} />
        <Metric label="Today's P&L" value={money(todayNetCents, { sign: true })} tone={toneOf(todayNetCents)} sub="Realized, from the ledger" hex={T.purple} />
        <Metric label="Total P&L" value={money(totalPnl, { sign: true })} tone={toneOf(totalPnl)} sub="30-day realized + open marks" hex={T.green} />
        <Metric label="Winning days" value={perf.up + perf.down > 0 ? pct((perf.up / (perf.up + perf.down)) * 100, 0) : "—"} sub={`${perf.up} up · ${perf.down} down (30d)`} hex={T.blue} />
        <Metric label="Open positions" value={`${positions.length} / ${robot.maxOpenPositions}`} hex={T.cyan} sub={unrealizedCents != null ? `${money(unrealizedCents, { sign: true })} unrealized` : "No marks"} />
        <Metric label="Total decisions" value={traces.length} hex={T.purple} sub={`${traces.filter((t) => t.decision === "TRADE").length} trades`} />
        <Metric label="Execution success" value={execRate != null ? pct(execRate, 0) : "—"} hex={T.green} sub={orders.length ? `${filled} of ${orders.length} recent orders filled` : "No orders yet"} />
      </div>

      <Tabs label="Robot sections" tabs={TABS.map((t) => ({ ...t, count: t.id === "positions" ? positions.length : t.id === "decisions" ? traces.length : undefined }))} value={tab} onChange={setTab} />

      {tab === "dashboard" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-5">
            <Panel title="Realized P&L" subtitle="Cumulative ledger flow of this robot's orders (30 days, UTC)">
              <AreaChart data={perf.flow.map((f) => ({ x: f.day.slice(5), y: f.cumCents / 100 }))} hex={hex} height={260} format={(v) => `$${v.toFixed(0)}`} emptyTitle="No realized P&L yet" emptyBody="The curve starts with this robot's first fill." />
            </Panel>
            <Panel title="Recent decisions" action={<button className="text-[14px] font-semibold text-[var(--fd-blue-text)] hover:underline" onClick={() => setTab("decisions")}>View journal</button>}>
              {journalList(traces.slice(0, 5), false)}
            </Panel>
            <Panel title="Current positions" pad={false}>{positionsTable}</Panel>
          </div>
          <div className="flex flex-col gap-5">
            <GatePanel gate={gate} />
            <Panel title="Risk status">
              <div className="flex flex-col gap-4">
                <Usage label="Capital in use" value={exposure} max={robot.allocatedCents} detail={`${money(exposure)} of ${money(robot.allocatedCents)}`} />
                <Usage label="Daily loss" value={todayLoss} max={dailyBudget} detail={`${money(todayLoss)} of ${money(dailyBudget)} (${robot.dailyLossStopPct}%)`} />
                <Usage label="Drawdown" value={perf.dd} max={ddBudget} detail={`${money(perf.dd)} of ${money(ddBudget)} (${robot.drawdownStopPct}%)`} />
              </div>
            </Panel>
            <Panel title="Strategy">
              <KV k="Family" v={FAMILY_LABEL[robot.family] ?? robot.family} />
              <KV k="Active version" v={`v${robot.activeVersion}`} mono />
              {activeVersion && <KV k="Entry rule" v={activeVersion.config.entryRule} mono />}
              {activeVersion && <KV k="Min edge" v={`${activeVersion.config.minEdgePts} pts`} mono />}
              <KV k="Execution" v={robot.status === "STOPPED" ? "Stopped" : canPause ? "Eligible to cycle" : "Paused"} />
            </Panel>
          </div>
        </div>
      )}

      {tab === "performance" && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Metric label="This week" value={money(perf.week, { sign: true })} tone={toneOf(perf.week)} />
            <Metric label="Last 30 days" value={money(perf.month, { sign: true })} tone={toneOf(perf.month)} />
            <Metric label="Avg. trading day" value={perf.avgDay != null ? money(Math.round(perf.avgDay), { sign: true }) : "—"} tone={toneOf(perf.avgDay)} />
            <Metric label="Profit factor" value={perf.profitFactor != null ? perf.profitFactor.toFixed(2) : "—"} sub={perf.profitFactor == null ? "Needs a losing day" : undefined} />
            <Metric label="Max drawdown" value={perf.dd > 0 ? money(-perf.dd) : "None"} tone={perf.dd > 0 ? "loss" : "flat"} sub="Realized, peak to trough" />
            <Metric label="Sharpe ratio" value={perf.sharpe != null ? perf.sharpe.toFixed(2) : "—"} sub={perf.sharpe == null ? "Needs ≥10 trading days" : "Annualized"} />
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel title="Equity curve" subtitle="Cumulative realized P&L">
              <AreaChart data={perf.flow.map((f) => ({ x: f.day.slice(5), y: f.cumCents / 100 }))} hex={hex} height={260} format={(v) => `$${v.toFixed(0)}`} />
            </Panel>
            <Panel title="Daily P&L" subtitle="Net realized flow per UTC day">
              {perf.flow.length === 0 ? <EmptyState compact title="No daily P&L yet" /> : (
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={perf.flow.map((f) => ({ day: f.day.slice(5), y: f.netCents / 100 }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--fd-line)" vertical={false} />
                      <XAxis dataKey="day" tick={{ fill: T.text3, fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis tick={{ fill: T.text3, fontSize: 12 }} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => `$${v}`} />
                      <Tooltip contentStyle={{ background: T.elevated, border: `1px solid ${T.borderStrong}`, borderRadius: 12, color: T.text }} formatter={(v: number) => [`$${v.toFixed(2)}`, "P&L"]} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      <RBar dataKey="y" radius={[5, 5, 0, 0]} isAnimationActive={false}>
                        {perf.flow.map((f) => <Cell key={f.day} fill={f.netCents >= 0 ? T.green : T.red} />)}
                      </RBar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {tab === "positions" && <Panel title="Open positions" subtitle="Marked at each venue's last synced price" pad={false}>{positionsTable}</Panel>}
      {tab === "orders" && <Panel title="Orders" subtitle="Latest 15 orders" pad={false}>{ordersTable}</Panel>}
      {tab === "decisions" && <Panel title="Decision journal" subtitle="Every evaluation, newest first. Expand one for its model provenance and risk checks.">{journalList(traces, true)}</Panel>}

      {tab === "strategy" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Panel title="Active configuration" action={<button className={btn.small} onClick={onEditStrategy}><Pencil size={14} /> Edit in Strategy Library</button>}>
            {!activeVersion ? <EmptyState compact title="Configuration unavailable" /> : (
              <>
                <KV k="Version" v={`v${activeVersion.version}`} mono />
                <KV k="Entry rule" v={activeVersion.config.entryRule} mono />
                <KV k="Minimum edge" v={`${activeVersion.config.minEdgePts} pts`} mono />
                <KV k="Estimator" v={activeVersion.config.estimator} mono />
                <KV k="Estimator tilt" v={`${activeVersion.config.estimatorTiltPct}%`} mono />
                <KV k="Exit when edge below" v={`${activeVersion.config.exitEdgePts} pts`} mono />
                <KV k="Max hold" v={`${activeVersion.config.holdTicksMax} ticks`} mono />
                <KV k="Exit policy" v={activeVersion.config.exitPolicy} mono />
                <KV k="Schedule" v={activeVersion.config.schedule} mono />
              </>
            )}
          </Panel>
          <Panel title="Version history" subtitle="Every change creates a new immutable version" pad={false}>
            {!versions || versions.length === 0 ? <EmptyState compact title="No versions" /> : (
              <TableWrap minWidth={420}>
                <thead><tr><th className={th}>Version</th><th className={th}>Created</th><th className={`${th} text-right`}>Orders</th><th className={th}>Status</th></tr></thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id} className={trow}>
                      <td className={`${td} fd-num font-semibold`}>v{v.version}</td>
                      <td className={`${td} text-[var(--fd-text-soft)]`}>{ago(v.createdAt)}</td>
                      <td className={`${td} fd-num text-right`}>{v.orderCount}</td>
                      <td className={td}>{v.isActive ? <Badge tone="green" dot>Active</Badge> : <Badge>Inactive</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>
        </div>
      )}

      {tab === "ai" && (
        <Panel title="AI intelligence" subtitle="Model estimates and their provenance, kept separate from the deterministic risk checks that decide whether to trade">
          {aiTraces.length === 0 ? (
            <EmptyState compact title="No model estimates yet" body="Estimates appear when this robot evaluates markets." />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-[13.5px] text-[var(--fd-text2)]">Estimates are probabilities, not guarantees.</p>
              {aiTraces.slice(0, 30).map((t) => (
                <div key={t.id} className="rounded-xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge tone="purple">Model estimate</Badge>
                    <span className="fd-num text-[18px] font-semibold text-[var(--fd-purple-text)]">{t.modelEstimatePct?.toFixed(1)}%</span>
                    <span className="text-[14px] text-[var(--fd-text2)]">vs. market <span className="fd-num text-[var(--fd-strong)]">{t.marketPriceCents}¢</span></span>
                    <span className={`fd-num text-[14px] font-semibold ${(t.edgeNetPct ?? 0) > 0 ? "text-[var(--fd-green-text)]" : "text-[var(--fd-text2)]"}`}>edge {t.edgeNetPct != null ? `${t.edgeNetPct > 0 ? "+" : ""}${t.edgeNetPct.toFixed(1)}` : "—"} pts</span>
                    <span className="fd-num ml-auto text-[12.5px] text-[var(--fd-text3)]">{t.modelKey ?? "baseline"} · {ago(t.createdAt)}</span>
                  </div>
                  <div className="mt-2 truncate text-[14px] text-[var(--fd-text-soft)]">{t.market?.question}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {tab === "risk" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Panel title="Limits & usage">
            <div className="flex flex-col gap-5">
              <Usage label="Capital utilization" value={exposure} max={robot.allocatedCents} detail={`${money(exposure)} in positions of ${money(robot.allocatedCents)} allocated`} />
              <Usage label="Open positions" value={positions.length} max={robot.maxOpenPositions} detail={`${positions.length} of ${robot.maxOpenPositions} allowed`} />
              <Usage label="Daily loss" value={todayLoss} max={dailyBudget} detail={`${money(todayLoss)} lost today · stop at ${robot.dailyLossStopPct}% (${money(dailyBudget)})`} />
              <Usage label="Drawdown" value={perf.dd} max={ddBudget} detail={`${money(perf.dd)} realized drawdown · stop at ${robot.drawdownStopPct}% (${money(ddBudget)})`} />
            </div>
          </Panel>
          <div className="flex flex-col gap-5">
            <GatePanel gate={gate} />
            <Panel title="Warnings">
              {robot.status === "PAUSED_BY_RISK" || robot.statusReason || positions.length >= robot.maxOpenPositions ? (
                <ul className="flex flex-col gap-2 text-[14px] text-[var(--fd-text-soft)]">
                  {robot.status === "PAUSED_BY_RISK" && <li className="flex gap-2"><Badge tone="red">Critical</Badge> Paused by the risk engine. Review before resuming.</li>}
                  {robot.statusReason && <li className="flex gap-2"><Badge tone="amber">Note</Badge> {robot.statusReason}</li>}
                  {positions.length >= robot.maxOpenPositions && <li className="flex gap-2"><Badge tone="amber">Limit</Badge> At the maximum number of open positions; new entries are refused.</li>}
                </ul>
              ) : (
                <div className="flex items-center gap-2 text-[14px] text-[var(--fd-green-soft-text)]"><CheckCircle2 size={18} className="text-[var(--fd-green-text)]" /> No risk warnings for this robot.</div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {tab === "logs" && (
        <Panel title="Execution log" subtitle="Order attempts with their outcome and reason" pad={false}>
          {orders.length === 0 ? <EmptyState compact title="No execution attempts yet" /> : (
            <TableWrap minWidth={820}>
              <thead><tr><th className={th}>Time (UTC)</th><th className={th}>Order id</th><th className={th}>Outcome</th><th className={`${th} text-right`}>Requested</th><th className={`${th} text-right`}>Filled</th><th className={th}>Reason / response</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className={trow}>
                    <td className={`${td} fd-num whitespace-nowrap text-[var(--fd-text-soft)]`}>{new Date(o.createdAt).toISOString().replace("T", " ").slice(0, 19)}</td>
                    <td className={`${td} fd-num text-[var(--fd-text-soft)]`}>{o.id.slice(-10)}</td>
                    <td className={td}>{o.state === "FILLED" ? <Badge tone="green">Accepted</Badge> : o.state === "REJECTED" ? <Badge tone="red">Rejected</Badge> : o.state === "UNKNOWN" || o.state === "RECONCILING" ? <Badge tone="amber">Unresolved</Badge> : orderStateBadge(o.state)}</td>
                    <td className={`${td} fd-num text-right`}>{money(o.sizeCents)} @ {o.priceCents}¢</td>
                    <td className={`${td} fd-num text-right`}>{money(o.filledCents)}</td>
                    <td className={`${td} max-w-[360px] text-[var(--fd-text2)]`}>{o.stateReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <div className="border-t border-[var(--fd-line)] px-5 py-3 text-[13px] text-[var(--fd-text3)]">Latest 15 orders. Unresolved orders are reconciled automatically on the next cycle, or from Trading › Execution Monitor.</div>
        </Panel>
      )}

      {tab === "settings" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Panel title="Configuration">
            <KV k="Venue" v={<VenueTag venue={robot.venue} />} />
            <KV k="Strategy family" v={FAMILY_LABEL[robot.family] ?? robot.family} />
            <KV k="Mode" v={robot.paperMode ? "Paper" : robot.mode} />
            <KV k="Allocation" v={money(robot.allocatedCents)} mono />
            <KV k="Max per position" v={money(robot.maxPositionCents)} mono />
            <KV k="Max open positions" v={robot.maxOpenPositions} mono />
            <KV k="Daily loss stop" v={`${robot.dailyLossStopPct}%`} mono />
            <KV k="Drawdown stop" v={`${robot.drawdownStopPct}%`} mono />
            <KV k="Created" v={new Date(robot.createdAt).toUTCString().replace(" GMT", " UTC")} />
            <p className="mt-3 text-[13px] text-[var(--fd-text3)]">Capital and stop limits are fixed when a robot is created. Strategy parameters change through new versions in the Strategy Library.</p>
          </Panel>
          <Panel title="Controls">
            <div className="flex flex-col gap-3">
              <button className={btn.secondary} onClick={() => onCycleRobot(robot.id, robot.name)} disabled={busy !== null || !canPause}><RotateCw size={16} /> Run one cycle now</button>
              {canPause && <button className={btn.secondary} onClick={() => onRobotStatus(robot.id, "PAUSED_BY_USER", robot.name)} disabled={busy !== null}><Pause size={16} /> Pause robot</button>}
              {canResume && <button className={btn.primary} onClick={() => onRobotStatus(robot.id, "PAPER_ONLY", robot.name)} disabled={busy !== null}><Play size={16} /> Resume in paper mode</button>}
              <button className={btn.secondary} disabled title="Live activation stays locked until every gate passes and consent is recorded"><Lock size={16} /> Go live: locked</button>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function GatePanel({ gate }: { gate: RobotDetailDTO["gate"] }) {
  const passed = gate?.checks.filter((c) => c.passed).length ?? 0;
  return (
    <Panel title="Path to live trading" action={<span className="fd-num text-[14px] text-[var(--fd-text2)]">{gate ? `${passed}/${gate.checks.length}` : "—"}</span>}>
      {!gate ? (
        <p className="text-[14px] text-[var(--fd-text2)]">Edge gate report unavailable.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {gate.checks.map((ck) => (
            <li key={ck.check} className="flex items-start gap-3">
              {ck.passed ? <CheckCircle2 size={19} className="mt-0.5 shrink-0 text-[var(--fd-green-text)]" /> : <XCircle size={19} className="mt-0.5 shrink-0 text-[var(--fd-text3)]" />}
              <div className="min-w-0">
                <div className="text-[14.5px] font-medium text-[var(--fd-strong)]">{GATE_LABEL[ck.check] ?? ck.check.replace(/_/g, " ").toLowerCase()}</div>
                <div className="text-[13px] leading-snug text-[var(--fd-text2)]">{ck.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button className={`${btn.secondary} mt-4 w-full`} disabled title="Live activation is refused until every gate passes plus the execution gates">
        <Lock size={15} /> {gate?.ready ? "Edge gates pass: execution gates still apply" : "Go live: locked"}
      </button>
    </Panel>
  );
}

function Usage({ label, value, max, detail }: { label: string; value: number; max: number; detail: ReactNode }) {
  const p = max > 0 ? (value / max) * 100 : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[14px]"><span className="text-[var(--fd-text-soft)]">{label}</span><span className="fd-num font-semibold text-[var(--fd-strong)]">{pct(p, 0)}</span></div>
      <Bar value={value} max={max || 1} warnAt={80} label={label} />
      <div className="mt-1.5 text-[12.5px] text-[var(--fd-text3)]">{detail}</div>
    </div>
  );
}

function JournalItem({ t, withDetail }: { t: RobotDetailDTO["traces"][number]; withDetail: boolean }) {
  const [open, setOpen] = useState(false);
  const checks = (() => { try { return JSON.parse(t.riskChecks) as Array<{ passed: boolean }>; } catch { return []; } })();
  const passed = checks.filter((c) => c.passed).length;
  return (
    <li className="rounded-xl border border-[var(--fd-border)] bg-[var(--fd-bg2)]">
      <button className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left" onClick={() => withDetail && setOpen((o) => !o)} aria-expanded={withDetail ? open : undefined}>
        <span className="fd-num w-[74px] shrink-0 text-[12.5px] text-[var(--fd-text3)]">{new Date(t.createdAt).toISOString().slice(11, 19)}</span>
        {decisionBadge(t.decision)}
        <span className="min-w-[160px] flex-1 truncate text-[14.5px] font-medium text-[var(--fd-strong)]">{t.market?.question ?? "—"}</span>
        {t.modelEstimatePct != null && <span className="fd-num text-[13px] text-[var(--fd-purple-text)]">conf. {t.modelEstimatePct.toFixed(0)}%</span>}
        {checks.length > 0 && <span className={`text-[13px] ${passed === checks.length ? "text-[var(--fd-green-text)]" : "text-[var(--fd-amber-text)]"}`}>{passed}/{checks.length} checks</span>}
      </button>
      <div className="px-4 pb-3 text-[13.5px] leading-relaxed text-[var(--fd-text2)]">{t.reason}</div>
      {open && <div className="px-4 pb-4"><TraceDetail t={t} /></div>}
    </li>
  );
}

