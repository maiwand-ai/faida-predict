"use client";

// FAIDA Predict — UI shell. Single page: venue-first Dashboard (default),
// per-venue Workspace, Markets, Robot Studio, Trading, Settings.
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
} from "./types";
import { c, card, mono, fmtCents, VenueBadge, venueScopeStyle } from "./ui";
import { LIVE_VENUE_IDS, ROLE_LABEL, VENUE_LABEL, VENUES } from "@/lib/venues";
import { StudioView, TradingView, SettingsView } from "./views";
import { DashboardView, VenueWorkspace } from "./dashboard";

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
type View = "overview" | "venue" | "markets" | "studio" | "trading" | "settings";

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
  // venue-first navigation: dashboard → venue workspace → studio pre-scoped
  const [venueFocus, setVenueFocus] = useState<string | null>(null);
  const [studioVenue, setStudioVenue] = useState<string | null>(null);

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

  // P3.1: venue-aware sync — no venue argument syncs every LIVE venue.
  const syncMarkets = async (venue?: string) => {
    setBusy("sync");
    try {
      const targets = venue ? [venue] : LIVE_VENUE_IDS;
      const parts: string[] = [];
      let synced = 0;
      for (const v of targets) {
        try {
          const res = await fetch("/api/markets", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ venue: v }),
          });
          const json = await safeJson<{ synced: number; venue: string }>(res);
          if (json?.synced) {
            synced += json.synced;
            parts.push(`${VENUE_LABEL[v] ?? v}: ${json.synced}`);
          }
        } catch { /* one venue failing must not block the others */ }
      }
      if (synced > 0) {
        toast({ title: `Synced ${synced} live market${synced === 1 ? "" : "s"}`, description: parts.join(" · ") });
      } else {
        toast({ title: "Venue APIs unreachable from sandbox", description: "Showing cached/seeded markets — source labeled honestly per D-03", variant: "destructive" });
      }
      await refreshMarkets();
    } finally {
      setBusy(null);
    }
  };

  const hasUnknown = (ordersData?.orders ?? []).some((o) => o.state === "UNKNOWN" || o.state === "RECONCILING");

  const navItems: Array<{ id: View; label: string; badge?: string }> = [
    { id: "overview", label: "Dashboard" },
    { id: "markets", label: "Markets" },
    { id: "studio", label: "Robot Studio" },
    { id: "trading", label: "Trading" },
    { id: "settings", label: "Settings" },
  ];
  // while inside a venue workspace, keep the Dashboard nav item lit
  const activeView: View = view === "venue" ? "overview" : view;

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
              <div className={`mt-0.5 text-[9px] tracking-[0.15em] ${c.text3}`}>AUTONOMY · PHASE 4</div>
            </div>
          </div>
          <nav className="flex flex-col gap-1">
            {navItems.map((n) => (
              <button
                key={n.id}
                onClick={() => { setView(n.id); if (n.id === "settings") { refreshRisk(); refreshEligibility(); } if (n.id === "trading") refreshOrders(); }}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                  activeView === n.id ? `${c.elevated} ${c.text}` : `${c.text2} hover:${c.elevated}`
                }`}
              >
                <span className={`h-2 w-2 rounded-[3px] ${activeView === n.id ? "bg-[#00B0F0]" : "bg-[#2E3C5F]"}`} />
                {n.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto border-t ${c.border} pt-3" style={{ borderColor: "#202B45" }}>
            <div className={`flex justify-between px-2 text-[10.5px] ${c.text3}`}>
              <span>● Venues: {VENUES.filter((v) => v.adapter === "LIVE").map((v) => v.label).join(", ")} · {VENUES.filter((v) => v.adapter === "PENDING").length} planned</span><span className={mono}>data {dash?.marketCount ?? 0}</span>
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
              <DashboardView
                dash={dash}
                markets={markets}
                onSync={syncMarkets}
                busy={busy}
                onCycle={() => post("/api/cycle", {}, "Robot cycle executed")}
                onReconcile={() => post("/api/cycle", { action: "RECONCILE" }, "Reconciliation pass complete")}
                hasUnknown={hasUnknown}
                onControl={(body, msg) => post("/api/control", body, msg)}
                onOpenVenue={(venueId) => { setVenueFocus(venueId); setView("venue"); }}
              />
            )}
            {view === "venue" && venueFocus && (
              <VenueWorkspace
                venueId={venueFocus}
                dash={dash}
                markets={markets}
                busy={busy}
                onBack={() => setView("overview")}
                onSyncVenue={(v) => syncMarkets(v)}
                onCycle={() => post("/api/cycle", {}, "Robot cycle executed")}
                onTrade={(m) => setTradeMarket(m)}
                onCreateRobot={(v) => { setStudioVenue(v); setView("studio"); }}
                onControl={(body, msg) => post("/api/control", body, msg)}
              />
            )}
            {view === "markets" && (
              <MarketsView markets={markets} onSync={syncMarkets} busy={busy} onTrade={(m) => setTradeMarket(m)} />
            )}
            {view === "studio" && (
              <StudioView key={studioVenue ?? "any"} initialVenue={studioVenue ?? undefined} dash={dash} onCreate={(payload) => post("/api/robots", payload, "Robot created as PAPER_ONLY draft")} onAfterChange={refreshDashboard} />
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
            FAIDA Predict — Phase 4 (venue #3 Limitless · thin-liquidity structural rules · A-04 exposure clustering). All figures paper-labeled per D-03/D-05. Live trading requires Phase 7 gates + explicit authorization.
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

// ── Markets ──────────────────────────────────────────────────────────────────
// B9/B11: one separate section per venue — the user always sees which market
// they are entering, and which venue a robot would be created for.
function MarketsView({ markets, onSync, onTrade, busy }: { markets: MarketDTO[]; onSync: (venue?: string) => void; onTrade: (m: MarketDTO) => void; busy: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-semibold">Market discovery</h1>
        <span className={`text-[12px] ${c.text3}`}>one section per venue — read-only market data via per-venue adapters (S-05: MARKET_DATA_ONLY)</span>
        <Button size="sm" className="ml-auto bg-[#00B0F0] font-semibold text-[#001040] hover:bg-[#2FC1F5]" onClick={() => onSync()} disabled={busy === "sync"}>
          {busy === "sync" ? "Syncing…" : "Sync all venues"}
        </Button>
      </div>
      {VENUES.map((v) => {
        const rows = markets.filter((m) => m.venue === v.id);
        return (
          // B12: each venue section wears its venue color (strip, dot, live text).
          <div key={v.id} className={`${card} vc-scope overflow-hidden`} style={venueScopeStyle(v.id)}>
            <span className={`vc-strip block h-[3px] w-full ${v.adapter === "LIVE" ? "" : "opacity-80"}`} aria-hidden />
            {/* venue section header */}
            <div className={`flex flex-wrap items-center gap-2.5 border-b px-4 py-3 ${c.border}`}>
              <span className="vc-bg h-2 w-2 rounded-[3px]" aria-hidden />
              <VenueBadge venue={v.id} />
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${c.text3} bg-[#151D30]`}>
                {ROLE_LABEL[v.role]}
              </span>
              <span className={`text-[10.5px] font-semibold ${v.adapter === "LIVE" ? "vc-text" : c.text3}`}>
                {v.adapter === "LIVE" ? "● adapter live" : "○ adapter pending"}
              </span>
              <span className={`hidden text-[11px] md:inline ${c.text3}`}>{v.note}</span>
              {v.adapter === "LIVE" && (
                <Button size="sm" variant="outline" className="h-7 border-[#2E3C5F] bg-[#151D30] text-[11px] text-[#E9EEF7] hover:bg-[#1B2540]" onClick={() => onSync(v.id)} disabled={busy === "sync"}>
                  {busy === "sync" ? "Syncing…" : `Sync ${v.label}`}
                </Button>
              )}
              <span className={`text-[11px] ${mono} ${c.text2}`}>{rows.length} market{rows.length === 1 ? "" : "s"}</span>
            </div>
            {rows.length > 0 ? (
              <div className="fd-scroll max-h-[420px] overflow-y-auto">
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
                    {rows.map((m) => {
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
                            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${m.dataSource.endsWith("_LIVE") ? `${c.bright} bg-[#00B0F0]/10` : `${c.warn} bg-[#E3A63B]/10`}`}>
                              {m.dataSource.endsWith("_LIVE") ? "LIVE" : "CACHED"}
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
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={`px-4 py-7 text-center text-[12px] ${c.text3}`}>
                {v.adapter === "LIVE"
                  ? `No ${v.label} markets cached yet — press “Sync ${v.label}” above.`
                  : `No ${v.label} markets yet — the adapter ships per the B9 roadmap. Robots can be scoped here once it lands.`}
              </div>
            )}
          </div>
        );
      })}
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
      {/* B12: the ticket inherits the market's venue color — you always know
          which market's room you are placing an order in. */}
      <DialogContent
        className={`${c.surface} vc-scope overflow-hidden border-[#202B45] text-[#E9EEF7] sm:max-w-[420px]`}
        style={venueScopeStyle(market.venue)}
      >
        <span className="vc-strip -mx-6 -mt-6 mb-1 block h-[3px]" aria-hidden />
        <DialogHeader>
          <DialogTitle className="text-[14px]">Manual paper order — always net of fees</DialogTitle>
        </DialogHeader>
        <div className={`text-[11px] ${c.text2}`}>{market.question}</div>
        <div className={`mt-1 flex items-center gap-1.5 text-[10.5px] ${c.text3}`}>
          entering via <VenueBadge venue={market.venue} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => { setSide("BUY_YES"); setPrice(market.yesPriceCents ?? 50); }} className={`rounded-lg border py-2.5 text-[12.5px] font-semibold transition-colors ${side === "BUY_YES" ? "vc-border vc-tint vc-text" : `${c.borderStrong} ${c.elevated} ${c.text2}`}`}>
            Buy YES · {market.yesPriceCents ?? "—"}¢
          </button>
          <button onClick={() => { setSide("BUY_NO"); setPrice(market.noPriceCents ?? 50); }} className={`rounded-lg border py-2.5 text-[12.5px] font-semibold transition-colors ${side === "BUY_NO" ? "vc-border vc-tint vc-text" : `${c.borderStrong} ${c.elevated} ${c.text2}`}`}>
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
          <Button className="vc-btn font-semibold" disabled={!valid || busy !== null} onClick={() => onPlace({ marketId: market.id, side, priceCents: price, sizeCents, nonce: crypto.randomUUID() })}>
            Place paper order
          </Button>
          <div className={`text-[10px] ${c.text3}`}>Robot entry additionally requires the edge gate, liquidity and risk checks — this ticket is the manual path (C4.5 eligibility applies).</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
