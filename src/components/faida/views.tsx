"use client";

// FAIDA Predict — Studio (wizard + strategy lab), Trading, Settings.
import { useCallback, useEffect, useState } from "react";
import { Download, LineChart as LineChartIcon, Plus, Settings as SettingsIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge, btn, EmptyState, KV, Metric, money, orderStateBadge, PageHeader, PageSkeleton, Panel, T, Tabs, TableWrap, td, th, toneOf, toneText, trow, VenueTag } from "./ds";
import { TradeDialog } from "./markets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  type BacktestResultDTO,
  type CurvePoint,
  type DashboardDTO,
  type EligibilityRuleDTO,
  type LedgerRowDTO,
  type MarketDTO,
  type ModelRowDTO,
  type NotifyStatusDTO,
  type OrderRowDTO,
  type ProbabilityDTO,
  type ProviderDTO,
  type RiskViewDTO,
  type VersionDTO,
} from "./types";
import { card, c, fmtCents, mono } from "./ui";
import { VENUES } from "@/lib/venues";

// Tolerant JSON parse — never let a transient empty response crash the UI.
async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── Trading ──────────────────────────────────────────────────────────────────
// Positions, open orders, order and trade history, the paper ledger and the
// execution monitor. Tables are searchable, filterable, sortable, paginated
// and exportable (CSV of the current view). Manual orders use the same ticket
// and POST /api/orders path as everywhere else.

const OPEN_STATES = ["CREATED", "VALIDATED", "SUBMITTED", "OPEN", "PARTIALLY_FILLED", "UNKNOWN", "RECONCILING"];
const PAGE = 25;

function downloadCsv(name: string, rows: Array<Record<string, string | number | null | undefined>>) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c2) => esc(r[c2])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  if (total <= PAGE) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#1A2333] px-4 py-3 text-[13.5px] text-[#9AA6B8]">
      <span>Showing <span className="fd-num text-white">{page * PAGE + 1}–{Math.min(total, page * PAGE + PAGE)}</span> of <span className="fd-num text-white">{total}</span></span>
      <div className="flex items-center gap-2">
        <button className={btn.small} disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="fd-num">{page + 1} / {pages}</span>
        <button className={btn.small} disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function TradingView(props: {
  markets: MarketDTO[];
  dash: DashboardDTO | null;
  ordersData: { orders: OrderRowDTO[]; ledger: LedgerRowDTO[] } | null;
  busy: string | null;
  tab: string;
  onTab: (t: string) => void;
  onPlace: (p: unknown) => void;
  onSimulateAckLoss: (marketId: string) => void;
  onReconcile: () => void;
  hasUnknown: boolean;
  onTradeSomething: () => void;
  onOpenMarket: (id: string) => void;
  onOpenRobot: (id: string) => void;
}) {
  const { markets, dash, ordersData, busy, tab, onTab, onPlace, onSimulateAckLoss, onReconcile, hasUnknown, onTradeSomething, onOpenMarket } = props;
  const [q, setQ] = useState("");
  const [venue, setVenue] = useState("ALL");
  const [side, setSide] = useState("ALL");
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(0);
  const [ticketMarket, setTicketMarket] = useState<MarketDTO | null>(null);
  const [pickId, setPickId] = useState("");
  const [detail, setDetail] = useState<DashboardDTO["positions"][number] | null>(null);
  const [drillMarket, setDrillMarket] = useState("");

  if (!dash || !ordersData) return <PageSkeleton />;
  const orders = ordersData.orders;
  const ledger = ordersData.ledger;
  const positions = dash.positions;
  const deposits = ledger.filter((l) => l.type === "DEPOSIT" || l.type === "WITHDRAWAL").reduce((a, l) => a + l.amountCents, 0);
  const openCost = positions.reduce((a, p) => a + p.sizeCents, 0);
  const unrealized = positions.reduce((a, p) => a + (p.unrealizedCents ?? 0), 0);
  const realized = deposits > 0 ? dash.balanceCents + openCost - deposits : null;
  const openOrders = orders.filter((o) => OPEN_STATES.includes(o.state));
  const unresolved = orders.filter((o) => o.state === "UNKNOWN" || o.state === "RECONCILING");

  const match = (text: string, v?: string, s?: string) =>
    (!q.trim() || text.toLowerCase().includes(q.trim().toLowerCase())) && (venue === "ALL" || v === venue) && (side === "ALL" || (s ?? "").includes(side));
  const byTime = <T extends { createdAt?: string; openedAt?: string }>(a: T, b: T) => {
    const ta = a.createdAt ?? a.openedAt ?? "";
    const tb = b.createdAt ?? b.openedAt ?? "";
    return sortDesc ? tb.localeCompare(ta) : ta.localeCompare(tb);
  };

  const orderRows = (tab === "orders" ? openOrders : tab === "trades" ? orders.filter((o) => o.state === "FILLED" || o.state === "PARTIALLY_FILLED") : orders)
    .filter((o) => match(`${o.market?.question ?? ""} ${o.robot?.name ?? ""} ${o.id}`, o.market?.venue, o.side))
    .sort(byTime);
  const posRows = positions.filter((p) => match(`${p.market?.question ?? ""} ${p.robot?.name ?? ""}`, p.market?.venue, p.side)).sort(byTime);
  const ledgerRows = ledger.filter((l) => !q.trim() || `${l.type} ${l.memo ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())).sort(byTime);
  const sel = "h-10 rounded-xl border border-[#253247] bg-[#111827] px-3 text-[14px] text-[#E8EDF5]";
  const pageSlice = <T,>(rows: T[]) => rows.slice(page * PAGE, page * PAGE + PAGE);

  const exportCurrent = () => {
    if (tab === "positions") downloadCsv("positions", posRows.map((p) => ({ opened: p.openedAt, market: p.market?.question, venue: p.market?.venue, robot: p.robot?.name, side: p.side, sizeCents: p.sizeCents, entryCents: p.avgPriceCents, unrealizedCents: p.unrealizedCents })));
    else if (tab === "ledger") downloadCsv("paper-ledger", ledgerRows.map((l) => ({ time: l.createdAt, type: l.type, amountCents: l.amountCents, balanceAfterCents: l.balanceAfterCents, memo: l.memo })));
    else downloadCsv(tab === "trades" ? "trades" : "orders", orderRows.map((o) => ({ time: o.createdAt, orderId: o.id, market: o.market?.question, venue: o.market?.venue, robot: o.robot?.name ?? "manual", side: o.side, priceCents: o.priceCents, sizeCents: o.sizeCents, filledCents: o.filledCents, feeCents: o.feeCents, state: o.state, reason: o.stateReason })));
  };

  const filters = tab !== "execution" && (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-[#1A2333] p-4">
      <label className="sr-only" htmlFor="t-q">Search</label>
      <input id="t-q" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder={tab === "ledger" ? "Search ledger…" : "Search market, robot or order id…"} className={`${sel} min-w-[220px] flex-1 placeholder:text-[#7C889B]`} />
      {tab !== "ledger" && (
        <>
          <label className="sr-only" htmlFor="t-v">Venue</label>
          <select id="t-v" className={sel} value={venue} onChange={(e) => { setVenue(e.target.value); setPage(0); }}>
            <option value="ALL">All venues</option>
            {VENUES.filter((v) => v.adapter === "LIVE").map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          <label className="sr-only" htmlFor="t-s">Side</label>
          <select id="t-s" className={sel} value={side} onChange={(e) => { setSide(e.target.value); setPage(0); }}>
            <option value="ALL">Both sides</option>
            <option value="YES">YES</option>
            <option value="NO">NO</option>
          </select>
        </>
      )}
      <button className={btn.small} onClick={() => setSortDesc((d) => !d)} aria-label="Toggle sort order">{sortDesc ? "Newest first" : "Oldest first"}</button>
      <button className={btn.small} onClick={exportCurrent}><Download size={14} /> Export CSV</button>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<LineChartIcon size={24} />}
        title="Trading"
        subtitle="Positions, orders and the paper ledger. Every order walks the order state machine with a full journal."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="pick-market">Market for a new order</label>
            <select id="pick-market" className={`${sel} max-w-[260px]`} value={pickId} onChange={(e) => setPickId(e.target.value)}>
              <option value="">Choose a market…</option>
              {VENUES.map((v) => {
                const rows = markets.filter((m) => m.venue === v.id && !m.ambiguityFlag);
                if (rows.length === 0) return null;
                return <optgroup key={v.id} label={v.label}>{rows.map((m) => <option key={m.id} value={m.id}>{m.question.slice(0, 70)}</option>)}</optgroup>;
              })}
            </select>
            <button className={btn.primary} disabled={!pickId} onClick={() => setTicketMarket(markets.find((m) => m.id === pickId) ?? null)}><Plus size={16} /> New paper order</button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Metric label="Open positions" value={positions.length} hex={T.blue} />
        <Metric label="Orders" value={orders.length} sub={`${openOrders.length} open`} hex={T.cyan} />
        <Metric label="Total exposure" value={money(openCost)} hex={T.amber} />
        <Metric label="Realized P&L" value={realized != null ? money(realized, { sign: true }) : "—"} tone={toneOf(realized)} hex={T.green} sub="Closed trades, from the ledger" />
        <Metric label="Unrealized P&L" value={money(unrealized, { sign: true })} tone={toneOf(unrealized)} hex={T.purple} sub="Open positions at mark" />
      </div>

      <Tabs label="Trading sections" value={tab} onChange={(t) => { onTab(t); setPage(0); }} tabs={[
        { id: "positions", label: "Positions", count: positions.length },
        { id: "orders", label: "Open Orders", count: openOrders.length },
        { id: "history", label: "Order History", count: orders.length },
        { id: "trades", label: "Trade History" },
        { id: "ledger", label: "Paper Ledger", count: ledger.length },
        { id: "execution", label: "Execution Monitor", count: unresolved.length || undefined },
      ]} />

      {tab === "positions" && (
        <Panel pad={false}>
          {filters}
          {posRows.length === 0 ? (
            <EmptyState title="No open positions" body="Positions appear when a robot or a manual order enters a market." action={<button className={btn.primary} onClick={onTradeSomething}>Browse markets</button>} />
          ) : (
            <>
              <TableWrap minWidth={900}>
                <thead><tr><th className={th}>Market</th><th className={th}>Venue</th><th className={th}>Robot</th><th className={th}>Side</th><th className={`${th} text-right`}>Entry</th><th className={`${th} text-right`}>Current</th><th className={`${th} text-right`}>Size</th><th className={`${th} text-right`}>Unrealized</th></tr></thead>
                <tbody>
                  {pageSlice(posRows).map((p) => {
                    const mark = p.side === "YES" ? p.market?.yesPriceCents : p.market?.noPriceCents;
                    return (
                      <tr key={p.id} className={`${trow} cursor-pointer`} onClick={() => setDetail(p)}>
                        <td className={`${td} max-w-[320px] truncate`}>{p.market?.question}</td>
                        <td className={td}>{p.market?.venue ? <VenueTag venue={p.market.venue} /> : "—"}</td>
                        <td className={`${td} text-[#C9D2DE]`}>{p.robot?.name ?? "Manual"}</td>
                        <td className={td}><Badge tone={p.side === "YES" ? "green" : "red"}>{p.side}</Badge></td>
                        <td className={`${td} fd-num text-right`}>{p.avgPriceCents}¢</td>
                        <td className={`${td} fd-num text-right`}>{mark != null ? `${mark}¢` : "—"}</td>
                        <td className={`${td} fd-num text-right`}>{money(p.sizeCents)}</td>
                        <td className={`${td} fd-num text-right font-semibold ${toneText[toneOf(p.unrealizedCents)]}`}>{p.unrealizedCents != null ? money(p.unrealizedCents, { sign: true }) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
              <Pager page={page} total={posRows.length} onPage={setPage} />
            </>
          )}
        </Panel>
      )}

      {(tab === "orders" || tab === "history" || tab === "trades") && (
        <Panel pad={false}>
          {filters}
          {orderRows.length === 0 ? (
            <EmptyState title={tab === "orders" ? "No open orders" : tab === "trades" ? "No trades yet" : "No orders yet"} body="Place a paper order or run a robot cycle." />
          ) : (
            <>
              <TableWrap minWidth={980}>
                <thead><tr><th className={th}>Time (UTC)</th><th className={th}>Market</th><th className={th}>Venue</th><th className={th}>Side</th><th className={`${th} text-right`}>Price</th><th className={`${th} text-right`}>Size</th><th className={`${th} text-right`}>Filled</th><th className={`${th} text-right`}>Fee</th><th className={th}>State</th><th className={th}>Robot</th></tr></thead>
                <tbody>
                  {pageSlice(orderRows).map((o) => (
                    <tr key={o.id} className={trow}>
                      <td className={`${td} fd-num whitespace-nowrap text-[#C9D2DE]`}>{new Date(o.createdAt).toISOString().replace("T", " ").slice(5, 19)}</td>
                      <td className={`${td} max-w-[280px]`}><button className="block w-full truncate text-left hover:underline" onClick={() => onOpenMarket(o.marketId)}>{o.market?.question ?? o.marketId}</button></td>
                      <td className={td}>{o.market?.venue ? <VenueTag venue={o.market.venue} /> : "—"}</td>
                      <td className={td}><Badge tone={o.side.includes("YES") ? "green" : "red"}>{o.side.replace("_", " ")}</Badge></td>
                      <td className={`${td} fd-num text-right`}>{o.priceCents}¢</td>
                      <td className={`${td} fd-num text-right`}>{money(o.sizeCents)}</td>
                      <td className={`${td} fd-num text-right text-[#C9D2DE]`}>{money(o.filledCents)}</td>
                      <td className={`${td} fd-num text-right text-[#C9D2DE]`}>{money(o.feeCents)}</td>
                      <td className={td} title={o.stateReason ?? undefined}>{orderStateBadge(o.state)}</td>
                      <td className={`${td} text-[#C9D2DE]`}>{o.robot?.name ?? "Manual"}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <Pager page={page} total={orderRows.length} onPage={setPage} />
            </>
          )}
        </Panel>
      )}

      {tab === "ledger" && (
        <Panel pad={false}>
          {filters}
          {ledgerRows.length === 0 ? <EmptyState title="Ledger is empty" /> : (
            <>
              <TableWrap minWidth={760}>
                <thead><tr><th className={th}>Time (UTC)</th><th className={th}>Type</th><th className={`${th} text-right`}>Amount</th><th className={`${th} text-right`}>Balance</th><th className={th}>Memo</th></tr></thead>
                <tbody>
                  {pageSlice(ledgerRows).map((l) => (
                    <tr key={l.id} className={trow}>
                      <td className={`${td} fd-num whitespace-nowrap text-[#C9D2DE]`}>{new Date(l.createdAt).toISOString().replace("T", " ").slice(0, 19)}</td>
                      <td className={td}><Badge tone={l.type === "DEPOSIT" ? "cyan" : l.type === "FEE" ? "amber" : "neutral"}>{l.type.toLowerCase()}</Badge></td>
                      <td className={`${td} fd-num text-right font-semibold ${l.amountCents < 0 ? "text-[#FF7A8B]" : "text-[#3BE6B0]"}`}>{money(l.amountCents, { sign: true })}</td>
                      <td className={`${td} fd-num text-right`}>{money(l.balanceAfterCents)}</td>
                      <td className={`${td} max-w-[420px] truncate text-[#9AA6B8]`}>{l.memo}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <Pager page={page} total={ledgerRows.length} onPage={setPage} />
            </>
          )}
        </Panel>
      )}

      {tab === "execution" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel title="Execution monitor" subtitle="Orders whose venue acknowledgement is unresolved, and recent rejections" pad={false}>
            {unresolved.length === 0 && orders.filter((o) => o.state === "REJECTED").length === 0 ? (
              <EmptyState compact title="Nothing needs attention" body="All orders are resolved." />
            ) : (
              <TableWrap minWidth={720}>
                <thead><tr><th className={th}>Time (UTC)</th><th className={th}>Order id</th><th className={th}>Market</th><th className={th}>State</th><th className={th}>Reason</th></tr></thead>
                <tbody>
                  {[...unresolved, ...orders.filter((o) => o.state === "REJECTED")].map((o) => (
                    <tr key={o.id} className={trow}>
                      <td className={`${td} fd-num whitespace-nowrap text-[#C9D2DE]`}>{new Date(o.createdAt).toISOString().replace("T", " ").slice(5, 19)}</td>
                      <td className={`${td} fd-num text-[#C9D2DE]`}>{o.id.slice(-10)}</td>
                      <td className={`${td} max-w-[260px] truncate`}>{o.market?.question}</td>
                      <td className={td}>{orderStateBadge(o.state)}</td>
                      <td className={`${td} max-w-[300px] text-[#9AA6B8]`}>{o.stateReason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>
          <Panel title="Reconciliation" subtitle="Resolve orders whose venue response was lost">
            <button className={`${btn.primary} w-full`} disabled={!hasUnknown || busy !== null} onClick={onReconcile}>Run reconciliation pass</button>
            <p className="mt-2 text-[13px] text-[#7C889B]">{hasUnknown ? `${unresolved.length} order(s) waiting.` : "Nothing pending."}</p>
            <div className="mt-6 border-t border-[#1A2333] pt-5">
              <h3 className="text-[14.5px] font-semibold text-white">Failure drill</h3>
              <p className="mt-1 text-[13px] text-[#9AA6B8]">Creates a synthetic paper order whose acknowledgement is lost, so you can watch reconciliation resolve it.</p>
              <label className="sr-only" htmlFor="drill-m">Market for the drill</label>
              <select id="drill-m" className={`${sel} mt-3 w-full`} value={drillMarket} onChange={(e) => setDrillMarket(e.target.value)}>
                <option value="">Choose a market…</option>
                {markets.slice(0, 60).map((m) => <option key={m.id} value={m.id}>{m.question.slice(0, 60)}</option>)}
              </select>
              <button className={`${btn.secondary} mt-3 w-full`} disabled={!drillMarket || busy !== null} onClick={() => onSimulateAckLoss(drillMarket)}>Simulate lost acknowledgement</button>
            </div>
          </Panel>
        </div>
      )}

      <Sheet open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent side="right" className="w-full border-[#1A2333] bg-[#111827] text-[#E8EDF5] sm:max-w-[440px]">
          <SheetHeader>
            <SheetTitle className="text-[18px] text-white">Position details</SheetTitle>
          </SheetHeader>
          {detail && (
            <div className="flex flex-col gap-4 px-4 pb-6">
              <div className="text-[16px] font-semibold leading-snug">{detail.market?.question}</div>
              <div className="flex flex-wrap gap-2">{detail.market?.venue && <VenueTag venue={detail.market.venue} />}<Badge tone={detail.side === "YES" ? "green" : "red"}>{detail.side}</Badge><Badge tone="amber">Paper</Badge></div>
              <div>
                <KV k="Robot" v={detail.robot?.name ?? "Manual"} />
                <KV k="Opened" v={new Date(detail.openedAt).toUTCString().replace(" GMT", " UTC")} />
                <KV k="Size" v={money(detail.sizeCents)} mono />
                <KV k="Entry price" v={`${detail.avgPriceCents}¢`} mono />
                <KV k="Current price" v={(() => { const m = detail.side === "YES" ? detail.market?.yesPriceCents : detail.market?.noPriceCents; return m != null ? `${m}¢` : "—"; })()} mono />
                <KV k="Unrealized P&L" v={<span className={toneText[toneOf(detail.unrealizedCents)]}>{detail.unrealizedCents != null ? money(detail.unrealizedCents, { sign: true }) : "—"}</span>} mono />
                <KV k="Payout if correct" v={money(Math.round((detail.sizeCents / Math.max(1, detail.avgPriceCents)) * 100))} mono />
                {detail.market?.eventKey && <KV k="Event cluster" v={detail.market.eventKey} mono />}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <TradeDialog key={ticketMarket?.id ?? "none"} market={ticketMarket} onClose={() => setTicketMarket(null)} onPlace={onPlace} busy={busy} />
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────
const SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "account", label: "Account" },
  { id: "custody", label: "Wallet & Custody" },
  { id: "modes", label: "Trading Modes" },
  { id: "live", label: "Live Trading Permissions" },
  { id: "risk", label: "Risk Limits" },
  { id: "ai", label: "AI Providers" },
  { id: "models", label: "Model Registry" },
  { id: "notifications", label: "Notifications" },
  { id: "security", label: "Security" },
  { id: "api", label: "API Connections" },
  { id: "audit", label: "Audit & Compliance" },
] as const;

export function SettingsView(props: {
  dash: DashboardDTO | null;
  riskView: RiskViewDTO | null;
  eligibility: EligibilityRuleDTO[];
  probability: ProbabilityDTO | null;
  tab: string;
  onTab: (t: string) => void;
  mode: string;
  me: { email: string; role: string; name: string | null; via?: string } | null;
  onSaveRisk: (key: string, value: number) => Promise<void>;
  onSaveProvider: (p: { id: string; apiKey?: string | null; model?: string; enabled?: boolean; baseUrl?: string | null }) => Promise<void>;
  onFlipCountry: (country: string, allowed: boolean) => Promise<void>;
  onProbabilityAction: (body: Record<string, unknown>, okMsg: string) => Promise<void>;
  onOpenRisk: () => void;
}) {
  const { dash, riskView, eligibility, tab, onTab, mode, me } = props;
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [confirmCountry, setConfirmCountry] = useState<EligibilityRuleDTO | null>(null);
  useEffect(() => { props.onOpenRisk(); }, []);
  if (!riskView || !dash) return <PageSkeleton />;

  const riskRows: Array<{ key: string; label: string; help: string; max: number; unit: string; val: number }> = [
    { key: "DAILY_LOSS_STOP_PCT", label: "Daily loss stop", help: "Robots stop opening positions for the day once losses reach this share of your balance.", max: riskView.platformMax.DAILY_LOSS_STOP_PCT ?? 20, unit: "%", val: riskView.effective.dailyLossStopPct },
    { key: "DRAWDOWN_STOP_PCT", label: "Total drawdown stop", help: "Trading stops once the balance falls this far from its peak.", max: riskView.platformMax.DRAWDOWN_STOP_PCT ?? 30, unit: "%", val: riskView.effective.drawdownStopPct },
    { key: "PER_EVENT_EXPOSURE_PCT", label: "Per-event exposure cap", help: "Maximum share of allocation in related markets of one event.", max: riskView.platformMax.PER_EVENT_EXPOSURE_PCT ?? 50, unit: "%", val: riskView.effective.perEventExposurePct },
  ];
  const inp = "h-11 rounded-xl border border-[#253247] bg-[#0D121C] px-3 text-[14.5px] text-white placeholder:text-[#7C889B]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={<SettingsIcon size={24} />} title="Settings" subtitle="Account, custody, trading modes, risk limits, AI providers and compliance" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="h-fit rounded-2xl border border-[#1E2A3D] bg-[#111827] p-2">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {SETTINGS_TABS.map((t) => (
              <li key={t.id} className="shrink-0">
                <button onClick={() => onTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
                  className={`w-full whitespace-nowrap rounded-xl px-3.5 py-2.5 text-left text-[14.5px] transition-colors ${tab === t.id ? "bg-[#2583FF]/14 font-semibold text-white" : "text-[#9AA6B8] hover:bg-white/[0.04] hover:text-white"}`}>
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-5">
          {tab === "general" && (
            <>
              <Panel title="General">
                <KV k="Operating mode" v={<Badge tone={mode === "PAPER" ? "amber" : mode === "LIVE" || mode === "PAUSED" ? "red" : "purple"} dot>{mode === "PAPER" ? "Paper" : mode === "LIVE" ? "Live" : mode === "PAUSED" ? "Emergency pause" : "Restricted"}</Badge>} />
                <KV k="Currency" v="USD (all amounts stored in integer cents)" />
                <KV k="Timestamps" v="UTC in tables and logs; local time in greetings" />
                <KV k="Paper balance" v={money(dash.balanceCents)} mono />
                <KV k="Robots" v={`${dash.robots.length} configured`} />
              </Panel>
              <Panel title="Where things live">
                <p className="text-[14px] leading-relaxed text-[#9AA6B8]">Beginner settings sit at the top of each section; advanced options (model governance, API keys, compliance) are in their own tabs. Sensitive changes ask for confirmation.</p>
              </Panel>
            </>
          )}

          {tab === "account" && (
            <Panel title="Account">
              <KV k="Name" v={me?.name ?? dash.user.name ?? "—"} />
              <KV k="Email" v={me?.email ?? dash.user.email} mono />
              <KV k="Role" v={<Badge tone={me?.role === "OPERATOR" ? "blue" : "green"}>{(me?.role ?? "member").toLowerCase()}</Badge>} />
              <KV k="Country" v={dash.user.country} />
              <KV k="Session" v={me?.via === "FOUNDER_FALLBACK" ? <span className="text-[#FFC266]">Not signed in (local fallback)</span> : "Signed in"} />
            </Panel>
          )}

          {tab === "custody" && (
            <Panel title="Wallet & custody" subtitle="Self-custody: your wallet signs every order">
              <KV k="Wallet address" v={dash.wallet ? `${dash.wallet.address.slice(0, 12)}…${dash.wallet.address.slice(-6)}` : "No wallet linked"} mono />
              <KV k="Signing model" v={dash.wallet?.signingModel ?? "—"} mono />
              <KV k="Kalshi credential" v="Asymmetric API key (RSA or Ed25519)" />
              <p className="mt-4 text-[14px] leading-relaxed text-[#9AA6B8]">
                The platform stores your wallet address only. Signing keys are injected at runtime for each process, redacted everywhere and never written to the database.
                Wallet signing (Polymarket) and API-key signing (Kalshi) are separate paths. Every real send stays behind the live-trading gates.
              </p>
            </Panel>
          )}

          {tab === "modes" && (
            <Panel title="Trading modes">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {[
                  { id: "PAPER", title: "Paper", tone: "amber", body: "Simulated fills against live prices. No real money moves. Default for every robot." },
                  { id: "RESTRICTED", title: "Restricted", tone: "purple", body: "The small-capital pilot is enabled but sends stay dry-run: orders are signed and journaled, never transmitted." },
                  { id: "LIVE", title: "Live", tone: "red", body: "Real orders within pilot ceilings. Requires consent, a passing edge gate, a signer and the arm switch." },
                  { id: "PAUSED", title: "Emergency pause", tone: "red", body: "Every robot cycle and new order is refused until you resume." },
                ].map((m) => (
                  <div key={m.id} className={`rounded-2xl border p-4 ${mode === m.id ? "border-[#2583FF] bg-[#2583FF]/[0.07]" : "border-[#1E2A3D] bg-[#0D121C]"}`}>
                    <div className="flex items-center justify-between"><span className="text-[15.5px] font-semibold text-white">{m.title}</span>{mode === m.id && <Badge tone={m.tone} dot>Current</Badge>}</div>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-[#9AA6B8]">{m.body}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {tab === "live" && <LiveTradingCard />}

          {tab === "risk" && (
            <Panel title="Risk limits" subtitle="You can tighten limits freely; they are clamped to the platform maximum and every change is audited">
              <div className="flex flex-col gap-7">
                {riskRows.map((r) => (
                  <div key={r.key}>
                    <div className="mb-3 flex items-baseline justify-between gap-3">
                      <span className="text-[15px] font-medium text-white">{r.label}</span>
                      <span className="fd-num text-[15px] font-semibold text-white">{r.val}{r.unit} <span className="text-[13px] font-normal text-[#7C889B]">max {r.max}{r.unit}</span></span>
                    </div>
                    <Slider value={[r.val]} min={1} max={r.max} step={1} onValueCommit={(v) => props.onSaveRisk(r.key, v[0])} onValueChange={() => undefined} aria-label={r.label} />
                    <p className="mt-2 text-[13px] text-[#7C889B]">{r.help}</p>
                  </div>
                ))}
                <KV k="AI monthly budget" v={`${money(riskView.effective.aiMonthlyBudgetCents)} (platform max ${money(riskView.platformMax.AI_MONTHLY_BUDGET_CENTS ?? 20000)})`} mono />
                <p className="text-[13px] text-[#7C889B]">Research pauses at 100% of the AI budget; risk management keeps running.</p>
              </div>
            </Panel>
          )}

          {tab === "ai" && (
            <Panel title="AI providers" subtitle="Any provider key works. The highest-priority enabled provider is used; without one, robots use the deterministic baseline. Keys are stored server-side and only ever shown masked.">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {dash.providers.map((p: ProviderDTO) => (
                  <div key={p.id} className="rounded-2xl border border-[#1E2A3D] bg-[#0D121C] p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[15.5px] font-semibold text-white">{p.name}</span>
                      <Switch checked={p.enabled} onCheckedChange={(v) => props.onSaveProvider({ id: p.id, enabled: v })} aria-label={`Enable ${p.name}`} />
                    </div>
                    <div className="mt-1.5 text-[13px] text-[#9AA6B8]">{p.hasKey ? <>Key <span className="fd-num">{p.keyMasked}</span></> : "No key yet"}{p.baseUrl ? ` · ${p.baseUrl}` : ""}</div>
                    <div className="mt-3 flex flex-col gap-2">
                      <label className="sr-only" htmlFor={`m-${p.id}`}>Model</label>
                      <input id={`m-${p.id}`} className={inp} placeholder={p.name === "OPENAI_COMPATIBLE" ? "Model name (required)" : p.model} value={modelDrafts[p.id] ?? ""} onChange={(e) => setModelDrafts((d) => ({ ...d, [p.id]: e.target.value }))} />
                      <div className="flex gap-2">
                        <label className="sr-only" htmlFor={`k-${p.id}`}>API key</label>
                        <input id={`k-${p.id}`} type="password" className={`${inp} min-w-0 flex-1`} placeholder="API key" value={keyDrafts[p.id] ?? ""} onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.id]: e.target.value }))} />
                        <button className={btn.secondary} disabled={!keyDrafts[p.id]} onClick={async () => { await props.onSaveProvider({ id: p.id, apiKey: keyDrafts[p.id], model: modelDrafts[p.id] || p.model || undefined }); setKeyDrafts((d) => ({ ...d, [p.id]: "" })); }}>Save key</button>
                      </div>
                      {p.name === "OPENAI_COMPATIBLE" && (
                        <input className={inp} placeholder="Base URL (e.g. https://api.example.com/v1)" defaultValue={p.baseUrl ?? ""} onBlur={(e) => props.onSaveProvider({ id: p.id, baseUrl: e.target.value })} aria-label="Base URL" />
                      )}
                      <div className="text-[12.5px] text-[#7C889B]">Budget <span className="fd-num">{money(p.monthlyBudgetCents)}</span> · spent <span className="fd-num">{money(p.spentCents)}</span> · priority {p.priority}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {tab === "models" && (
            <>
              <ModelRegistryCard probability={props.probability} onAction={props.onProbabilityAction} />
              <GovernanceCard probability={props.probability} onAction={props.onProbabilityAction} />
            </>
          )}

          {tab === "notifications" && (
            <>
              <NotifyCard />
              <NotificationsCard />
            </>
          )}

          {tab === "security" && (
            <Panel title="Security">
              <KV k="Sign-in" v={me?.via === "FOUNDER_FALLBACK" ? <span className="text-[#FFC266]">Not signed in</span> : "Password + session token"} />
              <KV k="Session storage" v="Hashed opaque token, httpOnly cookie, 14-day expiry" />
              <KV k="Signing keys" v="Never stored; injected at runtime" />
              <KV k="AI provider keys" v="Stored server-side, never returned (masked only)" />
              <div className="mt-4 flex gap-2">
                {me?.via === "FOUNDER_FALLBACK" && <a className={btn.primary} href="/login">Sign in</a>}
                <button className={btn.secondary} onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.reload(); }}>Sign out everywhere on this device</button>
              </div>
            </Panel>
          )}

          {tab === "api" && (
            <>
              <Panel title="Venue connections" pad={false}>
                <TableWrap minWidth={520}>
                  <thead><tr><th className={th}>Venue</th><th className={th}>Adapter</th><th className={`${th} text-right`}>Markets</th><th className={th}>Credential</th></tr></thead>
                  <tbody>
                    {VENUES.map((v) => (
                      <tr key={v.id} className={trow}>
                        <td className={td}><VenueTag venue={v.id} /></td>
                        <td className={td}>{v.adapter === "LIVE" ? <Badge tone="green" dot>Live</Badge> : <Badge tone={v.id === "DRIFT_BET" ? "red" : "amber"}>{v.id === "DRIFT_BET" ? "Suspended" : "Pending"}</Badge>}</td>
                        <td className={`${td} fd-num text-right`}>{dash.venues.find((s) => s.venue === v.id)?.markets ?? 0}</td>
                        <td className={`${td} text-[#C9D2DE]`}>{v.id === "KALSHI" ? "API key" : v.id === "MANIFOLD" ? "Public API" : v.id === "DRIFT_BET" ? "—" : "Wallet"}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </Panel>
              <ApiKeysCard />
            </>
          )}

          {tab === "audit" && (
            <>
              <ComplianceCard />
              <MetricsCard />
              <Panel title="Jurisdiction eligibility" subtitle="Sanctioned jurisdictions can never be allowed. Unknown countries are denied by default. Changes ask for confirmation.">
                <div className="fd-scroll flex max-h-[320px] flex-wrap gap-2 overflow-y-auto">
                  {eligibility.map((r) => (
                    <button key={r.id} onClick={() => setConfirmCountry(r)} title={r.reason ?? "No reason recorded"}
                      className={`rounded-xl border px-3 py-2 text-[14px] font-semibold transition-colors ${r.allowed ? "border-[#00D69A]/40 bg-[#00D69A]/10 text-[#3BE6B0]" : "border-[#FF5268]/40 bg-[#FF5268]/10 text-[#FF7A8B]"}`}>
                      {r.country} · {r.allowed ? "allowed" : "blocked"}
                    </button>
                  ))}
                </div>
              </Panel>
            </>
          )}
        </div>
      </div>

      <Dialog open={!!confirmCountry} onOpenChange={(v) => !v && setConfirmCountry(null)}>
        <DialogContent className="border-[#253247] bg-[#111827] text-[#E8EDF5] sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{confirmCountry?.allowed ? "Block" : "Allow"} {confirmCountry?.country}?</DialogTitle>
            <DialogDescription className="text-[#9AA6B8]">This changes who can trade from {confirmCountry?.country}. Sanctioned jurisdictions are refused by the server regardless.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <button className={btn.secondary} onClick={() => setConfirmCountry(null)}>Cancel</button>
            <button className={confirmCountry?.allowed ? btn.danger : btn.primary} onClick={async () => { if (confirmCountry) await props.onFlipCountry(confirmCountry.country, !confirmCountry.allowed); setConfirmCountry(null); }}>
              {confirmCountry?.allowed ? "Block" : "Allow"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Model registry & calibration — A-01/A-03 (Phase 5) ──────────────────────
function ModelRegistryCard({ probability, onAction }: { probability: ProbabilityDTO | null; onAction: (body: Record<string, unknown>, okMsg: string) => Promise<void> }) {
  const prob = probability;
  return (
    <div className={`${card} p-4`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className={`text-[15px] font-semibold`}>Model registry — calibration, promotion & demotion (A-01/A-03)</div>
        <Button size="sm" variant="outline" className="border-[#253247] bg-[#161F2D] text-[#E8EDF5] text-[13px] hover:bg-[#1C2740]"
          onClick={() => onAction({ action: "RECOMPUTE" }, "Calibration recomputed")}>
          Recompute calibration
        </Button>
      </div>
      <div className={`mb-3 text-[13.5px] ${c.text3}`}>
        Baseline (A-03): <span className={mono}>{prob?.baseline.key}</span> — {prob?.baseline.formula}. A candidate may drive decisions only after beating the
        baseline by {prob?.knobs.promotionMarginPct}% Brier over ≥ {prob?.knobs.minSamples} resolved forecasts; an ACTIVE model drifting more than {prob?.knobs.demotionTolerancePct}% worse is demoted (drill-tested). Promotion is a founder action (B8).
      </div>
      {!prob && <div className={`py-3 text-center text-[14px] ${c.text3}`}>Loading registry…</div>}
      {prob && (
        <div className="flex flex-col gap-2">
          {prob.models.map((m: ModelRowDTO) => {
            const cal = m.calibration;
            const statusCls =
              m.status === "ACTIVE" ? `text-[#00D69A] bg-[#00D69A]/10`
              : m.status === "DEMOTED" ? `text-[#FF5268] bg-[#FF5268]/10`
              : m.status === "RETIRED" ? `${c.text3} bg-[#161F2D]`
              : `text-[#FFB547] bg-[#FFB547]/10`;
            return (
              <div key={m.key} className={`rounded-lg border p-3 ${c.border}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[11.5px] font-bold ${statusCls}`}>{m.status}</span>
                  <span className={`text-[14px] font-semibold ${mono} ${c.text}`}>{m.key}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${c.text3} bg-[#161F2D]`}>{m.kind}</span>
                  {cal && cal.eligible && m.status !== "ACTIVE" && <span className="rounded bg-[#00D69A]/10 px-1.5 py-0.5 text-[11px] font-bold text-[#00D69A]">promotion-ready</span>}
                  {cal && cal.demote && m.status === "ACTIVE" && <span className="rounded bg-[#FF5268]/10 px-1.5 py-0.5 text-[11px] font-bold text-[#FF5268]">demotion warranted</span>}
                  <div className="ml-auto flex gap-2">
                    {m.status !== "ACTIVE" && (
                      <Button size="sm" variant="outline" className="h-7 border-[#253247] bg-[#161F2D] px-2 text-[12.5px] text-[#E8EDF5] hover:bg-[#1C2740]"
                        onClick={() => onAction({ action: "PROMOTE", modelKey: m.key }, `Promote ${m.key}`)}>
                        Promote
                      </Button>
                    )}
                    {m.status === "ACTIVE" && m.key !== prob.baseline.key && (
                      <Button size="sm" variant="outline" className="h-7 border-[#FF5268]/40 bg-[#161F2D] px-2 text-[12.5px] text-[#FF5268] hover:bg-[#2A1A22]"
                        onClick={() => onAction({ action: "DEMOTE", modelKey: m.key, reason: "manual demotion from Settings" }, `Demote ${m.key}`)}>
                        Demote
                      </Button>
                    )}
                  </div>
                </div>
                <div className={`mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] ${c.text2}`}>
                  {cal ? (
                    <>
                      <span className={mono}>n {cal.n}</span>
                      <span className={mono}>brier {cal.brier.toFixed(4)}</span>
                      <span className={mono}>baseline {cal.baselineBrier.toFixed(4)}</span>
                      <span className={mono}>
                        Δ {cal.deltaPct > 0 ? "+" : ""}{cal.deltaPct.toFixed(1)}% vs baseline
                      </span>
                      <span className={c.text3}>evidence {cal.nLive} live / {cal.nSynthetic} synthetic (D-03)</span>
                      <span className={c.text3}>window {cal.window}</span>
                    </>
                  ) : (
                    <span className={c.text3}>no calibration yet — no resolved forecasts recorded for this model</span>
                  )}
                </div>
                {m.notes && <div className={`mt-1 text-[12.5px] ${c.text3}`}>{m.notes}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── AI cost & latency governance — A-07 (Phase 5) ────────────────────────────
function GovernanceCard({ probability, onAction }: { probability: ProbabilityDTO | null; onAction: (body: Record<string, unknown>, okMsg: string) => Promise<void> }) {
  const g = probability?.governance;
  return (
    <div className={`${card} p-4`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className={`text-[15px] font-semibold`}>AI cost & latency governance (A-07)</div>
        <Button size="sm" variant="outline" className="border-[#253247] bg-[#161F2D] text-[#E8EDF5] text-[13px] hover:bg-[#1C2740]"
          onClick={() => onAction({ action: "CLEAR_CACHE" }, "Estimate cache cleared")}>
          Clear estimate cache
        </Button>
      </div>
      <div className={`mb-3 text-[13.5px] ${c.text3}`}>
        Per-provider budgets gate every call; identical estimates within the cache TTL are served free. Blocked attempts are logged, never silent — the fallback is stated in the trace.
      </div>
      {!g && <div className={`py-3 text-center text-[14px] ${c.text3}`}>Loading governance…</div>}
      {g && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className={`rounded-lg border p-3 ${c.border}`}>
              <div className={`text-[11px] font-semibold tracking-wider ${c.text3}`}>CALLS 24H</div>
              <div className={`mt-1 text-[18px] font-semibold ${mono} ${c.text}`}>{g.totals24h.calls}</div>
              <div className={`text-[11.5px] ${c.text3}`}>{g.totals24h.failed} failed · {g.totals24h.blocked} budget-blocked</div>
            </div>
            <div className={`rounded-lg border p-3 ${c.border}`}>
              <div className={`text-[11px] font-semibold tracking-wider ${c.text3}`}>CACHE HIT RATE</div>
              <div className={`mt-1 text-[18px] font-semibold ${mono} ${c.text}`}>{g.cache.hitRatePct}%</div>
              <div className={`text-[11.5px] ${c.text3}`}>{g.cache.hits24h} hits / {g.cache.misses24h} misses · {g.cache.entries} entries</div>
            </div>
            {g.providers.slice(0, 2).map((p) => (
              <div key={p.name} className={`rounded-lg border p-3 ${c.border}`}>
                <div className={`text-[11px] font-semibold tracking-wider ${c.text3}`}>{p.name} P50 / P95</div>
                <div className={`mt-1 text-[18px] font-semibold ${mono} ${c.text}`}>
                  {p.p50Ms != null ? `${p.p50Ms}ms` : "—"} / {p.p95Ms != null ? `${p.p95Ms}ms` : "—"}
                </div>
                <div className={`text-[11.5px] ${c.text3}`}>{p.calls24h} calls 24h · {p.blocked24h} blocked</div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {g.providers.map((p) => (
              <div key={p.name}>
                <div className={`flex justify-between text-[13.5px] ${c.text2}`}>
                  <span>{p.name}{!p.enabled && ` (disabled)`}</span>
                  <span className={mono}>
                    {fmtCents(p.spentCents)} / {fmtCents(p.monthlyBudgetCents)} · {p.budgetUsedPct}%
                  </span>
                </div>
                <div className={`mt-1 h-1.5 w-full rounded-full ${p.budgetUsedPct >= 100 ? "bg-[#FF5268]/30" : "bg-[#161F2D]"}`}>
                  <div
                    className={`h-1.5 rounded-full ${p.budgetUsedPct >= 100 ? "bg-[#FF5268]" : "bg-[#2583FF]"}`}
                    style={{ width: `${Math.min(100, p.budgetUsedPct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Strategy Lab — C5 versions + A-05 backtests (Phase 2) ────────────────────
export function StrategyLab({ dash, onAfterChange }: { dash: DashboardDTO | null; onAfterChange: () => void }) {
  const robots = dash?.robots ?? [];
  const [robotId, setRobotId] = useState("");
  const active = robots.find((r) => r.id === robotId) ?? robots[0] ?? null;

  const [versions, setVersions] = useState<VersionDTO[]>([]);
  const [minEdge, setMinEdge] = useState(8);
  const [tilt, setTilt] = useState(25);
  const [exitEdge, setExitEdge] = useState(2);
  const [hold, setHold] = useState(12);
  const [slippage, setSlippage] = useState(1);
  const [feeBps, setFeeBps] = useState(100);
  const [labBusy, setLabBusy] = useState<string | null>(null);
  const [bt, setBt] = useState<BacktestResultDTO | null>(null);
  const [btError, setBtError] = useState<string | null>(null);

  const loadVersions = useCallback(async (rid: string) => {
    const res = await fetch(`/api/strategies?robotId=${rid}`);
    const json = await safeJson<{ versions: VersionDTO[] }>(res);
    setVersions(json?.versions ?? []);
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadVersions(active.id);
    setBt(null);
    setBtError(null);
  }, [active?.id, loadVersions]);

  const syncFromActive = () => {
    const v = versions.find((x) => x.isActive) ?? versions[0];
    if (v) {
      setMinEdge(v.config.minEdgePts);
      setTilt(v.config.estimatorTiltPct);
      setExitEdge(v.config.exitEdgePts);
      setHold(v.config.holdTicksMax);
    }
  };
  useEffect(syncFromActive, [versions]);

  const createVersion = async () => {
    if (!active) return;
    setLabBusy("create");
    try {
      const res = await fetch("/api/strategies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ robotId: active.id, config: { minEdgePts: minEdge, estimatorTiltPct: tilt, exitEdgePts: exitEdge, holdTicksMax: hold, entryRule: `edge>=${minEdge}pts net of fees` } }),
      });
      const json = await safeJson<{ ok?: boolean; version?: number; error?: string }>(res);
      if (json?.ok) {
        await loadVersions(active.id);
        onAfterChange();
      }
    } finally {
      setLabBusy(null);
    }
  };

  const activate = async (versionId: string) => {
    if (!active) return;
    setLabBusy("activate");
    try {
      await fetch("/api/strategies", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ robotId: active.id, versionId }) });
      await loadVersions(active.id);
      onAfterChange();
    } finally {
      setLabBusy(null);
    }
  };

  const runBacktest = async () => {
    if (!active) return;
    setLabBusy("backtest");
    setBtError(null);
    try {
      const res = await fetch("/api/backtests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ robotId: active.id, slippageCents: slippage, feeBps, minEdgePts: minEdge, holdTicksMax: hold }),
      });
      const json = await safeJson<BacktestResultDTO>(res);
      if (json?.ok) setBt(json);
      else setBtError(json?.error ?? "empty response — try again");
    } catch {
      setBtError("backtest request failed — try again");
    } finally {
      setLabBusy(null);
    }
  };

  if (!active) {
    return (
      <div className={`${card} p-4 text-[14px] ${c.text3}`}>
        Strategy versions &amp; backtests unlock once a robot exists — create one in the wizard above.
      </div>
    );
  }

  const s = bt?.stats;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[17px] font-semibold">Strategy lab — versions &amp; backtests</h2>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${c.bright} bg-[#2583FF]/10`}>C5 · A-05</span>
        <span className={`text-[13.5px] ${c.text3}`}>versions are immutable; orders record the exact version. Backtest evidence for the live gate — never a promise (D-03).</span>
      </div>
      {/* robot selector */}
      <div className="flex flex-wrap gap-2">
        {robots.map((r) => (
          <button key={r.id} onClick={() => setRobotId(r.id)}
            className={`rounded-lg border px-3 py-1.5 text-[14px] font-semibold transition-colors ${active.id === r.id ? "border-[#2583FF] bg-[#2583FF]/10 " + c.text : `border-[#253247] bg-[#161F2D] ${c.text2} hover:bg-[#1C2740]`}`}>
            {r.name} <span className={mono + " " + c.text3}>v{r.activeVersion}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
        {/* versions */}
        <div className={`${card} p-4`}>
          <div className={`mb-2 text-[15px] font-semibold`}>Strategy versions — {active.name}</div>
          <div className="fd-scroll max-h-[220px] overflow-y-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className={`text-left text-[12px] uppercase tracking-wide ${c.text3}`}>
                  <th className="py-1.5 pr-2">Ver</th>
                  <th className="py-1.5 pr-2">Edge ≥</th>
                  <th className="py-1.5 pr-2">Tilt</th>
                  <th className="py-1.5 pr-2">Exit</th>
                  <th className="py-1.5 pr-2">Orders</th>
                  <th className="py-1.5 pr-2">Status</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} className={`border-t ${c.border}`}>
                    <td className={`py-1.5 pr-2 font-semibold ${mono}`}>v{v.version}</td>
                    <td className={`py-1.5 pr-2 ${mono}`}>{v.config.minEdgePts} pts</td>
                    <td className={`py-1.5 pr-2 ${mono}`}>{v.config.estimatorTiltPct}%</td>
                    <td className={`py-1.5 pr-2 ${mono}`}>{v.config.exitEdgePts}/{v.config.holdTicksMax}t</td>
                    <td className={`py-1.5 pr-2 ${mono}`}>{v.orderCount}</td>
                    <td className="py-1.5 pr-2">
                      {v.isActive ? <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${c.gain} bg-[#00D69A]/10`}>ACTIVE</span> : <span className={`text-[12px] ${c.text3}`}>—</span>}
                    </td>
                    <td className="py-1.5">
                      {!v.isActive && (
                        <Button size="sm" variant="outline" className={`h-6 border-[#253247] bg-[#161F2D] px-2 text-[12px] ${c.text} hover:bg-[#1C2740]`} disabled={labBusy !== null} onClick={() => activate(v.id)}>
                          Activate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`mt-3 border-t pt-3 ${c.border}`}>
            <div className={`mb-1 text-[13px] ${c.text2}`}>Save the sliders below as a new immutable version (C5):</div>
            <Button size="sm" className="bg-[#2583FF] font-semibold text-[#04101F] hover:bg-[#4C9BFF]" disabled={labBusy !== null} onClick={createVersion}>
              {labBusy === "create" ? "Saving…" : `Save as v${versions.reduce((m, v) => Math.max(m, v.version), 0) + 1}`}
            </Button>
          </div>
        </div>

        {/* backtest */}
        <div className={`${card} p-4`}>
          <div className="mb-2 flex items-center justify-between">
            <div className={`text-[15px] font-semibold`}>Backtest — replay over recorded ticks</div>
            {bt?.dataSource && (
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${bt.dataSource === "SYNTHETIC" ? c.paper + " bg-[#FFB547]/10" : c.gain + " bg-[#00D69A]/10"}`}>
                {bt.dataSource === "SYNTHETIC" ? "SYNTHETIC DATA" : "LIVE DATA"}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <LabSlider label="Entry edge ≥" unit="pts" value={minEdge} setValue={setMinEdge} min={2} max={20} step={1} />
            <LabSlider label="Estimator tilt" unit="%" value={tilt} setValue={setTilt} min={0} max={40} step={5} />
            <LabSlider label="Exit edge <" unit="pts" value={exitEdge} setValue={setExitEdge} min={0} max={8} step={1} />
            <LabSlider label="Max hold" unit="ticks" value={hold} setValue={setHold} min={3} max={60} step={1} />
            <LabSlider label="Slippage" unit="¢" value={slippage} setValue={setSlippage} min={0} max={3} step={1} />
            <LabSlider label="Fee" unit="bps" value={feeBps} setValue={setFeeBps} min={0} max={300} step={50} />
          </div>
          <Button size="sm" className="mt-3 bg-[#2583FF] font-semibold text-[#04101F] hover:bg-[#4C9BFF]" disabled={labBusy !== null} onClick={runBacktest}>
            {labBusy === "backtest" ? "Replaying…" : "Run backtest"}
          </Button>
          {btError && <div className={`mt-2 rounded border px-2.5 py-1.5 text-[13px] ${c.border} ${c.loss}`}>{btError}</div>}

          {bt?.ok && s && bt.params && (
            <div className="mt-3 flex flex-col gap-2">
              <div className={`grid grid-cols-4 gap-2 text-[13px]`}>
                <Stat label="Trades" val={String(s.trades)} />
                <Stat label="Win rate" val={`${s.winRatePct}%`} />
                <Stat label="PnL" val={fmtCents(s.pnlCents)} tone={s.pnlCents >= 0 ? "gain" : "loss"} />
                <Stat label="ROI" val={`${s.roiPct}%`} tone={s.roiPct >= 0 ? "gain" : "loss"} />
                <Stat label="Max DD" val={`${s.maxDrawdownPct}%`} />
                <Stat label="Fees" val={fmtCents(s.feesCents)} />
                <Stat label="Avg edge" val={`${s.avgEdgeAtEntry} pts`} />
                <Stat label="Ticks" val={String(bt.ticks ?? 0)} />
              </div>
              {bt.curve && bt.curve.length > 1 && (
                <div className={`rounded-lg border p-2 ${c.border}`}>
                  <EquityCurve curve={bt.curve} baselineCents={bt.params.simCapitalCents} />
                  <div className={`flex justify-between text-[12px] ${c.text3}`}>
                    <span>sim capital {fmtCents(bt.params.simCapitalCents)}</span>
                    <span>{bt.marketQuestion?.slice(0, 44)}</span>
                  </div>
                </div>
              )}
              {(s.openAtEnd || s.skippedForLiquidity > 0) && (
                <div className={`text-[12.5px] ${c.text3}`}>
                  {s.openAtEnd ? "Position still open at end of data — marked to market, not settled. " : ""}
                  {s.skippedForLiquidity > 0 ? `${s.skippedForLiquidity} ticks skipped (order > 5% of recorded liquidity).` : ""}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LabSlider({ label, unit, value, setValue, min, max, step }: { label: string; unit: string; value: number; setValue: (v: number) => void; min: number; max: number; step: number }) {
  return (
    <div>
      <div className={`flex justify-between text-[13px] ${c.text2}`}>
        <span>{label}</span>
        <span className={mono + " " + c.text}>{value}{unit}</span>
      </div>
      <Slider value={[value]} onValueChange={(v) => setValue(v[0])} min={min} max={max} step={step} className="mt-1.5" />
    </div>
  );
}

function Stat({ label, val, tone }: { label: string; val: string; tone?: "gain" | "loss" }) {
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${c.border}`}>
      <div className={`text-[11.5px] uppercase tracking-wide ${c.text3}`}>{label}</div>
      <div className={`${mono} text-[14px] font-semibold ${tone === "gain" ? c.gain : tone === "loss" ? c.loss : c.text}`}>{val}</div>
    </div>
  );
}

function EquityCurve({ curve, baselineCents }: { curve: CurvePoint[]; baselineCents: number }) {
  const w = 560;
  const h = 120;
  const pad = 6;
  const vals = curve.map((p) => p.equityCents);
  const min = Math.min(...vals, baselineCents);
  const max = Math.max(...vals, baselineCents);
  const span = Math.max(1, max - min);
  const x = (i: number) => pad + (i / (curve.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const path = curve.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.equityCents).toFixed(1)}`).join(" ");
  const up = vals[vals.length - 1] >= baselineCents;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Backtest equity curve">
      <line x1={pad} x2={w - pad} y1={y(baselineCents)} y2={y(baselineCents)} strokeDasharray="4 4" stroke="#253247" strokeWidth="1" />
      <path d={path} fill="none" stroke={up ? "#00D69A" : "#FF5268"} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

// ── Notify dispatcher card — Settings (S-02 / F8, Resend) ────────────────────
export function NotifyCard() {
  const [s, setS] = useState<NotifyStatusDTO | null>(null);
  useEffect(() => {
    fetch("/api/settings/notify")
      .then((r) => safeJson<NotifyStatusDTO>(r))
      .then((j) => setS(j))
      .catch(() => undefined);
  }, []);
  return (
    <div className={`${card} p-4`}>
      <div className="mb-1 flex items-center justify-between">
        <div className={`text-[15px] font-semibold`}>Notification dispatcher — email fan-out (S-02/F8)</div>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${s?.resendConfigured ? `${c.gain} bg-[#00D69A]/10` : `${c.paper} bg-[#FFB547]/10`}`}>
          {s ? (s.resendConfigured ? "RESEND ACTIVE" : "NO KEY — FEED ONLY") : "…"}
        </span>
      </div>
      <div className={`mb-3 text-[13.5px] ${c.text3}`}>
        The transactional outbox drains to the in-app feed first; severity events (risk pause, reconciliation) also page the user by email via Resend when an API key is present. Per-event email status is recorded — nothing is silently dropped.
      </div>
      {s && (
        <div className="grid grid-cols-3 gap-2 text-[13px] sm:grid-cols-4">
          <Stat label="Sent 24h" val={String(s.last24h.sent)} tone="gain" />
          <Stat label="Failed 24h" val={String(s.last24h.failed)} tone={s.last24h.failed > 0 ? "loss" : undefined} />
          <Stat label="No-key 24h" val={String(s.last24h.noKey)} />
          <Stat label="From" val={s.from?.replace(/<.*>/, "").trim() || "—"} />
        </div>
      )}
      {s && !s.resendConfigured && <div className={`mt-2 text-[12.5px] ${c.text2}`}>{s.note}</div>}
    </div>
  );
}

// ── Live trading control — Phase 7 (B10 gates, C25 consent, pilot caps) ──────
// Self-contained: fetches /api/live, exposes the founder actions
// (register wallet, consent record/revoke, pilot enable/caps, robot mode
// flip, B3 sign-off). Every refusal is shown verbatim — the gate's refusals
// are evidence (D-04).
interface LiveCheck { check: string; passed: boolean; detail: string }
interface LiveGateRow {
  robotId: string; robotName: string; mode: string; status: string;
  edge: { ready: boolean; checks: LiveCheck[] } | null;
  exec: LiveCheck[]; ready: boolean; dryRun: boolean;
}
interface LiveState {
  custody: { signerPresent: boolean; address: string | null; fingerprint: string | null; signingModel: string; keyStored: boolean };
  kalshiCred?: { keyPresent: boolean; keyIdFingerprint: string | null; keyType: string | null; credentialModel: string; keyStored: boolean };
  consent: { consented: boolean; phraseEcho: string; recordedAt: string | null; revokedAt: string | null; walletAddress: string | null; consentHash: string | null; note: string | null };
  pilot: { enabled: boolean; maxOrderCents: number; maxTotalNotionalCents: number; venues: string[]; enabledAt: string | null; note: string | null };
  ceilings: { maxOrderCents: number; maxTotalNotionalCents: number; venues: string[] };
  b3: { signedOff: boolean; rows: string; by: string | null; at: string | null };
  gates: LiveGateRow[];
  armSwitch: "SAFE" | "ARMED";
}

export function LiveTradingCard() {
  const [s, setS] = useState<LiveState | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [walletDraft, setWalletDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => fetch("/api/live").then((r) => safeJson<LiveState>(r)).then((j) => setS(j)).catch(() => undefined);
  useEffect(() => { load(); }, []);

  const act = async (body: Record<string, unknown>, method = "POST", url = "/api/live") => {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setMsg(res.ok ? "recorded" : `refused: ${String(j.error ?? res.status)}${Array.isArray(j.blocking) ? ` — ${(j.blocking as Array<{ check: string }>).map((b) => b.check).join(", ")}` : ""}`);
    await load();
  };

  return (
    <div className={`${card} p-4`}>
      <div className="mb-1 flex items-center justify-between">
        <div className={`text-[15px] font-semibold`}>Live trading — gated automation (Phase 7, B10)</div>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${s?.armSwitch === "ARMED" ? `${c.loss} bg-[#FF5268]/10` : `${c.gain} bg-[#00D69A]/10`}`}>
          SEND {s?.armSwitch ?? "…"}
        </span>
      </div>
      <div className={`mb-3 text-[13.5px] ${c.text3}`}>
        First real money passes four gate families: edge evidence (calibration, provenance, clean evidence, backtest, paper session, consent C25), execution (custody, credentials, pilot caps, B3 sign-off, geo), the small-capital pilot caps, and the send switch (env-only: orders are signed + audited but never transmitted while SAFE).
      </div>
      {s && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
            <Stat label="Signer key" val={s.custody.signerPresent ? `injected …${s.custody.fingerprint}` : "none (DRY-RUN only)"} tone={s.custody.signerPresent ? "gain" : undefined} />
            <Stat label="Kalshi key cred" val={s.kalshiCred ? (s.kalshiCred.keyPresent ? `${s.kalshiCred.keyType} …${s.kalshiCred.keyIdFingerprint}` : "none (paper only)") : "…"} tone={s.kalshiCred?.keyPresent ? "gain" : undefined} />
            <Stat label="Consent (C25)" val={s.consent.consented ? "RECORDED" : "absent"} tone={s.consent.consented ? "gain" : undefined} />
            <Stat label="Pilot" val={s.pilot.enabled ? "ENABLED" : "disabled"} tone={s.pilot.enabled ? "gain" : undefined} />
            <Stat label="Counsel (B3)" val={s.b3.signedOff ? `signed off (${s.b3.by})` : "owed"} tone={s.b3.signedOff ? "gain" : undefined} />
          </div>
          <div className={`text-[12.5px] ${c.text2}`}>
            Custody: address-only wallet (B1 — the platform never stores keys; the signer key is env-injected per process and redacted everywhere). Consent hash {s.consent.consentHash ? `${s.consent.consentHash.slice(0, 16)}…` : "—"}{s.consent.revokedAt ? ` · REVOKED ${s.consent.revokedAt}` : ""}. Pilot caps: ≤{s.pilot.maxOrderCents}¢/order, ≤{s.pilot.maxTotalNotionalCents}¢ total (ceilings {s.ceilings.maxOrderCents}¢ / {s.ceilings.maxTotalNotionalCents}¢), venues {s.pilot.venues.join("/")}.
            {" "}
            Kalshi carries the platform's SECOND credential kind — an asymmetric API key (RSA-PSS/SHA-256 or Ed25519, pre-sign text "timestamp+METHOD+path"), env-injected via KALSHI_API_KEY_ID / KALSHI_PRIVATE_KEY, never stored ({s.kalshiCred?.credentialModel ?? "KALSHI_ASYMMETRIC_API_KEY"}, keyStored false).
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="flex gap-2">
              <Input placeholder="0x… wallet address (registered address-only)" value={walletDraft} onChange={(e) => setWalletDraft(e.target.value)} className={`h-8 border-[#253247] bg-[#161F2D] text-[14px] ${c.text}`} />
              <Button size="sm" variant="outline" className={`border-[#253247] bg-[#161F2D] text-[#E8EDF5] text-[13px] hover:bg-[#1C2740]`} disabled={!/^0x[a-fA-F0-9]{40}$/.test(walletDraft)}
                onClick={() => act({ action: "REGISTER_WALLET", address: walletDraft }).then(() => setWalletDraft(""))}>
                Register wallet
              </Button>
            </div>
            <div className="flex gap-2">
              <Input placeholder={`type "${s.consent.phraseEcho}"`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className={`h-8 border-[#253247] bg-[#161F2D] text-[14px] ${c.text}`} />
              {s.consent.consented ? (
                <Button size="sm" variant="outline" className={`border-[#FF5268]/50 bg-[#FF5268]/10 ${c.loss} text-[13px] hover:bg-[#FF5268]/20`} onClick={() => act({}, "DELETE", "/api/consent")}>
                  Revoke consent
                </Button>
              ) : (
                <Button size="sm" variant="outline" className={`border-[#253247] bg-[#161F2D] text-[#E8EDF5] text-[13px] hover:bg-[#1C2740]`} disabled={confirmText !== s.consent.phraseEcho}
                  onClick={() => act({ confirm: confirmText, walletAddress: walletDraft || s.custody.address, capsAcknowledged: true }, "POST", "/api/consent").then(() => setConfirmText(""))}>
                  Record consent
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className={`border-[#253247] bg-[#161F2D] text-[#E8EDF5] text-[13px] hover:bg-[#1C2740]`} disabled={s.pilot.enabled || !s.consent.consented} onClick={() => act({ action: "ENABLE_PILOT" })}>
              Enable pilot
            </Button>
            <Button size="sm" variant="outline" className={`border-[#253247] bg-[#161F2D] text-[#E8EDF5] text-[13px] hover:bg-[#1C2740]`} disabled={!s.pilot.enabled} onClick={() => act({ action: "DISABLE_PILOT" })}>
              Disable pilot
            </Button>
          </div>
          {msg && <div className={`text-[12.5px] ${msg.startsWith("refused") ? c.loss : c.gain}`}>{msg}</div>}

          <div className={`mt-1 text-[14px] font-semibold ${c.text}`}>Per-robot live gate (Polymarket robots)</div>
          <div className="fd-scroll flex max-h-[260px] flex-col gap-2 overflow-y-auto">
            {s.gates.map((g) => {
              const blocking = [...(g.edge?.checks ?? []).filter((x) => !x.passed), ...g.exec.filter((x) => !x.passed)];
              return (
                <div key={g.robotId} className={`rounded-lg border p-2.5 ${c.border}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[14px] font-semibold ${c.text}`}>{g.robotName}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${g.mode === "LIVE_PILOT" ? `${c.loss} bg-[#FF5268]/10` : `${c.paper} bg-[#FFB547]/10`}`}>{g.mode}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${g.ready ? `${c.gain} bg-[#00D69A]/10` : `${c.text3} bg-[#1C2740]`}`}>{g.ready ? "GATE READY" : `GATE CLOSED (${blocking.length})`}</span>
                    {g.dryRun && g.ready && <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${c.paper} bg-[#FFB547]/10`}>DRY-RUN (send SAFE)</span>}
                  </div>
                  {blocking.length > 0 && (
                    <div className="mt-1.5 flex flex-col gap-0.5">
                      {blocking.map((x) => (
                        <div key={x.check} className={`text-[12px] ${c.text3}`}><span className={c.loss}>{x.check}</span> — {x.detail}</div>
                      ))}
                    </div>
                  )}
                  {blocking.length === 0 && g.mode !== "LIVE_PILOT" && (
                    <Button size="sm" variant="outline" className={`mt-1.5 border-[#253247] bg-[#161F2D] text-[#E8EDF5] text-[12.5px] hover:bg-[#1C2740]`} onClick={() => act({ action: "SET_ROBOT_MODE", robotId: g.robotId, mode: "LIVE_PILOT" })}>
                      Flip to LIVE_PILOT
                    </Button>
                  )}
                  {g.mode === "LIVE_PILOT" && (
                    <Button size="sm" variant="outline" className={`mt-1.5 border-[#253247] bg-[#161F2D] text-[#E8EDF5] text-[12.5px] hover:bg-[#1C2740]`} onClick={() => act({ action: "SET_ROBOT_MODE", robotId: g.robotId, mode: "PAPER" })}>
                      Back to paper
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Phase 8 — commercial platform cards (P-04 / P-06 / P-07 / P-08) ─────────

interface TaxonomyRow { family: string; delivered: number; suppressed: number; policy: { severity: string; dedupeWindowSec: number; hourlyCap: number; digest: boolean } }
interface NotificationsDTO {
  windowSec: number;
  feed: Array<{ id: string; severity: string; family: string; title: string; body: string; createdAt: string }>;
  digest: Array<{ family: string; count: number; latestTitle: string; latestAt: string }>;
  suppressedCount: number;
  byFamily: TaxonomyRow[];
}

// P-04 — notification taxonomy + anti-storm: one writer, honest suppression
// counts, read-time digest. CRITICAL never capped (kill-switch breaks through).
export function NotificationsCard() {
  const [d, setD] = useState<NotificationsDTO | null>(null);
  useEffect(() => {
    const load = () => fetch("/api/notifications?windowSec=86400").then((r) => safeJson<NotificationsDTO>(r)).then((j) => j && setD(j)).catch(() => undefined);
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={`${card} p-4`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className={`text-[15px] font-semibold`}>Notification taxonomy & anti-storm (P-04)</div>
        {d && <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${c.text3} bg-[#161F2D]`}>last 24h · {d.suppressedCount} absorbed</span>}
      </div>
      <div className={`mb-3 text-[13.5px] ${c.text3}`}>
        Every notification goes through one taxonomy (family → severity, dedupe window, hourly cap, digest policy). CRITICAL is never capped — a kill-switch event always breaks through. Suppressed repeats are RECORDED (never silently dropped) and counted here.
      </div>
      {!d && <div className={`py-3 text-center text-[14px] ${c.text3}`}>Loading taxonomy…</div>}
      {d && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 text-[13px] md:grid-cols-4">
            {d.byFamily.map((f) => (
              <div key={f.family} className={`rounded-lg border p-2.5 ${c.border}`}>
                <div className={`text-[12.5px] font-semibold ${c.text}`}>{f.family}</div>
                <div className={`mt-1 flex flex-wrap gap-x-2 text-[11.5px] ${c.text3}`}>
                  <span>delivered {f.delivered}</span>
                  <span>absorbed {f.suppressed}</span>
                  <span>{f.policy.severity.toLowerCase()}</span>
                  <span>{f.policy.dedupeWindowSec > 0 ? `dedupe ${f.policy.dedupeWindowSec}s` : "no dedupe"}</span>
                  <span>{f.policy.hourlyCap > 0 ? `cap ${f.policy.hourlyCap}/h` : "uncapped"}</span>
                  <span>{f.policy.digest ? "digest" : "immediate"}</span>
                </div>
              </div>
            ))}
          </div>
          {d.digest.length > 0 && (
            <div className={`rounded-lg border p-2.5 text-[13px] ${c.border}`}>
              <div className={`mb-1 text-[11.5px] uppercase tracking-wide ${c.text3}`}>DIGESTED (grouped at read time)</div>
              {d.digest.map((g) => (
                <div key={g.family} className={`flex justify-between ${c.text2}`}>
                  <span>{g.family} × {g.count}</span>
                  <span className={`text-[12px] ${c.text3}`}>{g.latestTitle}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ApiKeyRow { id: string; name: string; prefix: string; scope: string; status: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }

// P-06 — export + read-only API keys. Plaintext shown ONCE at creation.
export function ApiKeysCard() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [name, setName] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/keys").then((r) => safeJson<{ keys: ApiKeyRow[] }>(r)).then((j) => j && setKeys(j.keys)).catch(() => undefined);
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const j = await res.json();
      if (j?.key?.plaintext) setPlaintext(j.key.plaintext);
      setName("");
      load();
    } finally { setBusy(false); }
  };
  const revoke = async (keyId: string) => {
    await fetch("/api/keys", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ keyId }) });
    load();
  };

  return (
    <div className={`${card} p-4`}>
      <div className="mb-1 text-[15px] font-semibold">Export & read-only API keys (P-06)</div>
      <div className={`mb-3 text-[13.5px] ${c.text3}`}>
        Export your data (robots, orders, ledger, positions, traces — JSON/CSV, venue-labeled per B11). API keys are READ-ONLY by design: they authenticate /api/public/v1/* reads, no write surface exists. Plaintext is shown once and only its SHA-256 hash is stored (S-08 posture). Rate limit 60 req/min per key.
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className={`h-8 border-[#253247] bg-[#161F2D] text-[13px] hover:bg-[#1C2740]`} onClick={() => window.open("/api/export?entity=all&format=json", "_blank")}>Export all (JSON)</Button>
        <Button size="sm" variant="outline" className={`h-8 border-[#253247] bg-[#161F2D] text-[13px] hover:bg-[#1C2740]`} onClick={() => window.open("/api/export?entity=ledger&format=csv", "_blank")}>Export ledger (CSV)</Button>
        <Button size="sm" variant="outline" className={`h-8 border-[#253247] bg-[#161F2D] text-[13px] hover:bg-[#1C2740]`} onClick={() => window.open("/api/export?entity=orders&format=csv", "_blank")}>Export orders (CSV)</Button>
      </div>
      <div className="mb-3 flex gap-2">
        <Input placeholder="key name (e.g. grafana-read)" value={name} onChange={(e) => setName(e.target.value)} className={`h-8 border-[#253247] bg-[#161F2D] text-[14px] ${c.text}`} />
        <Button size="sm" variant="outline" className={`h-8 border-[#253247] bg-[#161F2D] text-[13px] hover:bg-[#1C2740]`} disabled={busy} onClick={create}>Create key</Button>
      </div>
      {plaintext && (
        <div className={`mb-3 rounded-lg border border-[#FFB547]/40 bg-[#FFB547]/10 p-2.5 text-[13px] ${c.warn}`}>
          <div className="mb-1 font-semibold">Copy it now — this is shown ONCE and cannot be recovered:</div>
          <div className={`${mono} break-all text-[13px]`}>{plaintext}</div>
          <button className={`mt-1 text-[12px] underline ${c.text3}`} onClick={() => setPlaintext(null)}>dismiss</button>
        </div>
      )}
      {!keys && <div className={`py-2 text-center text-[14px] ${c.text3}`}>Loading keys…</div>}
      {keys && keys.length === 0 && <div className={`text-[13.5px] ${c.text3}`}>No API keys yet — create one above, then call /api/public/v1/robots with `Authorization: Bearer &lt;key&gt;`.</div>}
      {keys && keys.length > 0 && (
        <div className="flex flex-col gap-2">
          {keys.map((k) => (
            <div key={k.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-[13px] ${c.border}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${k.status === "ACTIVE" ? `${c.gain} bg-[#00D69A]/10` : `${c.loss} bg-[#FF5268]/10`}`}>{k.status}</span>
                <span className={`font-semibold ${c.text}`}>{k.name}</span>
                <span className={`${mono} ${c.text2}`}>{k.prefix}…</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${c.text3} bg-[#161F2D]`}>{k.scope}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[11.5px] ${c.text3}`}>{k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleString()}` : "never used"}</span>
                {k.status === "ACTIVE" && (
                  <Button size="sm" variant="outline" className={`h-7 border-[#FF5268]/40 bg-[#161F2D] px-2 text-[12.5px] text-[#FF5268] hover:bg-[#2A1A22]`} onClick={() => revoke(k.id)}>Revoke</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface RetentionPolicy { key: string; label: string; days: number; bounds: { min: number; max: number } }
interface ComplianceDTO {
  policies: RetentionPolicy[];
  wouldPrune: { ticks: number; traces: number; notifications: number; outboxFailed: number };
  runs: Array<{ id: string; kind: string; pruned: Record<string, number>; ranAt: string }>;
  preservedNote: string;
}

// P-07 — compliance ops: retention policies (ephemeral data only — financial
// truth is never pruned) + manual run, every run audited (RetentionRun).
export function ComplianceCard() {
  const [d, setD] = useState<ComplianceDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/compliance").then((r) => safeJson<ComplianceDTO>(r)).then((j) => j && setD(j)).catch(() => undefined);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setDays = async (key: string, days: number) => {
    await fetch("/api/compliance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "SET_RETENTION", key, days }) });
    load();
  };
  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/compliance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "RUN_RETENTION", kind: "MANUAL" }) });
      const j = await res.json();
      if (j?.ok) {
        const r = j.result;
        setMsg(`Ran ${new Date(r.ranAt).toLocaleTimeString()}: ticks ${r.ticks} · traces ${r.traces} · notifications ${r.notifications} · failed outbox ${r.outboxFailed} — financial truth untouched.`);
      }
      load();
    } finally { setBusy(false); }
  };

  return (
    <div className={`${card} p-4`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className={`text-[15px] font-semibold`}>Compliance ops — data retention (P-07)</div>
        <Button size="sm" variant="outline" className={`h-8 border-[#253247] bg-[#161F2D] text-[13px] hover:bg-[#1C2740]`} disabled={busy} onClick={run}>{busy ? "Running…" : "Run retention now"}</Button>
      </div>
      <div className={`mb-3 text-[13.5px] ${c.text3}`}>
        Ephemeral operational data is pruned after its window; financial truth (ledger, orders, fills, positions, reconciliation, retention runs) is NEVER pruned — append-only is the product. Every run is audited (RetentionRun) and notified (COMPLIANCE).
      </div>
      {!d && <div className={`py-2 text-center text-[14px] ${c.text3}`}>Loading policies…</div>}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {d.policies.map((p) => (
              <div key={p.key} className={`rounded-lg border p-2.5 ${c.border}`}>
                <div className={`text-[12.5px] font-semibold ${c.text}`}>{p.label}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Input type="number" min={p.bounds.min} max={p.bounds.max} defaultValue={p.days}
                    onBlur={(e) => { const v = Number(e.target.value); if (v && v !== p.days) setDays(p.key, v); }}
                    className={`h-7 w-20 border-[#253247] bg-[#161F2D] text-[14px] ${c.text}`} />
                  <span className={`text-[12px] ${c.text3}`}>days ({p.bounds.min}–{p.bounds.max})</span>
                </div>
              </div>
            ))}
          </div>
          <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] ${c.text2}`}>
            <span>would prune today: ticks {d.wouldPrune.ticks}</span>
            <span>traces {d.wouldPrune.traces}</span>
            <span>notifications {d.wouldPrune.notifications}</span>
            <span>failed outbox {d.wouldPrune.outboxFailed}</span>
          </div>
          {msg && <div className={`mt-2 rounded-lg border border-[#00D69A]/30 bg-[#00D69A]/10 p-2 text-[13px] ${c.gain}`}>{msg}</div>}
          {d.runs.length > 0 && (
            <div className={`mt-2 text-[12.5px] ${c.text3}`}>
              Last run {new Date(d.runs[0].ranAt).toLocaleString()} ({d.runs[0].kind.toLowerCase()}) — {d.runs.length} run{d.runs.length === 1 ? "" : "s"} audited.
            </div>
          )}
          <div className={`mt-1 text-[12px] ${c.text3}`}>{d.preservedNote}</div>
        </>
      )}
    </div>
  );
}

interface MetricsDTO {
  robots: { total: number; byStatus: Record<string, number>; byVenue: Record<string, number>; livePilot: number };
  orders24h: { total: number; byState: Record<string, number>; fills: number; feesCents: number };
  ledger: { entries: number; paperBalanceCents: number };
  markets: { total: number; ambiguous: number; freshness: Array<{ venue: string; label: string; adapter: string; markets: number; lastSyncMinAgo: number | null }> };
  notifications24h: { delivered: number; suppressed: number };
  outbox: { pending: number; failed24h: number; dispatched24h: number; dispatchLagP50Ms: number | null; dispatchLagP95Ms: number | null };
  ai: { calls24h: number; failed24h: number; blocked24h: number; cacheEntries: number };
  apiKeys: { active: number; revoked: number; usedLast24h: number };
  decisions: { traces24h: number; trades24h: number; noTrades24h: number };
  compliance: { retentionRuns: number; lastRetentionRanAt: string | null };
}

// P-08 — platform metrics: one honest operational snapshot.
export function MetricsCard() {
  const [m, setM] = useState<MetricsDTO | null>(null);
  useEffect(() => {
    const load = () => fetch("/api/metrics").then((r) => safeJson<{ metrics: MetricsDTO }>(r)).then((j) => j && setM(j.metrics)).catch(() => undefined);
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={`${card} p-4`}>
      <div className="mb-1 text-[15px] font-semibold">Platform metrics (P-08)</div>
      <div className={`mb-3 text-[13.5px] ${c.text3}`}>Operational snapshot — robots, orders, sync freshness per venue, notification anti-storm, outbox dispatch lag, AI governance. Null means the platform does not record that number — no invented precision (D-03).</div>
      {!m && <div className={`py-2 text-center text-[14px] ${c.text3}`}>Loading metrics…</div>}
      {m && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2 text-[13px] md:grid-cols-6">
            <Stat label="Robots" val={String(m.robots.total)} />
            <Stat label="Live-pilot" val={String(m.robots.livePilot)} tone={m.robots.livePilot > 0 ? "gain" : undefined} />
            <Stat label="Orders 24h" val={String(m.orders24h.total)} />
            <Stat label="Fills 24h" val={String(m.orders24h.fills)} />
            <Stat label="Fees 24h" val={fmtCents(m.orders24h.feesCents)} />
            <Stat label="Paper balance" val={fmtCents(m.ledger.paperBalanceCents)} />
            <Stat label="Markets" val={String(m.markets.total)} />
            <Stat label="Ambiguous" val={String(m.markets.ambiguous)} tone={m.markets.ambiguous > 0 ? "loss" : undefined} />
            <Stat label="Traces 24h" val={String(m.decisions.traces24h)} />
            <Stat label="Trades 24h" val={String(m.decisions.trades24h)} />
            <Stat label="Outbox pending" val={String(m.outbox.pending)} tone={m.outbox.pending > 50 ? "loss" : undefined} />
            <Stat label="Outbox p95 lag" val={m.outbox.dispatchLagP95Ms != null ? `${m.outbox.dispatchLagP95Ms}ms` : "—"} />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className={`text-[11.5px] uppercase tracking-wide ${c.text3}`}>SYNC FRESHNESS PER VENUE (B11)</div>
            {m.markets.freshness.map((f) => (
              <div key={f.venue} className={`flex flex-wrap items-center justify-between gap-2 text-[13px] ${c.text2}`}>
                <span className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${f.adapter === "LIVE" ? "bg-[#00D69A]" : "bg-[#55617E]"}`} />
                  {f.label}
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${c.text3} bg-[#161F2D]`}>{f.adapter}</span>
                </span>
                <span className={mono}>
                  {f.markets} market{f.markets === 1 ? "" : "s"} · {f.lastSyncMinAgo != null ? `last sync ${f.lastSyncMinAgo}m ago` : "never synced"}
                </span>
              </div>
            ))}
          </div>
          <div className={`flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] ${c.text2}`}>
            <span>notifications 24h: {m.notifications24h.delivered} delivered / {m.notifications24h.suppressed} absorbed</span>
            <span>AI 24h: {m.ai.calls24h} calls · {m.ai.failed24h} failed · {m.ai.blocked24h} budget-blocked</span>
            <span>API keys: {m.apiKeys.active} active / {m.apiKeys.revoked} revoked</span>
            <span>retention runs: {m.compliance.retentionRuns}</span>
          </div>
        </div>
      )}
    </div>
  );
}
