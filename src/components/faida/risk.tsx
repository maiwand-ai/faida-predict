"use client";

// FAIDA Predict — Risk Center. A read-only view over the existing risk
// engine, control plane and live-trading gates: exposure by venue / robot /
// event, daily-loss and drawdown usage against the configured limits, alerts,
// safety-gate status, system health and the risk event history. It never
// changes a limit or a calculation; editing limits stays in Settings, which
// goes through the clamped PUT /api/risk path.

import { type ReactNode } from "react";
import { Activity, AlertTriangle, CheckCircle2, Gauge, PauseCircle, ShieldCheck, XCircle } from "lucide-react";
import type { DashboardDTO, LedgerRowDTO, OrderRowDTO, ProbabilityDTO, RiskViewDTO } from "./types";
import { VENUES, venueColor } from "@/lib/venues";
import { ago, Badge, Bar, btn, Donut, EmptyState, KV, LegendRow, Metric, money, PageHeader, PageSkeleton, Panel, pct, T, Tabs, TableWrap, td, th, trow, VenueTag } from "./ds";
import { MODE_META, type Nav, type OperatingMode } from "./shell";

type LiveDTO = {
  armSwitch: string;
  pilot: { enabled: boolean; maxOrderCents?: number; maxTotalNotionalCents?: number };
  consent: { consented: boolean; recordedAt?: string | null };
  custody?: { signerPresent: boolean };
  b3?: { signedOff?: boolean } | null;
  gates?: Array<{ robotId: string; robotName: string; ready: boolean; armed: boolean; dryRun: boolean; edge?: { ready?: boolean }; exec?: { ready?: boolean } }>;
} | null;

export function RiskCenter(props: {
  dash: DashboardDTO | null;
  riskView: RiskViewDTO | null;
  probability: ProbabilityDTO | null;
  ordersData: { orders: OrderRowDTO[]; ledger: LedgerRowDTO[] } | null;
  live: LiveDTO;
  mode: OperatingMode;
  tab: string;
  onTab: (t: string) => void;
  busy: string | null;
  onControl: (body: Record<string, unknown>, okMsg: string) => void;
  onOpenRobot: (id: string) => void;
  onOpenVenue: (id: string) => void;
  onNavigate: (n: Nav) => void;
}) {
  const { dash, riskView, probability, ordersData, live, mode, tab, onTab, busy, onControl, onOpenRobot, onOpenVenue, onNavigate } = props;
  if (!dash) return <PageSkeleton />;

  const eff = riskView?.effective;
  const dailyStopPct = eff?.dailyLossStopPct ?? dash.risk.find((r) => r.key === "DAILY_LOSS_STOP_PCT")?.valueNum ?? 5;
  const ddStopPct = eff?.drawdownStopPct ?? dash.risk.find((r) => r.key === "DRAWDOWN_STOP_PCT")?.valueNum ?? 10;
  const eventPct = eff?.perEventExposurePct ?? dash.exposureLimitPct;

  const balance = dash.balanceCents;
  const exposure = dash.exposureCents;
  const allocated = dash.allocatedCents;
  const todayLoss = Math.max(0, -dash.todayFlowCents);
  const dailyBudget = Math.round((balance * dailyStopPct) / 100);
  const dailyUse = dailyBudget > 0 ? (todayLoss / dailyBudget) * 100 : 0;

  const ledger = [...(ordersData?.ledger ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const peak = ledger.reduce((m, l) => Math.max(m, l.balanceAfterCents), balance);
  const ddPct = peak > 0 ? ((peak - balance - 0) / peak) * 100 : 0;
  const ddUse = ddStopPct > 0 ? (Math.max(0, ddPct) / ddStopPct) * 100 : 0;

  // per-event (A-04 cluster) concentration
  const clusters = new Map<string, { cents: number; n: number; label: string }>();
  for (const p of dash.positions) {
    const key = p.market?.eventKey ?? `m:${p.market?.question ?? p.id}`;
    const c = clusters.get(key) ?? { cents: 0, n: 0, label: p.market?.eventKey ? `Event ${p.market.eventKey}` : p.market?.question ?? "—" };
    c.cents += p.sizeCents;
    c.n += 1;
    clusters.set(key, c);
  }
  const eventLimit = Math.round((allocated * eventPct) / 100);
  const conc = [...clusters.values()].sort((a, b) => b.cents - a.cents);
  const topConc = conc[0];

  const robotExposure = dash.robots.map((r) => {
    const ps = dash.positions.filter((p) => p.robot?.name === r.name);
    return { r, cents: ps.reduce((a, p) => a + p.sizeCents, 0), n: ps.length };
  });
  const venueSeg = VENUES.map((v) => ({ label: v.label, value: dash.venues.find((s) => s.venue === v.id)?.exposureCents ?? 0, hex: v.hex })).filter((s) => s.value > 0);

  const alerts = dash.notifications.filter((n) => n.severity === "CRITICAL" || n.severity === "WARNING");
  const riskPaused = dash.robots.filter((r) => r.status === "PAUSED_BY_RISK");
  const paused = dash.control?.pause.paused ?? false;
  const level: "Low" | "Elevated" | "High" =
    paused || dailyUse >= 80 || ddUse >= 80 || riskPaused.length > 0 || alerts.some((a) => a.severity === "CRITICAL")
      ? "High"
      : dailyUse >= 50 || ddUse >= 50 || (allocated > 0 && exposure / allocated > 0.6) || alerts.length > 0
        ? "Elevated"
        : "Low";
  const levelTone = level === "Low" ? "green" : level === "Elevated" ? "amber" : "red";

  const gates: Array<{ name: string; ok: boolean; detail: string }> = [
    { name: "Recorded consent", ok: !!live?.consent?.consented, detail: live?.consent?.consented ? `Recorded ${ago(live.consent.recordedAt ?? null)}` : "Not recorded. Required before any real order." },
    { name: "Small-capital pilot", ok: !!live?.pilot?.enabled, detail: live?.pilot?.enabled ? `Enabled · max ${money(live.pilot.maxOrderCents ?? 0)} per order` : "Disabled" },
    { name: "Signer present (self-custody)", ok: !!live?.custody?.signerPresent, detail: live?.custody?.signerPresent ? "Signing key injected at runtime, never stored" : "No signer configured" },
    { name: "Arm switch", ok: live?.armSwitch === "ARMED", detail: live?.armSwitch === "ARMED" ? "Armed: live sends permitted within ceilings" : "Safe: live sends stay dry-run" },
    { name: "Edge gate (any robot ready)", ok: (live?.gates ?? []).some((g) => g.ready) || !!probability?.edgeGate?.ready, detail: (live?.gates ?? []).length ? `${(live?.gates ?? []).filter((g) => g.ready).length} of ${(live?.gates ?? []).length} robots ready` : "No robot has passed the edge gate yet" },
  ];

  const venueHealth = VENUES.map((v) => {
    const st = dash.venues.find((s) => s.venue === v.id);
    const ageMs = st?.syncedAt ? Date.now() - new Date(st.syncedAt).getTime() : null;
    const status = v.adapter !== "LIVE" ? (v.id === "DRIFT_BET" ? "Suspended" : "Pending") : !st?.syncedAt ? "No data" : ageMs! > 6 * 3600e3 ? "Stale" : "Healthy";
    return { v, st, status, ageMs };
  });

  const auditRows = [
    ...dash.notifications.map((n) => ({ at: n.createdAt, kind: n.severity, title: n.title, body: n.body })),
    ...(ordersData?.orders ?? []).filter((o) => o.state === "REJECTED" || o.state === "UNKNOWN").map((o) => ({ at: o.createdAt, kind: o.state === "REJECTED" ? "REJECTED" : "UNKNOWN", title: `Order ${o.state.toLowerCase()}: ${o.market?.question?.slice(0, 60) ?? o.marketId}`, body: o.stateReason ?? "" })),
    ...(paused && dash.control?.pause.pausedAt ? [{ at: dash.control.pause.pausedAt, kind: "PAUSE", title: "Platform paused", body: dash.control.pause.reason ?? "" }] : []),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<ShieldCheck size={24} />}
        title="Risk Center"
        subtitle="Monitor exposure, limits and safety gates"
        badges={<Badge tone={levelTone} dot>Risk level: {level}</Badge>}
        actions={
          <>
            <button className={btn.secondary} onClick={() => onNavigate({ view: "settings", tab: "risk" })}>Edit limits</button>
            {paused ? (
              <button className={btn.secondary} onClick={() => onControl({ action: "RESUME" }, "Platform resumed")} disabled={busy !== null}>Resume platform</button>
            ) : (
              <button className={btn.danger} onClick={() => onControl({ action: "PAUSE", reason: "manual pause from Risk Center" }, "Everything paused")} disabled={busy !== null}><PauseCircle size={17} /> Pause everything</button>
            )}
          </>
        }
      />

      <Tabs label="Risk sections" value={tab} onChange={onTab} tabs={[
        { id: "overview", label: "Risk Center" },
        { id: "exposure", label: "Exposure Monitor" },
        { id: "health", label: "System Health" },
        { id: "audit", label: "Audit Log", count: auditRows.length },
      ]} />

      {tab === "overview" && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Metric label="Total exposure" value={money(exposure)} sub={allocated > 0 ? `${pct((exposure / allocated) * 100, 0)} of allocation` : "Nothing allocated"} hex={T.blue} icon={<Gauge size={16} />} />
            <Metric label="Daily loss usage" value={pct(dailyUse, 0)} tone={dailyUse >= 80 ? "loss" : "text"} sub={`${money(todayLoss)} of ${money(dailyBudget)} (${dailyStopPct}%)`} hex={T.amber} />
            <Metric label="Drawdown" value={pct(Math.max(0, ddPct), 2)} tone={ddPct > 0 ? "loss" : "flat"} sub={`Stop at ${ddStopPct}% from peak`} hex={T.red} />
            <Metric label="Capital at risk" value={money(exposure)} sub={balance > 0 ? `${pct((exposure / balance) * 100, 1)} of balance (max loss)` : "—"} hex={T.purple} />
            <Metric label="Available capital" value={money(balance)} sub="Paper cash balance" hex={T.green} />
            <Metric label="Portfolio allocation" value={balance > 0 ? pct((allocated / balance) * 100, 0) : "—"} sub={`${money(allocated)} with robots`} hex={T.cyan} />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Panel title="Exposure by venue">
              <div className="flex flex-col items-center gap-4">
                <Donut segments={venueSeg} center={<div><div className="fd-num text-[20px] font-bold text-white">{money(exposure, { compact: true })}</div><div className="text-[12px] text-[#7C889B]">open</div></div>} />
                <div className="w-full">
                  {venueSeg.length === 0 ? <p className="text-center text-[14px] text-[#9AA6B8]">No open positions.</p> : venueSeg.map((s) => <LegendRow key={s.label} hex={s.hex} label={s.label} value={money(s.value)} sub={pct((s.value / Math.max(1, exposure)) * 100, 0)} />)}
                </div>
              </div>
            </Panel>
            <Panel title="Limits">
              <div className="flex flex-col gap-5">
                <Limit label="Daily loss limit" used={dailyUse} detail={`${money(todayLoss)} lost today · limit ${money(dailyBudget)} (${dailyStopPct}% of balance)`} />
                <Limit label="Drawdown limit" used={ddUse} detail={`${pct(Math.max(0, ddPct), 2)} from peak · stop at ${ddStopPct}%`} />
                <Limit label="Largest event concentration" used={eventLimit > 0 && topConc ? (topConc.cents / eventLimit) * 100 : 0} detail={topConc ? `${money(topConc.cents)} in one event · cap ${money(eventLimit)} (${eventPct}% of allocation)` : `No open events · cap ${eventPct}% of allocation`} />
                <Limit label="AI monthly budget" used={dash.providers.reduce((a, p) => a + p.spentCents, 0) / Math.max(1, eff?.aiMonthlyBudgetCents ?? 10000) * 100} detail={`${money(dash.providers.reduce((a, p) => a + p.spentCents, 0))} of ${money(eff?.aiMonthlyBudgetCents ?? 10000)}`} />
              </div>
            </Panel>
            <Panel title="Safety gates" subtitle={MODE_META[mode].desc}>
              <ul className="flex flex-col gap-3">
                {gates.map((g) => (
                  <li key={g.name} className="flex items-start gap-3">
                    {g.ok ? <CheckCircle2 size={19} className="mt-0.5 shrink-0 text-[#00D69A]" /> : <XCircle size={19} className="mt-0.5 shrink-0 text-[#7C889B]" />}
                    <div>
                      <div className="text-[14.5px] font-medium text-white">{g.name}</div>
                      <div className="text-[13px] text-[#9AA6B8]">{g.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
              {!live && <p className="mt-4 text-[13px] text-[#7C889B]">Live-gate details are visible to operators only.</p>}
            </Panel>
          </div>

          <Panel title="Risk alerts" subtitle="Warnings and critical events">
            {alerts.length === 0 && riskPaused.length === 0 ? (
              <div className="flex items-center gap-3 rounded-xl bg-[#00D69A]/8 p-4 text-[14.5px] text-[#C9F5E6]"><CheckCircle2 size={20} className="text-[#00D69A]" /> All clear. No risk alerts right now.</div>
            ) : (
              <ul className="flex flex-col gap-2">
                {riskPaused.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#FF5268]/30 bg-[#FF5268]/8 px-4 py-3">
                    <Badge tone="red">Critical</Badge>
                    <button className="font-semibold text-white hover:underline" onClick={() => onOpenRobot(r.id)}>{r.name}</button>
                    <span className="text-[14px] text-[#C9D2DE]">paused by the risk engine{r.statusReason ? `: ${r.statusReason}` : ""}</span>
                  </li>
                ))}
                {alerts.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-[#1E2A3D] bg-[#0D121C] px-4 py-3">
                    <Badge tone={n.severity === "CRITICAL" ? "red" : "amber"}>{n.severity === "CRITICAL" ? "Critical" : "Warning"}</Badge>
                    <div className="min-w-[200px] flex-1"><div className="text-[14.5px] font-medium text-white">{n.title}</div><div className="text-[13px] text-[#9AA6B8]">{n.body}</div></div>
                    <span className="text-[12.5px] text-[#7C889B]">{ago(n.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      {tab === "exposure" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Panel title="Venue exposure" pad={false}>
            <TableWrap minWidth={520}>
              <thead><tr><th className={th}>Venue</th><th className={`${th} text-right`}>Positions</th><th className={`${th} text-right`}>Exposure</th><th className={th}>Share</th></tr></thead>
              <tbody>
                {VENUES.map((v) => {
                  const st = dash.venues.find((s) => s.venue === v.id);
                  const cents = st?.exposureCents ?? 0;
                  return (
                    <tr key={v.id} className={`${trow} cursor-pointer`} onClick={() => onOpenVenue(v.id)}>
                      <td className={td}><VenueTag venue={v.id} /></td>
                      <td className={`${td} fd-num text-right`}>{st?.openPositions ?? 0}</td>
                      <td className={`${td} fd-num text-right`}>{money(cents)}</td>
                      <td className={`${td} w-40`}><Bar value={cents} max={Math.max(1, exposure)} hex={v.hex} label={`${v.label} share`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </Panel>
          <Panel title="Robot exposure" pad={false}>
            {robotExposure.length === 0 ? <EmptyState compact title="No robots" /> : (
              <TableWrap minWidth={520}>
                <thead><tr><th className={th}>Robot</th><th className={`${th} text-right`}>Positions</th><th className={`${th} text-right`}>Exposure</th><th className={th}>Of allocation</th></tr></thead>
                <tbody>
                  {robotExposure.map(({ r, cents, n }) => (
                    <tr key={r.id} className={`${trow} cursor-pointer`} onClick={() => onOpenRobot(r.id)}>
                      <td className={`${td} font-semibold`}><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: venueColor(r.venue) }} />{r.name}</td>
                      <td className={`${td} fd-num text-right`}>{n}/{r.maxOpenPositions}</td>
                      <td className={`${td} fd-num text-right`}>{money(cents)}</td>
                      <td className={`${td} w-40`}><Bar value={cents} max={Math.max(1, r.allocatedCents)} warnAt={80} label={`${r.name} utilization`} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>
          <Panel title="Market concentration" subtitle={`Related markets in one event stack against the ${eventPct}% per-event cap`} className="xl:col-span-2" pad={false}>
            {conc.length === 0 ? <EmptyState compact title="No open positions" body="Concentration appears once positions are open." /> : (
              <TableWrap minWidth={620}>
                <thead><tr><th className={th}>Event / market</th><th className={`${th} text-right`}>Positions</th><th className={`${th} text-right`}>Exposure</th><th className={th}>Of event cap</th></tr></thead>
                <tbody>
                  {conc.map((cl) => (
                    <tr key={cl.label} className={trow}>
                      <td className={`${td} max-w-[420px] truncate`}>{cl.label}</td>
                      <td className={`${td} fd-num text-right`}>{cl.n}</td>
                      <td className={`${td} fd-num text-right`}>{money(cl.cents)}</td>
                      <td className={`${td} w-48`}><Bar value={cl.cents} max={Math.max(1, eventLimit)} warnAt={80} label="Share of event cap" /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>
        </div>
      )}

      {tab === "health" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Panel title="Venue connectivity & data freshness" icon={<Activity size={18} />} pad={false}>
            <TableWrap minWidth={520}>
              <thead><tr><th className={th}>Venue</th><th className={th}>Status</th><th className={`${th} text-right`}>Markets</th><th className={th}>Last sync</th></tr></thead>
              <tbody>
                {venueHealth.map(({ v, st, status }) => (
                  <tr key={v.id} className={trow}>
                    <td className={td}><VenueTag venue={v.id} /></td>
                    <td className={td}><Badge tone={status === "Healthy" ? "green" : status === "Stale" || status === "No data" || status === "Pending" ? "amber" : "red"} dot>{status}</Badge></td>
                    <td className={`${td} fd-num text-right`}>{st?.markets ?? 0}</td>
                    <td className={`${td} text-[#C9D2DE]`}>{st?.syncedAt ? ago(st.syncedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Panel>
          <Panel title="Platform services">
            <KV k="Operating mode" v={<Badge tone={MODE_META[mode].tone} dot>{MODE_META[mode].label}</Badge>} />
            <KV k="Risk engine" v={<Badge tone="green" dot>Enforcing at cycle and ticket time</Badge>} />
            <KV k="Autopilot" v={dash.control?.autopilot.enabled ? `On · every ${dash.control.autopilot.intervalSec}s` : "Off"} />
            <KV k="Last autopilot run" v={dash.control?.autopilot.lastRun ? `${ago(dash.control.autopilot.lastRun.at)} · ${dash.control.autopilot.lastRun.cycles} robots${dash.control.autopilot.lastRun.errors ? ` · ${dash.control.autopilot.lastRun.errors} errors` : ""}` : "Never"} />
            <KV k="Event outbox" v={dash.outboxPending === 0 ? <Badge tone="green">Drained</Badge> : <Badge tone="amber">{dash.outboxPending} pending</Badge>} />
            <KV k="Unresolved orders" v={(ordersData?.orders ?? []).filter((o) => o.state === "UNKNOWN" || o.state === "RECONCILING").length} mono />
            <KV k="AI calls (24h)" v={probability ? `${probability.governance.totals24h.calls} calls · ${probability.governance.totals24h.failed} failed · ${probability.governance.totals24h.blocked} blocked` : "—"} />
            <KV k="AI cache hit rate" v={probability ? pct(probability.governance.cache.hitRatePct, 0) : "—"} mono />
          </Panel>
        </div>
      )}

      {tab === "audit" && (
        <Panel title="Risk event history" subtitle="Notifications, rejected or unresolved orders, and platform pauses" pad={false}>
          {auditRows.length === 0 ? <EmptyState compact title="No events recorded" /> : (
            <TableWrap minWidth={760}>
              <thead><tr><th className={th}>Time (UTC)</th><th className={th}>Type</th><th className={th}>Event</th><th className={th}>Detail</th></tr></thead>
              <tbody>
                {auditRows.map((a, i) => (
                  <tr key={i} className={trow}>
                    <td className={`${td} fd-num whitespace-nowrap text-[#C9D2DE]`}>{new Date(a.at).toISOString().replace("T", " ").slice(0, 19)}</td>
                    <td className={td}><Badge tone={a.kind === "CRITICAL" || a.kind === "REJECTED" || a.kind === "PAUSE" ? "red" : a.kind === "WARNING" || a.kind === "UNKNOWN" ? "amber" : "blue"}>{a.kind.toLowerCase()}</Badge></td>
                    <td className={`${td} font-medium`}>{a.title}</td>
                    <td className={`${td} max-w-[420px] text-[#9AA6B8]`}>{a.body}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      )}
    </div>
  );
}

function Limit({ label, used, detail }: { label: string; used: number; detail: ReactNode }) {
  const tone = used >= 95 ? "text-[#FF7A8B]" : used >= 80 ? "text-[#FFC266]" : "text-white";
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[14px]">
        <span className="flex items-center gap-2 text-[#C9D2DE]">{used >= 80 && <AlertTriangle size={15} className="text-[#FFB547]" />}{label}</span>
        <span className={`fd-num font-semibold ${tone}`}>{pct(Math.min(999, used), 0)}</span>
      </div>
      <Bar value={used} max={100} warnAt={80} label={label} />
      <div className="mt-1.5 text-[12.5px] text-[#7C889B]">{detail}</div>
    </div>
  );
}
