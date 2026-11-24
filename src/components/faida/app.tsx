"use client";

// FAIDA Predict — UI shell. Single page: venue-first Dashboard (default),
// per-venue Workspace, Markets, Robot Studio, Trading, Settings.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import {
  type DashboardDTO,
  type MarketDTO,
  type OrderRowDTO,
  type LedgerRowDTO,
  type RiskViewDTO,
  type EligibilityRuleDTO,
  type ProbabilityDTO,
} from "./types";
import { LIVE_VENUE_IDS, VENUE_LABEL } from "@/lib/venues";
import { TradingView, SettingsView } from "./views";
import { StudioView } from "./studio";
import { VenueWorkspace } from "./dashboard";
import { HomeView } from "./home";
import { RobotDetail } from "./robot";
import { BetaView } from "./beta";
import { MarketsView, MarketDetail, TradeDialog } from "./markets";
import { RobotsView } from "./robots";
import { AnalyticsView } from "./analytics";
import { RiskCenter } from "./risk";
import { IntelligenceView } from "./intel";
import { MobileNav, SearchPalette, Sidebar, TopBar, type Nav, type OperatingMode } from "./shell";
import { ReadyMadeRobots } from "./templates";
import { HelpView } from "./help";
import { TrackRecordView } from "./trackrecord";
import { AskFaida } from "./ask";
import { StrategyLab } from "./views";
import { Panel } from "./ds";

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
export default function FaidaApp() {
  const { toast } = useToast();
  const router = useRouter();
  // navigation: a view plus an optional tab (sidebar sub-links pick the tab)
  const [nav, setNav] = useState<Nav>({ view: "overview" });
  const view = nav.view;
  const [marketFocus, setMarketFocus] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [live, setLive] = useState<{ armSwitch: string; pilot: { enabled: boolean }; consent: { consented: boolean } } | null>(null);
  const [dash, setDash] = useState<DashboardDTO | null>(null);
  const [markets, setMarkets] = useState<MarketDTO[]>([]);
  const [ordersData, setOrdersData] = useState<{ orders: OrderRowDTO[]; ledger: LedgerRowDTO[] } | null>(null);
  const [riskView, setRiskView] = useState<RiskViewDTO | null>(null);
  const [eligibility, setEligibility] = useState<EligibilityRuleDTO[]>([]);
  const [probability, setProbability] = useState<ProbabilityDTO | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tradeMarket, setTradeMarket] = useState<MarketDTO | null>(null);
  // venue-first navigation: dashboard → venue workspace → robot detail →
  // studio pre-scoped (Phase 11 redesign IA)
  const [venueFocus, setVenueFocus] = useState<string | null>(null);
  const [robotFocus, setRobotFocus] = useState<string | null>(null);
  const [studioVenue, setStudioVenue] = useState<string | null>(null);
  const [studioTemplate, setStudioTemplate] = useState<string | null>(null);
  // Phase 10: the acting identity — session user (member or operator) with the
  // honest fallback mode disclosed; drives the Beta Ops view and header chip.
  const [me, setMe] = useState<{ id: string; email: string; role: string; name: string | null; via?: string } | null>(null);
  const refreshMe = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      // strict sign-in and no session: send the visitor to the login page
      if (res.status === 401) { router.replace("/login"); return; }
      const json = await safeJson<{ user: { id: string; email: string; role: string; name: string | null }; via: string }>(res);
      if (json?.user) setMe({ ...json.user, via: json.via });
    } catch { /* transient — next poll recovers */ }
  }, [router]);

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
      const res = await fetch("/api/orders?limit=500");
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
  // Phase 5: model registry + AI governance state (Settings cards)
  const refreshProbability = useCallback(async () => {
    try {
      const res = await fetch("/api/probability");
      if (res.ok) setProbability(await safeJson<ProbabilityDTO>(res));
    } catch { /* transient */ }
  }, []);

  // live-trading status drives the global mode indicator (operator-only API;
  // a refusal simply means paper mode for this viewer)
  const refreshLive = useCallback(async () => {
    try {
      const res = await fetch("/api/live");
      setLive(res.ok ? await safeJson(res) : null);
    } catch { /* transient */ }
  }, []);

  useEffect(() => {
    // first load runs on the same timer machinery as the refresh polls, so no
    // state is set synchronously inside the effect
    const boot = setTimeout(() => {
      refreshDashboard();
      refreshMarkets();
      refreshOrders();
      refreshProbability();
      refreshMe();
      refreshRisk();
      refreshLive();
    }, 0);
    const t = setInterval(refreshDashboard, 15000);
    const t5 = setInterval(refreshProbability, 15000);
    const t6 = setInterval(refreshLive, 30000);
    return () => { clearTimeout(boot); clearInterval(t); clearInterval(t5); clearInterval(t6); };
  }, [refreshDashboard, refreshMarkets, refreshOrders, refreshProbability, refreshMe, refreshRisk, refreshLive]);

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

  // PATCH twin of post() — same contract (toast + refresh); used by the robot
  // detail screen for C26 status transitions (pause / resume).
  const patch = useCallback(
    async (url: string, body: unknown, okMsg: string) => {
      setBusy(url + JSON.stringify(body).slice(0, 40));
      try {
        const res = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const json = await safeJson<Record<string, unknown>>(res);
        if (!json) {
          toast({ title: "Refused", description: "Empty response — try again", variant: "destructive" });
          return;
        }
        if (res.ok) {
          toast({ title: okMsg, description: typeof json === "object" ? summarize(json) : "" });
        } else {
          toast({ title: "Refused", description: String(json.error ?? json.reason ?? "unknown"), variant: "destructive" });
        }
        return json;
      } finally {
        setBusy(null);
        await refreshDashboard();
      }
    },
    [toast, refreshDashboard],
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
        toast({ title: "Couldn't reach the venues", description: "Showing the last saved markets. Each market shows where its data came from.", variant: "destructive" });
      }
      await refreshMarkets();
    } finally {
      setBusy(null);
    }
  };

  const hasUnknown = (ordersData?.orders ?? []).some((o) => o.state === "UNKNOWN" || o.state === "RECONCILING");
  const isOperator = me?.role === "OPERATOR";
  const paused = dash?.control?.pause.paused ?? false;
  const mode: OperatingMode = paused
    ? "PAUSED"
    : live?.armSwitch === "ARMED" && live.pilot?.enabled && live.consent?.consented
      ? "LIVE"
      : live?.pilot?.enabled
        ? "RESTRICTED"
        : "PAPER";

  const navigate = useCallback(
    (n: Nav) => {
      setNav(n);
      if (n.view === "settings" || n.view === "risk") { refreshRisk(); refreshEligibility(); refreshProbability(); }
      if (n.view === "trading" || n.view === "analytics") refreshOrders();
      if (n.view === "markets") refreshMarkets();
      if (typeof window !== "undefined") window.scrollTo({ top: 0 });
    },
    [refreshRisk, refreshEligibility, refreshProbability, refreshOrders, refreshMarkets],
  );
  const openVenue = (venueId: string) => { setVenueFocus(venueId); navigate({ view: "venue", tab: venueId }); };
  const openRobot = (robotId: string) => { setRobotFocus(robotId); navigate({ view: "robot" }); };
  const openMarket = (marketId: string) => { setMarketFocus(marketId); navigate({ view: "market" }); };
  const signOut = async () => { await fetch("/api/auth/logout", { method: "POST" }); await refreshMe(); toast({ title: "Signed out" }); };
  const runCycle = () => post("/api/cycle", {}, "Markets checked: every running robot made its decision");
  const closePosition = (positionId: string) => post("/api/orders", { action: "CLOSE_POSITION", positionId }, "Position closed");

  const createRobot = (opts: { venue?: string; template?: string } = {}) => {
    setStudioVenue(opts.venue ?? null);
    setStudioTemplate(opts.template ?? null);
    navigate({ view: "studio" });
  };

  return (
    <div className="flex min-h-screen text-[var(--fd-text)]" style={{ fontFamily: "var(--font-inter)" }}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-[#2583FF] focus:px-3 focus:py-2 focus:text-[var(--fd-strong)]">Skip to content</a>
      <aside className={`sticky top-0 hidden h-screen shrink-0 py-3 pl-3 transition-[width] duration-200 md:block ${collapsed ? "w-[88px]" : "w-[280px]"}`}>
        <div className="fd-glass h-full overflow-hidden rounded-3xl border border-[var(--fd-border)] bg-[var(--fd-surface)]">
          <Sidebar nav={nav} onNavigate={navigate} onOpenVenue={openVenue} dash={dash} mode={mode} isOperator={isOperator} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((v) => !v)} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar dash={dash} mode={mode} me={me} onOpenSearch={() => setSearchOpen(true)} onNavigate={navigate} onSignOut={signOut} />

        {mode === "PAUSED" && (
          <div role="alert" className="mx-3 mt-1 flex flex-wrap items-center gap-3 rounded-2xl border border-[#FF5268]/40 bg-[#FF5268]/12 px-4 py-3 backdrop-blur sm:mx-6 sm:px-6 lg:mx-8">
            <span className="text-[14.5px] font-semibold text-[var(--fd-red-text)]">Emergency stop is on.</span>
            <span className="text-[14px] text-[var(--fd-text)]/80">Robots won&apos;t open new trades until you resume. Reason: {dash?.control?.pause.reason ?? "manual stop"}</span>
            <button onClick={() => post("/api/control", { action: "RESUME" }, "Resumed: robots can trade again")} disabled={busy !== null} className="ml-auto h-9 rounded-lg border border-[#FF5268]/50 px-3 text-[14px] font-semibold text-[var(--fd-red-text)] hover:bg-[#FF5268]/15 disabled:opacity-50">
              Resume
            </button>
          </div>
        )}

        <main id="main" className="fd-fade-in mx-auto w-full max-w-[1480px] flex-1 px-3 py-5 pb-28 sm:px-6 sm:py-7 md:pb-8 lg:px-8" key={`${nav.view}:${nav.view === "venue" ? nav.tab : ""}`}>
          {view === "overview" && (
            <HomeView
              dash={dash}
              ledger={ordersData?.ledger ?? []}
              busy={busy}
              onSync={syncMarkets}
              onCycle={runCycle}
              onControl={(body, msg) => post("/api/control", body, msg)}
              onOpenRobot={openRobot}
              onOpenVenue={openVenue}
              onNavigate={navigate}
              onNewRobot={() => createRobot()}
              onClosePosition={closePosition}
              onOpenMarket={openMarket}
            />
          )}
          {view === "venue" && venueFocus && (
            <VenueWorkspace
              venueId={venueFocus}
              dash={dash}
              markets={markets}
              busy={busy}
              onBack={() => navigate({ view: "markets", tab: "trending" })}
              onSyncVenue={(v) => syncMarkets(v)}
              onCycle={runCycle}
              onTrade={(m) => setTradeMarket(m)}
              onOpenMarket={openMarket}
              onCreateRobot={(v) => createRobot({ venue: v })}
              onControl={(body, msg) => post("/api/control", body, msg)}
              onOpenRobot={openRobot}
            />
          )}
          {view === "robot" && robotFocus && (
            <RobotDetail
              key={robotFocus}
              robotId={robotFocus}
              busy={busy}
              onBack={() => navigate({ view: "robots" })}
              onBackLabel="My Robots"
              onOpenVenue={openVenue}
              onOpenMarket={openMarket}
              onEditStrategy={() => navigate({ view: "robots", tab: "lab" })}
              onGoLive={() => navigate({ view: "settings", tab: "live" })}
              onClosePosition={closePosition}
              onCycleRobot={(rid, name) => post(`/api/robots/${rid}/cycle`, {}, `${name} checked its markets`)}
              onRobotStatus={(rid, status, name) => patch("/api/robots", { robotId: rid, status }, statusToast(name, status))}
            />
          )}
          {view === "robots" && (
            <RobotsView
              dash={dash}
              busy={busy}
              onOpenRobot={openRobot}
              onCreate={() => createRobot()}
              onOpenVenue={openVenue}
              onRobotStatus={(rid, status, name) => patch("/api/robots", { robotId: rid, status }, statusToast(name, status))}
              onCycleRobot={(rid, name) => post(`/api/robots/${rid}/cycle`, {}, `${name} checked its markets`)}
              tab={nav.tab ?? "mine"}
              onTab={(t) => setNav({ view: "robots", tab: t })}
              readyMade={<ReadyMadeRobots dash={dash} onUse={(id) => createRobot({ template: id })} onBuildOwn={() => createRobot()} />}
              lab={<Panel title="Test & tune" subtitle="Make a new version of a robot's strategy, then test it on past prices before switching it on."><StrategyLab dash={dash} onAfterChange={refreshDashboard} /></Panel>}
            />
          )}
          {view === "markets" && (
            <MarketsView
              markets={markets}
              dash={dash}
              tab={nav.tab ?? "trending"}
              onTab={(t) => setNav({ view: "markets", tab: t })}
              onSync={syncMarkets}
              busy={busy}
              onTrade={(m) => setTradeMarket(m)}
              onOpenMarket={openMarket}
              onOpenVenue={openVenue}
            />
          )}
          {view === "market" && marketFocus && (
            <MarketDetail
              key={marketFocus}
              marketId={marketFocus}
              dash={dash}
              busy={busy}
              onBack={() => navigate({ view: "markets", tab: "trending" })}
              onOpenMarket={openMarket}
              onOpenRobot={openRobot}
              onOpenVenue={openVenue}
              onPlace={(p) => post("/api/orders", p, "Practice order filled")}
            />
          )}
          {view === "studio" && (
            <StudioView
              key={`${studioVenue ?? "any"}:${studioTemplate ?? "none"}`}
              initialVenue={studioVenue ?? undefined}
              initialTemplateId={studioTemplate ?? undefined}
              onBrowseTemplates={() => navigate({ view: "robots", tab: "ready" })}
              dash={dash}
              markets={markets}
              onCreate={(payload) => post("/api/robots", payload, "Robot created: running with practice money")}
              onAfterChange={refreshDashboard}
              onAction={post}
              onOpenRobot={openRobot}
            />
          )}
          {view === "trading" && (
            <TradingView
              markets={markets}
              dash={dash}
              ordersData={ordersData}
              busy={busy}
              tab={nav.tab ?? "positions"}
              onTab={(t) => setNav({ view: "trading", tab: t })}
              onPlace={(payload) => post("/api/orders", payload, "Practice order filled")}
              onSimulateAckLoss={(marketId) => post("/api/orders", { action: "SIMULATE_ACK_LOSS", marketId }, "Practice drill: an order with a lost reply was created")}
              onReconcile={() => post("/api/cycle", { action: "RECONCILE" }, "Stuck orders checked with the venue")}
              hasUnknown={hasUnknown}
              onTradeSomething={() => navigate({ view: "markets", tab: "trending" })}
              onOpenMarket={openMarket}
              onOpenRobot={openRobot}
              onClosePosition={closePosition}
              performance={<AnalyticsView embedded dash={dash} ordersData={ordersData} onOpenRobot={openRobot} onOpenVenue={openVenue} />}
            />
          )}
          {view === "analytics" && (
            <AnalyticsView dash={dash} ordersData={ordersData} onOpenRobot={openRobot} onOpenVenue={openVenue} />
          )}
          {view === "intel" && (
            <IntelligenceView
              dash={dash}
              markets={markets}
              probability={probability}
              tab={nav.tab ?? "record"}
              onTab={(t) => setNav({ view: "intel", tab: t })}
              trackRecord={<TrackRecordView onOpenRobot={openRobot} onNavigate={navigate} />}
              ask={<AskFaida onOpenMarket={openMarket} onNavigate={navigate} />}
              onOpenMarket={openMarket}
              onOpenRobot={openRobot}
              onNavigate={navigate}
            />
          )}
          {view === "risk" && (
            <RiskCenter
              key={nav.tab === "stop" ? "stop" : "safety"}
              dash={dash}
              riskView={riskView}
              probability={probability}
              ordersData={ordersData}
              live={live}
              mode={mode}
              tab={nav.tab ?? "check"}
              onTab={(t) => setNav({ view: "risk", tab: t })}
              busy={busy}
              onControl={(body, msg) => post("/api/control", body, msg)}
              onOpenRobot={openRobot}
              onOpenVenue={openVenue}
              onNavigate={navigate}
            />
          )}
          {view === "beta" && <BetaView me={me} onToast={toast} />}
          {view === "help" && <HelpView isOperator={isOperator} onToast={toast} />}
          {view === "settings" && (
            <SettingsView
              dash={dash}
              riskView={riskView}
              eligibility={eligibility}
              probability={probability}
              tab={nav.tab ?? "general"}
              onTab={(t) => setNav({ view: "settings", tab: t })}
              mode={mode}
              me={me}
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
              onProbabilityAction={async (body, okMsg) => {
                const res = await fetch("/api/probability", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
                const json = await safeJson<{ ok?: boolean; error?: string; detail?: string }>(res);
                if (res.ok && json?.ok) toast({ title: okMsg, description: json.detail ?? "" });
                else toast({ title: "Refused", description: String(json?.error ?? json?.detail ?? "empty response"), variant: "destructive" });
                refreshProbability();
              }}
              onOpenRisk={() => { refreshRisk(); refreshProbability(); }}
            />
          )}
        </main>
        <footer className="hidden px-8 py-4 text-[13px] text-[var(--fd-text3)] md:flex md:flex-wrap md:items-center md:justify-between md:gap-3">
          <span>FAIDA Predict · Intelligent. Transparent. Controlled.</span>
          <span>{mode === "LIVE" ? "Real money: robots trade within your pilot limits" : "Practice money: no real money moves"}</span>
        </footer>
      </div>

      <MobileNav nav={nav} onNavigate={navigate} />
      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} dash={dash} markets={markets} onNavigate={navigate} onOpenMarket={openMarket} onOpenRobot={openRobot} onOpenVenue={openVenue} />
      <TradeDialog key={tradeMarket?.id ?? "closed"} market={tradeMarket} onClose={() => setTradeMarket(null)} onPlace={(p) => post("/api/orders", p, "Practice order filled")} busy={busy} />
    </div>
  );
}

function statusToast(name: string, status: string): string {
  if (status === "PAUSED_BY_USER") return `${name} paused`;
  if (status === "PAPER_ONLY" || status === "RUNNING") return `${name} resumed`;
  return `${name}: ${status.replace(/_/g, " ").toLowerCase()}`;
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

