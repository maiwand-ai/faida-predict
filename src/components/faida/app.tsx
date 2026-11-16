"use client";

// FAIDA Predict — walking skeleton UI. Single page, five views, brand-blue.
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type DashboardDTO,
  type MarketDTO,
  type OrderRowDTO,
  type LedgerRowDTO,
  type RiskViewDTO,
  type EligibilityRuleDTO,
  FAMILIES,
  FAMILY_LABEL,
} from "./types";
import { c, card, mono, fmtCents, Pill, Meter, SectionTitle } from "./ui";
import { StudioView, TradingView, SettingsView } from "./views";

// Tolerant JSON parse — a transient empty body (dev recompile race, network
// hiccup) must never surface as an uncaught promise rejection (D-07).
async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── overview-local helpers ──────────────────────────────────────────────

// ── main app ─────────────────────────────────────────────────────────────────
type View = "overview" | "markets" | "studio" | "trading" | "settings";

export default function FaidaApp() {
  const { toast } = useToast();
  const [view, setView] = useState<View>("overview");
  const [dash, setDash] = useState<DashboardDTO | null>(null);
  const [markets, setMarkets] = useState<MarketDTO[]>([]);
  const [ordersData, setOrdersData] = useState<{ orders: OrderRowDTO[]; ledger: LedgerRowDTO[] } | null>(null);
  const [riskView, setRiskView] = useState<RiskViewDTO | null>(null);
  const [eligibility, setEligibility] = useState<EligibilityRuleDTO[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [tradeMarket, setTradeMarket] = useState<MarketDTO | null>(null);

  const refreshDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      if (res.ok) setDash(await safeJson<DashboardDTO>(res));
    } catch { /* transient — next poll recovers */ }
  }, []);
  const refreshMarkets = useCallback(async () => {
    try {
      const res = await fetch("/api/markets");
      const json = res.ok ? await safeJson<{ markets: MarketDTO[] }>(res) : null;
      if (json?.markets) setMarkets(json.markets);
    } catch { /* transient */ }
  }, []);
  const refreshOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/orders");
      if (res.ok) setOrdersData(await safeJson<{ orders: OrderRowDTO[]; ledger: LedgerRowDTO[] }>(res));
    } catch { /* transient */ }
  }, []);
  const refreshRisk = useCallback(async () => {
    try {
      const res = await fetch("/api/risk");
      if (res.ok) setRiskView(await safeJson<RiskViewDTO>(res));
    } catch { /* transient */ }
  }, []);
  const refreshEligibility = useCallback(async () => {
    try {
      const res = await fetch("/api/eligibility");
      const json = res.ok ? await safeJson<{ rules: EligibilityRuleDTO[] }>(res) : null;
      if (json?.rules) setEligibility(json.rules);
    } catch { /* transient */ }
  }, []);

  useEffect(() => {
    refreshDashboard();
    refreshMarkets();
    refreshOrders();
    const t = setInterval(refreshDashboard, 15000);
    return () => clearInterval(t);
  }, [refreshDashboard, refreshMarkets, refreshOrders]);

  const post = useCallback(
    async (url: string, body: unknown, okMsg: string) => {
      setBusy(url + JSON.stringify(body).slice(0, 40));
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const json = await safeJson<Record<string, unknown>>(res);
        if (!json) {
          toast({ title: "Refused", description: "Empty response — try again", variant: "destructive" });
          return;
        }
        if (res.ok && (json.ok === undefined || json.ok)) {
          toast({ title: okMsg, description: typeof json === "object" ? summarize(json) : "" });
        } else {
          toast({ title: "Refused", description: String(json.error ?? json.reason ?? "unknown"), variant: "destructive" });
        }
        return json;
      } finally {
        setBusy(null);
        await Promise.all([refreshDashboard(), refreshOrders()]);
      }
    },
    [toast, refreshDashboard, refreshOrders],
  );

  const syncMarkets = async () => {
    setBusy("sync");
    try {
      const res = await fetch("/api/markets", { method: "POST" });
      const json = await safeJson<{ synced: number; totalMarkets: number }>(res);
      if (!json) {
        toast({ title: "Polymarket unreachable from sandbox", description: "Empty response — showing cached markets", variant: "destructive" });
        return;
      }
      if (json.synced > 0) {
        toast({ title: `Synced ${json.synced} live markets from Polymarket`, description: `${json.totalMarkets} total cached` });
      } else {
        toast({ title: "Polymarket unreachable from sandbox", description: "Showing cached/seeded markets — source labeled honestly per D-03", variant: "destructive" });
      }
      await refreshMarkets();
    } finally {
      setBusy(null);
    }
  };

  const hasUnknown = (ordersData?.orders ?? []).some((o) => o.state === "UNKNOWN" || o.state === "RECONCILING");

  const navItems: Array<{ id: View; label: string; badge?: string }> = [
    { id: "overview", label: "Overview" },
    { id: "markets", label: "Markets" },
    { id: "studio", label: "Robot Studio" },
    { id: "trading", label: "Trading" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className={`min-h-screen ${c.bg} ${c.text} flex flex-col`} style={{ fontFamily: "var(--font-geist-sans)" }}>
      <div className="flex flex-1">
        {/* ── Sidebar ─────────────────────────────────────────── */}
        <aside className={`sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col ${c.surface} border-r ${c.border} px-3 py-4 md:flex`}>
          <div className="mb-5 flex items-center gap-2.5 px-2">
            <Image src="/brand/logo_mark.png" alt="FAIDA Predict mark" width={32} height={32} className="object-contain" />
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-[14px] font-bold tracking-wide ${c.text}`}>FAIDA</span>
                <span className={`text-[9px] font-bold tracking-[0.2em] ${c.bright}`}>PREDICT</span>
              </div>
              <div className={`mt-0.5 text-[9px] tracking-[0.15em] ${c.text3}`}>WALKING SKELETON</div>
            </div>
          </div>
          <nav className="flex flex-col gap-1">
            {navItems.map((n) => (
              <button
                key={n.id}
                onClick={() => { setView(n.id); if (n.id === "settings") { refreshRisk(); refreshEligibility(); } if (n.id === "trading") refreshOrders(); }}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                  view === n.id ? `${c.elevated} ${c.text}` : `${c.text2} hover:${c.elevated}`
                }`}
              >
                <span className={`h-2 w-2 rounded-[3px] ${view === n.id ? "bg-[#00B0F0]" : "bg-[#2E3C5F]"}`} />
                {n.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto border-t ${c.border} pt-3" style={{ borderColor: "#202B45" }}>
            <div className={`flex justify-between px-2 text-[10.5px] ${c.text3}`}>
              <span>● Venue: Polymarket</span><span className={mono}>data {dash?.marketCount ?? 0}</span>
            </div>
            <div className={`mt-1 flex justify-between px-2 text-[10.5px] ${c.text3}`}>
              <span>Mode</span><span className={`${c.paper}`}>PAPER ONLY</span>
            </div>
            <div className={`mt-1 flex justify-between px-2 text-[10.5px] ${c.text3}`}>
              <span>Outbox pending</span><span className={mono}>{dash?.outboxPending ?? 0}</span>
            </div>
          </div>
        </aside>

        {/* ── Main ─────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className={`sticky top-0 z-10 flex h-14 items-center gap-3 border-b ${c.border} ${c.surface} px-5`}>
            <div className={`hidden items-center rounded-lg border px-3 py-1.5 text-[12px] ${c.border} ${c.elevated} ${c.text3} sm:flex`}>
              Search markets, robots, orders…
              <span className={`ml-8 rounded border px-1.5 py-0.5 text-[10px] ${c.borderStrong}`}>⌘K</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className={`hidden items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] ${c.border} ${c.elevated} ${c.text2} lg:inline-flex`}>
                <span className={c.bright}>●</span> Location verified: {dash?.user.country ?? "NL"} (matrix)
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] border-[#D9B25C]/40 bg-[#D9B25C]/10 ${c.paper} font-semibold`}>
                ◇ PAPER — live trading gated (Phase 7)
              </span>
              <div className={`h-7 w-7 rounded-full ${c.elevated} border ${c.borderStrong}`} />
            </div>
          </div>

          <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-5 sm:px-6">
            {view === "overview" && (
              <OverviewView dash={dash} markets={markets} onSync={syncMarkets} busy={busy} onCycle={() => post("/api/cycle", {}, "Robot cycle executed")} onReconcile={() => post("/api/cycle", { action: "RECONCILE" }, "Reconciliation pass complete")} hasUnknown={hasUnknown} />
            )}
            {view === "markets" && (
              <MarketsView markets={markets} onSync={syncMarkets} busy={busy} onTrade={(m) => setTradeMarket(m)} />
            )}
            {view === "studio" && (
              <StudioView dash={dash} onCreate={(payload) => post("/api/robots", payload, "Robot created as PAPER_ONLY draft")} />
            )}
            {view === "trading" && (
              <TradingView
                markets={markets}
                ordersData={ordersData}
                busy={busy}
                onPlace={(payload) => post("/api/orders", payload, "Paper order filled")}
                onSimulateAckLoss={(marketId) => post("/api/orders", { action: "SIMULATE_ACK_LOSS", marketId }, "Synthetic order lost venue ack → UNKNOWN")}
                onReconcile={() => post("/api/cycle", { action: "RECONCILE" }, "Reconciliation pass complete")}
                hasUnknown={hasUnknown}
                onTradeSomething={() => setView("markets")}
              />
            )}
            {view === "settings" && (
              <SettingsView
                dash={dash}
                riskView={riskView}
                eligibility={eligibility}
                onSaveRisk={async (key, value) => {
                  await fetch("/api/risk", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, value }) });
                  toast({ title: "Risk limit updated", description: `${key} → clamped to platform max if looser` });
                  refreshRisk(); refreshDashboard();
                }}
                onSaveProvider={async (payload) => {
                  const res = await fetch("/api/settings/ai", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
                  const json = await safeJson<{ ok?: boolean; error?: string }>(res);
                  if (res.ok && json?.ok) toast({ title: "AI provider saved" });
                  else toast({ title: "Refused", description: String(json?.error ?? "empty response"), variant: "destructive" });
                  refreshDashboard();
                }}
                onFlipCountry={async (country, allowed) => {
                  const res = await fetch("/api/eligibility", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ country, allowed }) });
                  const json = await safeJson<{ ok?: boolean; error?: string }>(res);
                  if (res.ok && json?.ok) toast({ title: `${country} ${allowed ? "allowed" : "blocked"}` });
                  else toast({ title: "Refused", description: String(json?.error ?? "empty response"), variant: "destructive" });
                  refreshEligibility();
                }}
                onOpenRisk={() => { refreshRisk(); }}
              />
            )}
          </main>
          <footer className={`border-t ${c.border} px-6 py-3 text-center text-[11px] ${c.text3}`}>
            FAIDA Predict walking skeleton — Phase 1 (R-03). All figures paper-labeled per D-03/D-05. Live trading requires Phase 7 gates + explicit authorization.
          </footer>
        </div>
      </div>

      {/* trade dialog — key remount resets the form per market (no effect needed) */}
      <TradeDialog key={tradeMarket?.id ?? "closed"} market={tradeMarket} onClose={() => setTradeMarket(null)} onPlace={(p) => post("/api/orders", p, "Paper order filled")} busy={busy} />
    </div>
  );
}

function summarize(json: Record<string, unknown>): string {
  if (json.summaries) {
    const arr = json.summaries as Array<{ robotName: string; decision: string; reason: string }>;
    return arr.map((s) => `${s.robotName}: ${s.decision} — ${s.reason.slice(0, 90)}`).join("\n").slice(0, 300);
  }
  if (json.results) return `${(json.results as unknown[]).length} reconciliation result(s)`;
  if (json.state) {
    const orderId = json.orderId as string | undefined;
    return `order ${orderId?.slice(-6) ?? ""} → ${json.state}${json.duplicate ? " (idempotent replay)" : ""}`;
  }
  if (json.robot) return `status ${(json.robot as { status?: string }).status ?? ""}`;
  return "";
}

// ── Overview ─────────────────────────────────────────────────────────────────
function OverviewView(props: {
  dash: DashboardDTO | null;
  markets: MarketDTO[];
  onSync: () => void;
  onCycle: () => void;
  onReconcile: () => void;
  hasUnknown: boolean;
  busy: string | null;
}) {
  const { dash, onCycle, onReconcile, hasUnknown, onSync } = props;
  if (!dash) return <SkeletonPage />;
  const exposurePct = dash.allocatedCents > 0 ? (dash.exposureCents / dash.allocatedCents) * 100 : 0;
  const aiProvider = dash.providers.find((p) => p.enabled) ?? dash.providers[0];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-semibold">Overview</h1>
        <span className={`text-[12px] ${c.text3}`}>all values labeled SIMULATED / PAPER — nothing here is live money</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" className={`${c.borderStrong} ${c.elevated} ${c.text} hover:bg-[#1B2540]`} onClick={onSync} disabled={props.busy === "sync"}>
            {props.busy === "sync" ? "Syncing…" : "Sync markets"}
          </Button>
          <Button size="sm" className="bg-[#00B0F0] font-semibold text-[#001040] hover:bg-[#2FC1F5]" onClick={onCycle} disabled={props.busy !== null}>
            Run robot cycle
          </Button>
        </div>
      </div>

      {/* KPI band */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="PAPER BALANCE" value={fmtCents(dash.balanceCents)} tag="SIMULATED" />
        <Kpi label="TOTAL EXPOSURE" value={fmtCents(dash.exposureCents)} tag="OPEN POSITIONS" meter={{ pct: exposurePct, detail: `${dash.exposureLimitPct}% per-event cap in effect` }} />
        <Kpi label="TODAY NET FLOW" value={fmtCents(dash.todayFlowCents)} tag="PAPER LEDGER" tone={dash.todayFlowCents < 0 ? "loss" : "gain"} />
        <Kpi label="ROBOTS" value={`${dash.robots.filter((r) => ["RUNNING", "PAPER_ONLY"].includes(r.status)).length} active · ${dash.robots.filter((r) => r.status.startsWith("PAUSED")).length} paused`} tag={`${dash.marketCount} LIVE MARKETS`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* robots */}
        <div className="lg:col-span-2">
          <SectionTitle>Robots — {dash.robots.filter((r) => r.status === "PAPER_ONLY").length} paper · {dash.robots.filter((r) => r.status.startsWith("PAUSED")).length} paused</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {dash.robots.map((r) => (
              <div key={r.id} className={`${card} p-4`}>
                <div className="flex items-center justify-between">
                  <Pill status={r.status} />
                  <span className={`text-[10px] ${c.text3}`}>v{r.activeVersion}</span>
                </div>
                <div className="mt-2 text-[13px] font-semibold">{r.name}</div>
                <div className={`text-[11px] ${c.text3}`}>{FAMILY_LABEL[r.family] ?? r.family}</div>
                <div className={`mt-2 border-t ${c.border} pt-2 text-[11px] ${c.text2}`}>
                  <span className={mono}>alloc {fmtCents(r.allocatedCents)}</span>
                  <span className={`ml-3 ${mono}`}>pos cap {fmtCents(r.maxPositionCents)}</span>
                  <span className={`ml-3 ${mono}`}>open ≤ {r.maxOpenPositions}</span>
                </div>
                {r.statusReason && <div className={`mt-1.5 text-[10.5px] ${c.warn}`}>{r.statusReason}</div>}
              </div>
            ))}
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

      {/* decision traces */}
      <div className={card}>
        <div className="p-4 pb-2"><SectionTitle>Decision traces — every robot decision, trade or no-trade (A-08)</SectionTitle></div>
        <div className="flex flex-col px-4 pb-4">
          {dash.traces.slice(0, 5).map((t) => (
            <div key={t.id} className={`border-b py-2.5 last:border-0 ${c.border}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${t.decision === "TRADE" ? `${c.bright} bg-[#00B0F0]/10` : `${c.text3} bg-[#151D30]`}`}>{t.decision}</span>
                <span className={`text-[12px] font-semibold ${c.text}`}>{t.robot?.name}</span>
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

function SkeletonPage() {
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

// ── Markets ──────────────────────────────────────────────────────────────────
function MarketsView({ markets, onSync, onTrade, busy }: { markets: MarketDTO[]; onSync: () => void; onTrade: (m: MarketDTO) => void; busy: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-semibold">Market discovery</h1>
        <span className={`text-[12px] ${c.text3}`}>live Polymarket data via the venue adapter — read-only (S-05: MARKET_DATA_ONLY)</span>
        <Button size="sm" className="ml-auto bg-[#00B0F0] font-semibold text-[#001040] hover:bg-[#2FC1F5]" onClick={onSync} disabled={busy === "sync"}>
          {busy === "sync" ? "Syncing…" : "Sync from Polymarket"}
        </Button>
      </div>
      <div className={`${card} overflow-hidden`}>
        <div className="fd-scroll max-h-[560px] overflow-y-auto">
          <table className="w-full">
            <thead className={`sticky top-0 ${c.surface}`}>
              <tr className={`border-b text-left text-[10px] tracking-wider ${c.border} ${c.text3}`}>
                <th className="px-4 py-2.5 font-semibold">MARKET</th>
                <th className="px-3 py-2.5 font-semibold">YES</th>
                <th className="px-3 py-2.5 font-semibold">NO</th>
                <th className="px-3 py-2.5 font-semibold">PARITY</th>
                <th className="px-3 py-2.5 font-semibold">VOLUME</th>
                <th className="px-3 py-2.5 font-semibold">SOURCE</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {markets.map((m) => {
                const parity = m.yesPriceCents != null && m.noPriceCents != null ? 100 - (m.yesPriceCents + m.noPriceCents) : null;
                return (
                  <tr key={m.id} className={`border-b text-[12px] last:border-0 ${c.border} hover:bg-[#131A2C]`}>
                    <td className="max-w-[380px] px-4 py-2.5">
                      <div className={`truncate ${c.text}`}>{m.question}</div>
                      <div className={`text-[10px] ${c.text3}`}>{m.category}{m.ambiguityFlag ? " · ⚠ ambiguity check" : ""}</div>
                    </td>
                    <td className={`px-3 py-2.5 ${mono} ${c.text}`}>{m.yesPriceCents ?? "—"}¢</td>
                    <td className={`px-3 py-2.5 ${mono} ${c.text2}`}>{m.noPriceCents ?? "—"}¢</td>
                    <td className={`px-3 py-2.5 ${mono} ${parity != null && parity > 0 ? c.gain : c.text3}`}>{parity != null ? `${parity >= 0 ? "+" : ""}${parity}¢` : "—"}</td>
                    <td className={`px-3 py-2.5 ${mono} ${c.text2}`}>{m.volumeCents != null ? fmtCents(m.volumeCents) : "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${m.dataSource === "GAMMA_LIVE" ? `${c.bright} bg-[#00B0F0]/10` : `${c.warn} bg-[#E3A63B]/10`}`}>
                        {m.dataSource === "GAMMA_LIVE" ? "LIVE" : "CACHED"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button size="sm" variant="outline" className={`h-7 border-[#2E3C5F] bg-[#151D30] text-[#E9EEF7] text-[11px] hover:bg-[#1B2540]`} onClick={() => onTrade(m)} disabled={m.ambiguityFlag}>
                        {m.ambiguityFlag ? "Flagged" : "Trade"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {markets.length === 0 && (
                <tr><td colSpan={7} className={`px-4 py-8 text-center text-[12px] ${c.text3}`}>No markets cached yet — press “Sync from Polymarket”.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Trade dialog ─────────────────────────────────────────────────────────────
function TradeDialog({ market, onClose, onPlace, busy }: { market: MarketDTO | null; onClose: () => void; onPlace: (p: unknown) => void; busy: string | null }) {
  const [side, setSide] = useState<"BUY_YES" | "BUY_NO">("BUY_YES");
  const [price, setPrice] = useState<number>(market?.yesPriceCents ?? 50);
  const [sizeDollars, setSizeDollars] = useState("25.00");
  if (!market) return null;
  const sizeCents = Math.round(parseFloat(sizeDollars || "0") * 100);
  const valid = Number.isInteger(price) && price >= 1 && price <= 100 && Number.isInteger(sizeCents) && sizeCents > 0;
  return (
    <Dialog open={!!market} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={`${c.surface} border-[#202B45] text-[#E9EEF7] sm:max-w-[420px]`}>
        <DialogHeader>
          <DialogTitle className="text-[14px]">Manual paper order — always net of fees</DialogTitle>
        </DialogHeader>
        <div className={`text-[11px] ${c.text2}`}>{market.question}</div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => { setSide("BUY_YES"); setPrice(market.yesPriceCents ?? 50); }} className={`rounded-lg border py-2.5 text-[12.5px] font-semibold transition-colors ${side === "BUY_YES" ? "border-[#00B0F0] bg-[#00B0F0]/10 text-[#00B0F0]" : `${c.borderStrong} ${c.elevated} ${c.text2}`}`}>
            Buy YES · {market.yesPriceCents ?? "—"}¢
          </button>
          <button onClick={() => { setSide("BUY_NO"); setPrice(market.noPriceCents ?? 50); }} className={`rounded-lg border py-2.5 text-[12.5px] font-semibold transition-colors ${side === "BUY_NO" ? "border-[#00B0F0] bg-[#00B0F0]/10 text-[#00B0F0]" : `${c.borderStrong} ${c.elevated} ${c.text2}`}`}>
            Buy NO · {market.noPriceCents ?? "—"}¢
          </button>
        </div>
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <Label className={`text-[11px] ${c.text2}`}>Limit price (¢)</Label>
            <Input type="number" min={1} max={100} value={price} onChange={(e) => setPrice(parseInt(e.target.value || "0", 10))} className={`mt-1 border-[#2E3C5F] bg-[#151D30] ${c.text}`} />
          </div>
          <div>
            <Label className={`text-[11px] ${c.text2}`}>Size ($)</Label>
            <Input value={sizeDollars} onChange={(e) => setSizeDollars(e.target.value.replace(/[^0-9.]/g, ""))} className={`mt-1 border-[#2E3C5F] bg-[#151D30] ${c.text} ${mono}`} />
          </div>
          <div className={`flex justify-between rounded-lg border border-dashed px-3 py-2 text-[11.5px] ${c.borderStrong} ${c.text2}`}>
            <span>Est. fee (paper schedule)</span><span className={mono}>$0.00 · taker 0 bps [config]</span>
          </div>
          <div className={`flex justify-between text-[12px] ${c.text}`}>
            <span>Est. total</span><span className={mono}>{fmtCents(sizeCents)}</span>
          </div>
          <Button className="bg-[#00B0F0] font-semibold text-[#001040] hover:bg-[#2FC1F5]" disabled={!valid || busy !== null} onClick={() => onPlace({ marketId: market.id, side, priceCents: price, sizeCents, nonce: crypto.randomUUID() })}>
            Place paper order
          </Button>
          <div className={`text-[10px] ${c.text3}`}>Robot entry additionally requires the edge gate, liquidity and risk checks — this ticket is the manual path (C4.5 eligibility applies).</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
