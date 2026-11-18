"use client";

// FAIDA Predict — Analytics: performance intelligence computed only from the
// paper ledger, orders and open positions. Nothing is estimated or padded:
// metrics that need more history than exists say so instead of showing a
// number. P&L per venue / robot = realized ledger flow of its orders plus the
// current mark of its open positions (cost + unrealized).

import { useMemo, useState } from "react";
import { Bar as RBar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import type { DashboardDTO, LedgerRowDTO, OrderRowDTO } from "./types";
import { FAMILY_LABEL } from "./types";
import { VENUES, venueColor } from "@/lib/venues";
import { AreaChart, Donut, EmptyState, LegendRow, Metric, money, PageHeader, PageSkeleton, Panel, pct, Segmented, T, TableWrap, td, th, toneOf, toneText, trow, VenueTag } from "./ds";

const RANGES = [
  { id: "1D", label: "Today", days: 1 },
  { id: "7D", label: "7 Days", days: 7 },
  { id: "30D", label: "30 Days", days: 30 },
  { id: "90D", label: "90 Days", days: 90 },
  { id: "1Y", label: "1 Year", days: 365 },
  { id: "ALL", label: "All Time", days: Infinity },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

export function useAnalytics(dash: DashboardDTO | null, ledgerAll: LedgerRowDTO[], ordersAll: OrderRowDTO[], range: RangeId) {
  return useMemo(() => {
    const r = RANGES.find((x) => x.id === range)!;
    const start = r.days === Infinity ? 0 : (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime() - (r.days - 1) * 86400000; })();
    const ledgerAsc = [...ledgerAll].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const deposits = ledgerAsc.filter((l) => l.type === "DEPOSIT" || l.type === "WITHDRAWAL").reduce((a, l) => a + l.amountCents, 0);
    const trading = ledgerAsc.filter((l) => l.type !== "DEPOSIT" && l.type !== "WITHDRAWAL");
    const inRange = trading.filter((l) => new Date(l.createdAt).getTime() >= start);

    // equity curve (cash balance after each ledger entry)
    const equity = ledgerAsc
      .filter((l) => new Date(l.createdAt).getTime() >= start || r.days === Infinity)
      .map((l) => ({ x: new Date(l.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }), y: l.balanceAfterCents / 100 }));

    // daily P&L buckets (UTC)
    const byDay = new Map<string, number>();
    for (const l of inRange) {
      const k = l.createdAt.slice(0, 10);
      byDay.set(k, (byDay.get(k) ?? 0) + l.amountCents);
    }
    const daily = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({ day: day.slice(5), v }));
    const winDays = daily.filter((d) => d.v > 0).length;
    const lossDays = daily.filter((d) => d.v < 0).length;
    const gains = daily.filter((d) => d.v > 0).reduce((a, d) => a + d.v, 0);
    const losses = -daily.filter((d) => d.v < 0).reduce((a, d) => a + d.v, 0);
    const profitFactor = losses > 0 ? gains / losses : null;

    // drawdown on the cash curve
    let peak = -Infinity;
    let maxDd = 0;
    for (const l of ledgerAsc) {
      if (new Date(l.createdAt).getTime() < start && r.days !== Infinity) continue;
      peak = Math.max(peak, l.balanceAfterCents);
      if (peak > 0) maxDd = Math.max(maxDd, (peak - l.balanceAfterCents) / peak);
    }

    // Sharpe only with ≥10 days of daily returns
    let sharpe: number | null = null;
    if (daily.length >= 10 && deposits > 0) {
      const rets = daily.map((d) => d.v / deposits);
      const mean = rets.reduce((a, x) => a + x, 0) / rets.length;
      const sd = Math.sqrt(rets.reduce((a, x) => a + (x - mean) ** 2, 0) / (rets.length - 1));
      sharpe = sd > 0 ? (mean / sd) * Math.sqrt(365) : null;
    }

    const openPositions = dash?.positions ?? [];
    const unrealized = openPositions.reduce((a, p) => a + (p.unrealizedCents ?? 0), 0);
    const openCost = openPositions.reduce((a, p) => a + p.sizeCents, 0);
    const balance = dash?.balanceCents ?? (ledgerAsc.at(-1)?.balanceAfterCents ?? 0);
    const netPnl = balance + openCost + unrealized - deposits;
    const periodFlow = inRange.reduce((a, l) => a + l.amountCents, 0);
    const totalReturnPct = deposits > 0 ? (netPnl / deposits) * 100 : null;

    // attribution: ledger flow by order → venue / robot, plus open marks
    const orderById = new Map(ordersAll.map((o) => [o.id, o]));
    const venueFlow = new Map<string, number>();
    const robotFlow = new Map<string, number>();
    for (const l of inRange) {
      const o = l.refId ? orderById.get(l.refId) : undefined;
      if (!o) continue;
      const v = o.market?.venue ?? "?";
      venueFlow.set(v, (venueFlow.get(v) ?? 0) + l.amountCents);
      const rn = o.robot?.name ?? "Manual";
      robotFlow.set(rn, (robotFlow.get(rn) ?? 0) + l.amountCents);
    }
    const venueMark = new Map<string, number>();
    const robotMark = new Map<string, number>();
    for (const p of openPositions) {
      const mark = p.sizeCents + (p.unrealizedCents ?? 0);
      const v = p.market?.venue ?? "?";
      venueMark.set(v, (venueMark.get(v) ?? 0) + mark);
      const rn = p.robot?.name ?? "Manual";
      robotMark.set(rn, (robotMark.get(rn) ?? 0) + mark);
    }
    const venues = VENUES.map((v) => ({
      id: v.id,
      label: v.label,
      hex: v.hex,
      pnl: venueFlow.has(v.id) || venueMark.has(v.id) ? (venueFlow.get(v.id) ?? 0) + (venueMark.get(v.id) ?? 0) : null,
      exposure: dash?.venues.find((s) => s.venue === v.id)?.exposureCents ?? 0,
      orders: ordersAll.filter((o) => o.market?.venue === v.id && new Date(o.createdAt).getTime() >= start).length,
    }));
    const robotNames = new Set([...(dash?.robots.map((r) => r.name) ?? []), ...robotFlow.keys()]);
    const robots = [...robotNames].map((name) => {
      const def = dash?.robots.find((r) => r.name === name);
      const has = robotFlow.has(name) || robotMark.has(name);
      return {
        name,
        id: def?.id,
        venue: def?.venue,
        family: def?.family,
        allocated: def?.allocatedCents ?? 0,
        pnl: has ? (robotFlow.get(name) ?? 0) + (robotMark.get(name) ?? 0) : null,
        orders: ordersAll.filter((o) => (o.robot?.name ?? "Manual") === name && new Date(o.createdAt).getTime() >= start).length,
      };
    });
    const strategies = new Map<string, number>();
    for (const rb of robots) if (rb.pnl != null && rb.family) strategies.set(rb.family, (strategies.get(rb.family) ?? 0) + rb.pnl);

    const filled = ordersAll.filter((o) => o.state === "FILLED" && new Date(o.createdAt).getTime() >= start);
    const rejected = ordersAll.filter((o) => o.state === "REJECTED" && new Date(o.createdAt).getTime() >= start);
    return {
      deposits, balance, netPnl, periodFlow, totalReturnPct, unrealized, openCost, maxDdPct: maxDd * 100,
      sharpe, profitFactor, winDays, lossDays, daily, equity, venues, robots, strategies, filled, rejected, tradingEntries: inRange.length,
    };
  }, [dash, ledgerAll, ordersAll, range]);
}

export function AnalyticsView({ dash, ordersData, onOpenRobot, onOpenVenue }: {
  dash: DashboardDTO | null;
  ordersData: { orders: OrderRowDTO[]; ledger: LedgerRowDTO[] } | null;
  onOpenRobot: (id: string) => void;
  onOpenVenue: (id: string) => void;
}) {
  const [range, setRange] = useState<RangeId>("ALL");
  const a = useAnalytics(dash, ordersData?.ledger ?? [], ordersData?.orders ?? [], range);
  if (!dash || !ordersData) return <PageSkeleton />;

  const ranked = [...a.robots].filter((r) => r.pnl != null).sort((x, y) => (y.pnl ?? 0) - (x.pnl ?? 0));
  const bestVenue = [...a.venues].filter((v) => v.pnl != null).sort((x, y) => (y.pnl ?? 0) - (x.pnl ?? 0))[0];
  const bestStrategy = [...a.strategies.entries()].sort((x, y) => y[1] - x[1])[0];
  const alloc = dash.robots.filter((r) => r.allocatedCents > 0).map((r) => ({ label: r.name, value: r.allocatedCents, hex: venueColor(r.venue) }));
  const noActivity = a.tradingEntries === 0 && a.filled.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<BarChart3 size={24} />}
        title="Analytics"
        subtitle="Performance computed from your paper ledger, orders and open positions"
        actions={<Segmented label="Time range" options={RANGES.map((r) => ({ id: r.id, label: r.label }))} value={range} onChange={setRange} />}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Total return" value={pct(a.totalReturnPct, 2, true)} tone={toneOf(a.totalReturnPct)} sub="vs. deposits, all time" hex={T.green} />
        <Metric label="Net P&L" value={money(a.netPnl, { sign: true })} tone={toneOf(a.netPnl)} sub="Realized + open marks" hex={T.cyan} />
        <Metric label="Winning days" value={a.winDays + a.lossDays > 0 ? pct((a.winDays / (a.winDays + a.lossDays)) * 100, 0) : "—"} sub={`${a.winDays} up · ${a.lossDays} down`} hex={T.blue} />
        <Metric label="Profit factor" value={a.profitFactor != null ? a.profitFactor.toFixed(2) : "—"} sub={a.profitFactor == null ? "Needs a losing day" : "Gains ÷ losses"} hex={T.purple} />
        <Metric label="Max drawdown" value={a.maxDdPct > 0 ? `-${a.maxDdPct.toFixed(2)}%` : "0.00%"} tone={a.maxDdPct > 0 ? "loss" : "flat"} sub="Peak-to-trough, cash" hex={T.red} />
        <Metric label="Sharpe ratio" value={a.sharpe != null ? a.sharpe.toFixed(2) : "—"} sub={a.sharpe == null ? "Needs ≥10 trading days" : "Annualized, daily"} hex={T.amber} />
      </div>

      {noActivity && (
        <Panel>
          <EmptyState icon={<BarChart3 size={22} />} title="No trading activity in this range" body="Analytics fill in as robots and manual orders trade. Start a robot cycle or place a paper order." />
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Portfolio equity" subtitle="Cash balance after every ledger entry">
          <AreaChart data={a.equity} height={300} format={(v) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} emptyTitle="No balance history yet" emptyBody="The curve starts with your first trade." />
        </Panel>
        <Panel title="Capital allocation" subtitle="Allocated to each robot">
          <div className="flex flex-col items-center gap-4">
            <Donut segments={alloc} center={<div><div className="fd-num text-[20px] font-bold text-white">{money(dash.allocatedCents, { compact: true })}</div><div className="text-[12px] text-[#7C889B]">allocated</div></div>} />
            <div className="w-full">{alloc.map((s) => <LegendRow key={s.label} hex={s.hex} label={s.label} value={money(s.value, { compact: true })} sub={pct((s.value / Math.max(1, dash.allocatedCents)) * 100, 0)} />)}</div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Daily P&L" subtitle="Net ledger flow per UTC day">
          {a.daily.length === 0 ? (
            <EmptyState compact title="No daily P&L in this range" />
          ) : (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a.daily.map((d) => ({ ...d, y: d.v / 100 }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#1A2333" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: T.text3, fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: T.text3, fontSize: 12 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `$${v}`} />
                  <Tooltip contentStyle={{ background: T.elevated, border: `1px solid ${T.borderStrong}`, borderRadius: 12, color: T.text }} formatter={(v: number) => [`$${v.toFixed(2)}`, "P&L"]} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                  <RBar dataKey="y" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                    {a.daily.map((d) => <Cell key={d.day} fill={d.v >= 0 ? T.green : T.red} />)}
                  </RBar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
        <Panel title="Venue performance" subtitle="Realized flow + open marks per venue">
          <div className="flex flex-col gap-3">
            {a.venues.map((v) => {
              const max = Math.max(1, ...a.venues.map((x) => Math.abs(x.pnl ?? 0)));
              return (
                <button key={v.id} onClick={() => onOpenVenue(v.id)} className="grid grid-cols-[120px_1fr_100px] items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-white/[0.03]">
                  <span className="flex items-center gap-2 text-[14px] text-[#C9D2DE]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: v.hex }} />{v.label}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
                    <span className="block h-full rounded-full" style={{ width: `${(Math.abs(v.pnl ?? 0) / max) * 100}%`, background: (v.pnl ?? 0) >= 0 ? v.hex : T.red }} />
                  </span>
                  <span className={`fd-num text-right text-[14px] font-semibold ${toneText[toneOf(v.pnl)]}`}>{v.pnl != null ? money(v.pnl, { sign: true }) : "—"}</span>
                </button>
              );
            })}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Highlight title="Best robot" value={ranked[0]?.name ?? "—"} detail={ranked[0]?.pnl != null ? money(ranked[0].pnl, { sign: true }) : "No P&L yet"} tone={toneOf(ranked[0]?.pnl)} icon={<TrendingUp size={18} />} />
        <Highlight title="Worst robot" value={ranked.length > 1 ? ranked.at(-1)!.name : "—"} detail={ranked.length > 1 && ranked.at(-1)!.pnl != null ? money(ranked.at(-1)!.pnl!, { sign: true }) : "Needs two robots with P&L"} tone={ranked.length > 1 ? toneOf(ranked.at(-1)!.pnl) : "flat"} icon={<TrendingDown size={18} />} />
        <Highlight title="Best venue / strategy" value={`${bestVenue?.label ?? "—"} · ${bestStrategy ? FAMILY_LABEL[bestStrategy[0]] ?? bestStrategy[0] : "—"}`} detail={bestVenue?.pnl != null ? money(bestVenue.pnl, { sign: true }) : "No P&L yet"} tone={toneOf(bestVenue?.pnl)} icon={<BarChart3 size={18} />} />
      </div>

      <Panel title="Robot performance" pad={false}>
        <TableWrap minWidth={760}>
          <thead><tr><th className={th}>Robot</th><th className={th}>Venue</th><th className={th}>Strategy</th><th className={`${th} text-right`}>Allocated</th><th className={`${th} text-right`}>Orders</th><th className={`${th} text-right`}>P&L</th></tr></thead>
          <tbody>
            {a.robots.map((r) => (
              <tr key={r.name} className={`${trow} ${r.id ? "cursor-pointer" : ""}`} onClick={() => r.id && onOpenRobot(r.id)}>
                <td className={`${td} font-semibold`}>{r.name}</td>
                <td className={td}>{r.venue ? <VenueTag venue={r.venue} /> : <span className="text-[#7C889B]">—</span>}</td>
                <td className={`${td} text-[#C9D2DE]`}>{r.family ? FAMILY_LABEL[r.family] ?? r.family : "Manual orders"}</td>
                <td className={`${td} fd-num text-right`}>{money(r.allocated)}</td>
                <td className={`${td} fd-num text-right`}>{r.orders}</td>
                <td className={`${td} fd-num text-right font-semibold ${toneText[toneOf(r.pnl)]}`}>{r.pnl != null ? money(r.pnl, { sign: true }) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <div className="flex flex-wrap gap-6 border-t border-[#1A2333] px-5 py-4 text-[14px] text-[#9AA6B8]">
          <span>Filled orders <span className="fd-num font-semibold text-white">{a.filled.length}</span></span>
          <span>Rejected orders <span className="fd-num font-semibold text-white">{a.rejected.length}</span></span>
          <span>Open position marks <span className={`fd-num font-semibold ${toneText[toneOf(a.unrealized)]}`}>{money(a.unrealized, { sign: true })}</span></span>
        </div>
      </Panel>
    </div>
  );
}

function Highlight({ title, value, detail, tone, icon }: { title: string; value: string; detail: string; tone: "gain" | "loss" | "flat"; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#1E2A3D] bg-[#111827] p-5">
      <div className="flex items-center gap-2 text-[13.5px] text-[#9AA6B8]"><span className="text-[#2583FF]">{icon}</span>{title}</div>
      <div className="mt-2 truncate text-[18px] font-semibold text-white">{value}</div>
      <div className={`fd-num mt-1 text-[14px] ${toneText[tone]}`}>{detail}</div>
    </div>
  );
}
