"use client";

// FAIDA Predict — Robot Studio. A nine-step creation flow with a persistent
// configuration summary, plus the Strategy Library (versions + backtests).
// The create payload is exactly the one POST /api/robots has always taken;
// every robot is saved as a PAPER_ONLY draft and live activation stays behind
// the existing gates. Nothing here adds a knob the engine doesn't read.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Bot, Brain, CheckCircle2, Cpu, Gauge, LineChart, Lock, Rocket, Save, Shield, SlidersHorizontal, Sparkles, Target, Wallet } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import type { DashboardDTO, MarketDTO, TemplateDTO } from "./types";
import { FAMILIES, FAMILY_LABEL } from "./types";
import { VENUES, VENUE_LABEL, isVenue, venueColor } from "@/lib/venues";
import { EMPTY_ENTRY_RULES, VENUE_ENTRY_RULES } from "@/lib/venue/rules";
import { Badge, btn, EmptyState, KV, money, PageHeader, Panel, VenueTag } from "./ds";
import { availabilityFor, useAvailability } from "./help";
import { STATUS_LABEL, VENUE_GUIDES } from "@/lib/venue/availability";

async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  try { return (await res.json()) as T; } catch { return null; }
}

const STEPS = [
  { id: 1, label: "Robot identity", icon: <Bot size={17} /> },
  { id: 2, label: "Venue selection", icon: <Target size={17} /> },
  { id: 3, label: "Strategy & market", icon: <LineChart size={17} /> },
  { id: 4, label: "AI model & intelligence", icon: <Brain size={17} /> },
  { id: 5, label: "Entry conditions", icon: <Sparkles size={17} /> },
  { id: 6, label: "Exit conditions", icon: <Gauge size={17} /> },
  { id: 7, label: "Capital & risk", icon: <Wallet size={17} /> },
  { id: 8, label: "Execution settings", icon: <Cpu size={17} /> },
  { id: 9, label: "Review & activation", icon: <Rocket size={17} /> },
];

// plain-language strategy cards for the four engine families
const FAMILY_INFO: Record<string, { risk: string; tone: string; when: string; entry: string; exit: string; capital: string }> = {
  PROBABILITY_EDGE: { risk: "Balanced", tone: "blue", when: "Liquid markets where the price drifts from a fair estimate", entry: "Model estimate beats the market price by the minimum edge, net of fees", exit: "Edge falls below the exit threshold, adverse news, or the time stop", capital: "$1,000–$3,000" },
  MARKET_MAKING: { risk: "Conservative", tone: "green", when: "Deep, two-sided books with a steady spread", entry: "Quotes both sides around fair value", exit: "Inventory and time limits", capital: "$1,500+" },
  AI_RESEARCH: { risk: "Aggressive", tone: "red", when: "Event-driven markets where evidence moves the odds", entry: "The AI's estimate beats the market price by enough, after fees", exit: "Edge disappears or the evidence changes", capital: "$500–$2,000" },
  ARBITRAGE: { risk: "Low", tone: "neutral", when: "YES + NO priced below $1, related outcomes", entry: "Deterministic parity gap", exit: "Gap closes", capital: "Planned" },
};

export function StudioView(props: {
  dash: DashboardDTO | null;
  markets?: MarketDTO[];
  onCreate: (p: unknown) => Promise<unknown>;
  onAfterChange?: () => void;
  initialVenue?: string;
  initialTemplateId?: string;
  onBrowseTemplates?: () => void;
  onAction?: (url: string, body: unknown, okMsg: string) => Promise<unknown>;
  onOpenRobot?: (id: string) => void;
}) {
  const { dash, markets = [], onCreate, onAfterChange, initialVenue, initialTemplateId, onBrowseTemplates, onAction, onOpenRobot } = props;
  const [advanced, setAdvanced] = useState(false);
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("BALANCED");
  const [custom, setCustom] = useState(!initialTemplateId);
  const [step, setStep] = useState(1);
  const [family, setFamily] = useState<string>("PROBABILITY_EDGE");
  const [venue, setVenue] = useState<string>(initialVenue && isVenue(initialVenue) ? initialVenue : "POLYMARKET");
  const [name, setName] = useState("");
  const [allocated, setAllocated] = useState(2000);
  const [posCap, setPosCap] = useState(200);
  const [maxOpen, setMaxOpen] = useState(4);
  const [dailyLoss, setDailyLoss] = useState(5);
  const [drawdown, setDrawdown] = useState(10);
  const [minEdge, setMinEdge] = useState(8);
  const [tilt, setTilt] = useState(25);
  const [exitEdge, setExitEdge] = useState(2);
  const [holdTicks, setHoldTicks] = useState(12);
  const platformMaxDaily = dash?.risk.find((r) => r.key === "DAILY_LOSS_STOP_PCT" && r.scope === "PLATFORM")?.valueNum ?? 20;
  const platformMaxDd = dash?.risk.find((r) => r.key === "DRAWDOWN_STOP_PCT" && r.scope === "PLATFORM")?.valueNum ?? 30;

  const [templates, setTemplates] = useState<TemplateDTO[]>([]);
  const [appliedTemplate, setAppliedTemplate] = useState<TemplateDTO | null>(null);
  const [guided, setGuided] = useState<{ robotId: string; robotName: string; templateLabel: string | null } | null>(null);
  const [guidedDone, setGuidedDone] = useState<{ cycle: boolean; backtest: boolean }>({ cycle: false, backtest: false });
  const [guidedBusy, setGuidedBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/robot-templates")
      .then((r) => (r.ok ? safeJson<{ templates: TemplateDTO[] }>(r) : null))
      .then((j) => {
        if (!j?.templates) return;
        setTemplates(j.templates);
        const pre = initialTemplateId ? j.templates.find((t) => t.id === initialTemplateId) : undefined;
        if (pre) fillFromTemplate(pre);
      })
      .catch(() => { /* gallery stays empty; scratch path unaffected */ });
  }, []);

  // quick path: one risk word sets every limit, scaled to the money chosen
  const applyPreset = (level: RiskLevel, money$: number) => {
    const p = PRESETS[level];
    setRiskLevel(level);
    setPosCap(Math.max(50, Math.min(money$, Math.round((money$ * p.perTradePct) / 100 / 50) * 50)));
    setMaxOpen(p.maxOpen);
    setDailyLoss(Math.min(p.daily, platformMaxDaily));
    setDrawdown(Math.min(p.drawdown, platformMaxDd));
    setMinEdge(p.minEdge);
    setExitEdge(p.exitEdge);
  };

  function fillFromTemplate(t: TemplateDTO) {
    if (!t.venueLive) return;
    setVenue(isVenue(t.venue) ? t.venue : "POLYMARKET");
    setFamily(t.family);
    setName(t.nameSuggestion);
    setAllocated(Math.round(t.capital.allocatedCents / 100));
    setPosCap(Math.round(t.capital.maxPositionCents / 100));
    setMaxOpen(t.capital.maxOpenPositions);
    setDailyLoss(t.capital.dailyLossStopPct);
    setDrawdown(t.capital.drawdownStopPct);
    setMinEdge(t.strategy.minEdgePts);
    setTilt(t.strategy.estimatorTiltPct);
    setExitEdge(t.strategy.exitEdgePts);
    setHoldTicks(t.strategy.holdTicksMax);
    setAppliedTemplate(t);
    setRiskLevel(t.riskProfile === "CONSERVATIVE" ? "CAREFUL" : t.riskProfile === "AGGRESSIVE" ? "BOLD" : "BALANCED");
    setCustom(false);
  }

  const applyTemplate = (t: TemplateDTO) => {
    if (!t.venueLive) return;
    setVenue(isVenue(t.venue) ? t.venue : "POLYMARKET");
    setFamily(t.family);
    setName(t.nameSuggestion);
    setAllocated(Math.round(t.capital.allocatedCents / 100));
    setPosCap(Math.round(t.capital.maxPositionCents / 100));
    setMaxOpen(t.capital.maxOpenPositions);
    setDailyLoss(t.capital.dailyLossStopPct);
    setDrawdown(t.capital.drawdownStopPct);
    setMinEdge(t.strategy.minEdgePts);
    setTilt(t.strategy.estimatorTiltPct);
    setExitEdge(t.strategy.exitEdgePts);
    setHoldTicks(t.strategy.holdTicksMax);
    setAppliedTemplate(t);
    setStep(9);
  };

  const nameOk = name.trim().length > 1;
  const canNext = step !== 1 || nameOk;

  const submit = async () => {
    if (!nameOk) { setStep(1); return; }
    setSaving(true);
    try {
      const res = (await onCreate({
        name: name.trim(),
        family,
        venue,
        allocatedCents: allocated * 100,
        maxPositionCents: posCap * 100,
        maxOpenPositions: maxOpen,
        dailyLossStopPct: dailyLoss,
        drawdownStopPct: drawdown,
        config: {
          family,
          entryRule: appliedTemplate?.strategy.entryRule ?? `edge>=${minEdge}pts net of fees`,
          minEdgePts: minEdge,
          estimatorTiltPct: tilt,
          exitEdgePts: exitEdge,
          holdTicksMax: holdTicks,
          exitPolicy: "edge_disappears_or_adverse_verified_info",
          schedule: "continuous_cloud",
          estimator: family === "AI_RESEARCH" ? "AI_OR_HEURISTIC" : "HEURISTIC",
        },
      })) as { robot?: { id?: string; name?: string } } | undefined;
      if (res?.robot?.id) {
        setGuided({ robotId: res.robot.id, robotName: res.robot.name ?? name.trim(), templateLabel: appliedTemplate?.label ?? null });
        setGuidedDone({ cycle: false, backtest: false });
        setAppliedTemplate(null);
        setStep(1);
        setName("");
        setCustom(true);
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } finally {
      setSaving(false);
    }
  };

  const runGuidedStep = async (what: "cycle" | "backtest") => {
    if (!guided) return;
    setGuidedBusy(what);
    try {
      if (what === "cycle") {
        const res = (await onAction?.("/api/cycle", { action: "CYCLE" }, "Cycle complete: decision recorded")) as { summaries?: Array<{ robotId?: string }> } | undefined;
        if (res?.summaries?.some((s) => s.robotId === guided.robotId)) setGuidedDone((d) => ({ ...d, cycle: true }));
      } else {
        const res = (await onAction?.("/api/backtests", { robotId: guided.robotId }, "First backtest complete: evidence recorded")) as Record<string, unknown> | undefined;
        if (res && res.ok !== false) setGuidedDone((d) => ({ ...d, backtest: true }));
      }
      onAfterChange?.();
    } finally {
      setGuidedBusy(null);
    }
  };

  const venueMarkets = useMemo(() => markets.filter((m) => m.venue === venue).sort((a, b) => (b.volumeCents ?? 0) - (a.volumeCents ?? 0)), [markets, venue]);
  const rules = VENUE_ENTRY_RULES[venue] ?? EMPTY_ENTRY_RULES;
  const vhex = venueColor(venue);
  const enabledProviders = (dash?.providers ?? []).filter((p) => p.enabled && p.hasKey);

  const summary: Array<[string, ReactNode]> = [
    ["Name", name.trim() || <span className="text-[var(--fd-text3)]">Not set</span>],
    ["Venue", <VenueTag key="v" venue={venue} />],
    ["Strategy", FAMILY_LABEL[family] ?? family],
    ["Template", appliedTemplate?.label ?? "Custom"],
    ["Estimator", family === "AI_RESEARCH" ? "AI with baseline fallback" : "Baseline heuristic"],
    ["Entry", `edge ≥ ${minEdge} pts`],
    ["Exit", `edge < ${exitEdge} pts · ≤ ${holdTicks} ticks`],
    ["Allocation", money(allocated * 100)],
    ["Per position", money(posCap * 100)],
    ["Max positions", String(maxOpen)],
    ["Daily stop", `${dailyLoss}%`],
    ["Drawdown stop", `${drawdown}%`],
    ["Mode", "Paper draft"],
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<Bot size={24} />}
        title="Create a robot"
        subtitle="Three choices and it's ready. Every robot starts with practice money."
        actions={<button className={btn.ghost} onClick={() => setAdvanced((v) => !v)}><SlidersHorizontal size={16} /> {advanced ? "Back to simple setup" : "Advanced settings"}</button>}
      />
        <>
          {guided && (
            <Panel title={`${guided.robotName} is ready`} subtitle={`${guided.templateLabel ? `Based on “${guided.templateLabel}”. ` : ""}It's running with practice money. Two optional checks build confidence:`} icon={<CheckCircle2 size={18} />}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <GuidedStep done n={1} title="Robot created" body="Saved and running with practice money." />
                <GuidedStep done={guidedDone.cycle} n={2} title="Do a first check" body="The robot looks at its markets once and writes down what it decided, and why."
                  action={<button className={btn.small} disabled={guidedBusy !== null} onClick={() => runGuidedStep("cycle")}>{guidedBusy === "cycle" ? "Checking…" : guidedDone.cycle ? "Check again" : "Check markets now"}</button>} />
                <GuidedStep done={guidedDone.backtest} n={3} title="Test on past prices" body="Replays real past prices, with fees and bad fills, to see how it would have done. Evidence, never a promise."
                  action={<button className={btn.small} disabled={guidedBusy !== null} onClick={() => runGuidedStep("backtest")}>{guidedBusy === "backtest" ? "Testing…" : guidedDone.backtest ? "Test again" : "Test on past prices"}</button>} />
              </div>
              {onOpenRobot && <button className={`${btn.secondary} mt-4`} onClick={() => onOpenRobot(guided.robotId)}>Open {guided.robotName} <ArrowRight size={16} /></button>}
            </Panel>
          )}

          {!advanced ? (
            <QuickSetup
              templates={templates}
              applied={appliedTemplate}
              custom={custom}
              onPickTemplate={fillFromTemplate}
              onCustom={() => { setAppliedTemplate(null); setCustom(true); applyPreset(riskLevel, allocated); }}
              onBrowseTemplates={onBrowseTemplates}
              family={family}
              setFamily={setFamily}
              venue={venue}
              setVenue={setVenue}
              venueStats={dash?.venues ?? []}
              allocated={allocated}
              setAllocated={(v) => { setAllocated(v); applyPreset(riskLevel, v); }}
              riskLevel={riskLevel}
              setRiskLevel={(l) => applyPreset(l, allocated)}
              posCap={posCap}
              maxOpen={maxOpen}
              dailyLoss={dailyLoss}
              drawdown={drawdown}
              name={name}
              setName={setName}
              nameOk={nameOk}
              saving={saving}
              onStart={submit}
            />
          ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[250px_minmax(0,1fr)_320px]">
            {/* progress */}
            <nav aria-label="Robot creation steps" className="h-fit rounded-2xl border border-[var(--fd-border)] fd-glass bg-[var(--fd-surface)] p-2.5">
              <ol className="flex gap-1 overflow-x-auto xl:flex-col">
                {STEPS.map((s) => {
                  const on = s.id === step;
                  const done = s.id < step;
                  return (
                    <li key={s.id} className="shrink-0">
                      <button
                        onClick={() => (s.id === 1 || nameOk ? setStep(s.id) : setStep(1))}
                        aria-current={on ? "step" : undefined}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${on ? "bg-[#2583FF]/14" : "hover:bg-[color:var(--fd-ink)]/[0.03]"}`}
                      >
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-bold ${on ? "bg-[#2583FF] text-white" : done ? "bg-[#00D69A]/15 text-[var(--fd-green-text)]" : "bg-[color:var(--fd-ink)]/[0.05] text-[var(--fd-text3)]"}`}>
                          {done ? <CheckCircle2 size={16} /> : s.id}
                        </span>
                        <span className={`whitespace-nowrap text-[14.5px] ${on ? "font-semibold text-[var(--fd-strong)]" : "text-[var(--fd-text2)]"}`}>{s.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>

            {/* main */}
            <div className="flex min-w-0 flex-col gap-5">
              {step === 1 && (
                <Panel title="1. Robot identity" subtitle="Name your robot, or start from a ready-made robot that fills in every step">
                  <label className="block text-[14px] font-medium text-[var(--fd-text-soft)]" htmlFor="robot-name">Robot name</label>
                  <input id="robot-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Senate Edge" className="mt-2 h-12 w-full rounded-xl border border-[var(--fd-border2)] bg-[var(--fd-bg2)] px-4 text-[16px] text-[var(--fd-strong)] placeholder:text-[var(--fd-text3)]" aria-invalid={!nameOk && name.length > 0} />
                  {!nameOk && <p className="mt-1.5 text-[13px] text-[var(--fd-text3)]">At least two characters.</p>}
                  <h3 className="mb-3 mt-7 text-[15px] font-semibold text-[var(--fd-strong)]">Start from a ready-made robot</h3>
                  {templates.length === 0 ? (
                    <p className="text-[14px] text-[var(--fd-text2)]">No ready-made robots available right now. Continue to configure from scratch.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {templates.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => applyTemplate(t)}
                          disabled={!t.venueLive}
                          className="rounded-2xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] p-4 text-left transition-colors enabled:hover:border-[#2583FF]/60 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[15.5px] font-semibold text-[var(--fd-strong)]">{t.label}</span>
                            <Badge tone={t.riskProfile === "CONSERVATIVE" ? "green" : t.riskProfile === "AGGRESSIVE" ? "red" : "blue"}>{t.riskProfile.toLowerCase()}</Badge>
                          </div>
                          <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--fd-text2)]">{t.thesis}</p>
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--fd-text3)]">
                            <VenueTag venue={t.venue} />
                            <span>edge ≥ {t.strategy.minEdgePts} pts</span>
                            <span>· {money(t.capital.allocatedCents)}</span>
                            {!t.venueLive && <span>· venue offline</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-4 text-[13px] text-[var(--fd-text3)]">Templates are starting points, not performance promises. Each robot still earns its own evidence.</p>
                </Panel>
              )}

              {step === 2 && (
                <Panel title="2. Venue selection" subtitle="Each robot trades on exactly one venue">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {VENUES.map((v) => {
                      const live = v.adapter === "LIVE";
                      const on = venue === v.id;
                      const st = dash?.venues.find((s) => s.venue === v.id);
                      return (
                        <button
                          key={v.id}
                          onClick={() => setVenue(v.id)}
                          disabled={!live}
                          aria-pressed={on}
                          className="rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                          style={{ borderColor: on ? v.hex : "var(--fd-border)", background: on ? `color-mix(in srgb, ${v.hex} 10%, var(--fd-bg2))` : "var(--fd-bg2)" }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2.5 text-[16px] font-semibold text-[var(--fd-strong)]"><span className="h-3 w-3 rounded-full" style={{ background: v.hex }} />{v.label}</span>
                            {live ? <Badge tone="green" dot>Live</Badge> : <Badge tone={v.id === "DRIFT_BET" ? "red" : "amber"}>{v.id === "DRIFT_BET" ? "Suspended" : "Coming soon"}</Badge>}
                          </div>
                          <p className="mt-2 text-[13.5px] text-[var(--fd-text2)]">{live ? `${st?.markets ?? 0} markets synced · ${st?.robotsTotal ?? 0} robots` : "Robot creation is disabled until the adapter is live."}</p>
                        </button>
                      );
                    })}
                  </div>
                </Panel>
              )}

              {step === 3 && (
                <>
                  <Panel title="3. Strategy" subtitle="How the robot decides to trade">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {FAMILIES.map((f) => {
                        const info = FAMILY_INFO[f.id];
                        const on = family === f.id;
                        const disabled = f.id === "ARBITRAGE";
                        return (
                          <button key={f.id} onClick={() => setFamily(f.id)} disabled={disabled} aria-pressed={on}
                            className={`rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-[#2583FF] bg-[#2583FF]/[0.08]" : "border-[var(--fd-border)] bg-[var(--fd-bg2)] enabled:hover:border-[var(--fd-border2)]"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[16px] font-semibold text-[var(--fd-strong)]">{f.label}</span>
                              <Badge tone={info.tone}>{info.risk}</Badge>
                            </div>
                            <p className="mt-1.5 text-[13.5px] text-[var(--fd-text2)]">{f.desc}</p>
                            <dl className="mt-3 grid grid-cols-1 gap-1.5 text-[13px]">
                              <div><dt className="inline text-[var(--fd-text3)]">Best for: </dt><dd className="inline text-[var(--fd-text-soft)]">{info.when}</dd></div>
                              <div><dt className="inline text-[var(--fd-text3)]">Entry: </dt><dd className="inline text-[var(--fd-text-soft)]">{info.entry}</dd></div>
                              <div><dt className="inline text-[var(--fd-text3)]">Exit: </dt><dd className="inline text-[var(--fd-text-soft)]">{info.exit}</dd></div>
                              <div><dt className="inline text-[var(--fd-text3)]">Suggested capital: </dt><dd className="fd-num inline text-[var(--fd-text-soft)]">{info.capital}</dd></div>
                              <div><dt className="inline text-[var(--fd-text3)]">Venues: </dt><dd className="inline text-[var(--fd-text-soft)]">{disabled ? "Planned" : "All live venues"}</dd></div>
                            </dl>
                          </button>
                        );
                      })}
                    </div>
                  </Panel>
                  <Panel title="Markets this robot will evaluate" subtitle={`Every open market on ${VENUE_LABEL[venue]}. The robot only trades where its entry rule and the risk checks pass.`}>
                    {venueMarkets.length === 0 ? (
                      <EmptyState compact title={`No ${VENUE_LABEL[venue]} markets synced yet`} body="Sync the venue from the Overview or Markets page." />
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {venueMarkets.slice(0, 6).map((m) => (
                          <li key={m.id} className="flex items-center gap-3 rounded-xl border border-[var(--fd-line)] bg-[var(--fd-bg2)] px-4 py-3">
                            <span className="h-8 w-1 rounded-full" style={{ background: vhex }} aria-hidden />
                            <span className="min-w-0 flex-1 truncate text-[14.5px] text-[var(--fd-strong)]">{m.question}</span>
                            <span className="fd-num rounded-lg bg-[#00D69A]/12 px-2 py-1 text-[13px] font-semibold text-[var(--fd-green-text)]">{m.yesPriceCents ?? "—"}%</span>
                          </li>
                        ))}
                        {venueMarkets.length > 6 && <li className="text-[13px] text-[var(--fd-text3)]">+ {venueMarkets.length - 6} more markets</li>}
                      </ul>
                    )}
                  </Panel>
                </>
              )}

              {step === 4 && (
                <Panel title="4. AI model & intelligence" subtitle="Where the robot's probability estimate comes from">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <InfoCard title="Estimator" icon={<Brain size={17} />}>
                      {family === "AI_RESEARCH" ? "AI estimator chain: registry model, evidence screening, cache, and the baseline as a fallback." : "Baseline heuristic estimator: deterministic, no AI cost. Switch the strategy to AI Research to use AI models."}
                    </InfoCard>
                    <InfoCard title="AI providers" icon={<Cpu size={17} />}>
                      {enabledProviders.length > 0 ? `${enabledProviders.map((p) => `${p.name} (${p.model})`).join(", ")} enabled.` : "No AI provider enabled. Add a key in Settings › AI Providers; robots upgrade automatically."}
                    </InfoCard>
                    <InfoCard title="AI budget" icon={<Wallet size={17} />}>
                      {(dash?.providers ?? []).length ? `${money((dash?.providers ?? []).reduce((a, p) => a + p.spentCents, 0))} spent of ${money((dash?.providers ?? []).reduce((a, p) => a + p.monthlyBudgetCents, 0))} this month. Robots pause when the budget runs out.` : "No providers configured."}
                    </InfoCard>
                    <InfoCard title="Decision explanations" icon={<Shield size={17} />}>
                      Every evaluation records the model, its provenance, the estimate, the market price and each risk check, visible in the robot&apos;s decision journal.
                    </InfoCard>
                  </div>
                  <div className="mt-6">
                    <SliderRow label="Estimator tilt (contrarian fade)" value={`${tilt}%`} help="How strongly the baseline estimate fades the market price toward 50%.">
                      <Slider value={[tilt]} onValueChange={(v) => setTilt(v[0])} min={0} max={40} step={1} aria-label="Estimator tilt" />
                    </SliderRow>
                  </div>
                </Panel>
              )}

              {step === 5 && (
                <Panel title="5. Entry conditions" subtitle="When the robot is allowed to open a position">
                  <SliderRow label="Minimum edge at entry (confidence threshold)" value={`${minEdge} pts`} help="Model estimate minus market price, net of fees. Entries below this edge are refused.">
                    <Slider value={[minEdge]} onValueChange={(v) => setMinEdge(v[0])} min={1} max={25} step={1} aria-label="Minimum edge" />
                  </SliderRow>
                  <div className="mt-5 rounded-xl border border-[#2583FF]/25 bg-[#2583FF]/[0.06] p-4 text-[14px] leading-relaxed text-[var(--fd-text-soft)]">
                    Edge alone never places a trade. Every entry also passes the risk checks: data freshness, book depth, exposure caps, daily loss and drawdown stops.
                  </div>
                </Panel>
              )}

              {step === 6 && (
                <Panel title="6. Exit conditions" subtitle="When the robot closes a position">
                  <div className="flex flex-col gap-6">
                    <SliderRow label="Exit when edge falls below" value={`${exitEdge} pts`} help="The position closes once the original thesis is gone.">
                      <Slider value={[exitEdge]} onValueChange={(v) => setExitEdge(v[0])} min={0} max={10} step={1} aria-label="Exit edge" />
                    </SliderRow>
                    <SliderRow label="Maximum hold" value={`${holdTicks} ticks`} help="A hard time stop: every position ends somewhere.">
                      <Slider value={[holdTicks]} onValueChange={(v) => setHoldTicks(v[0])} min={3} max={60} step={1} aria-label="Maximum hold" />
                    </SliderRow>
                    <KV k="Also exits on" v="Adverse verified information" />
                  </div>
                </Panel>
              )}

              {step === 7 && (
                <Panel title="7. Capital & risk" subtitle="Limits the risk engine enforces for this robot">
                  <div className="flex flex-col gap-6">
                    <SliderRow label="Robot allocation" value={money(allocated * 100)} help="Total paper capital this robot may deploy.">
                      <Slider value={[allocated]} onValueChange={(v) => { setAllocated(v[0]); if (posCap > v[0]) setPosCap(v[0]); }} min={100} max={10000} step={100} aria-label="Allocation" />
                    </SliderRow>
                    <SliderRow label="Per-position cap" value={money(posCap * 100)} help="Largest single order.">
                      <Slider value={[posCap]} onValueChange={(v) => setPosCap(v[0])} min={50} max={Math.max(50, Math.min(allocated, 2000))} step={50} aria-label="Per-position cap" />
                    </SliderRow>
                    <SliderRow label="Maximum open positions" value={String(maxOpen)}>
                      <Slider value={[maxOpen]} onValueChange={(v) => setMaxOpen(v[0])} min={1} max={10} step={1} aria-label="Maximum open positions" />
                    </SliderRow>
                    <SliderRow label="Daily loss limit" value={`${dailyLoss}%`} help={`Platform maximum ${platformMaxDaily}%.`}>
                      <Slider value={[dailyLoss]} onValueChange={(v) => setDailyLoss(Math.min(v[0], platformMaxDaily))} min={1} max={platformMaxDaily} step={1} aria-label="Daily loss limit" />
                    </SliderRow>
                    <SliderRow label="Drawdown limit" value={`${drawdown}%`} help={`Platform maximum ${platformMaxDd}%.`}>
                      <Slider value={[drawdown]} onValueChange={(v) => setDrawdown(Math.min(v[0], platformMaxDd))} min={1} max={platformMaxDd} step={1} aria-label="Drawdown limit" />
                    </SliderRow>
                    <KV k="Per-market exposure" v={`Capped by the platform per-event limit (${dash?.exposureLimitPct ?? 40}% of allocation)`} />
                  </div>
                </Panel>
              )}

              {step === 8 && (
                <Panel title="8. Execution settings" subtitle="How orders reach the venue. These follow the venue's rules and the platform mode.">
                  <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
                    <div>
                      <KV k="Execution mode" v={<Badge tone="amber" dot>Paper</Badge>} />
                      <KV k="Order type" v="Limit at the venue's best price" />
                      <KV k="Execution frequency" v="Every robot cycle (manual or autopilot)" />
                      <KV k="Schedule" v="Continuous, in the cloud" />
                    </div>
                    <div>
                      <KV k="Minimum liquidity" v={rules.minTouchDepthCents != null ? `${money(rules.minTouchDepthCents)} at the touch` : "Not required on this venue"} />
                      <KV k="Per-market cap" v={rules.perMarketPositionCapCents != null ? money(rules.perMarketPositionCapCents) : "Not set on this venue"} />
                      <KV k="Close window" v={rules.minMinutesBeforeClose != null ? `No entries ${rules.minMinutesBeforeClose} min before close` : "Not set on this venue"} />
                      <KV k="Data freshness" v="Refuses to decide on stale prices" />
                    </div>
                  </div>
                </Panel>
              )}

              {step === 9 && (
                <Panel title="9. Review & activation" subtitle="Check the summary, then start the robot with practice money">
                  <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
                    <div>{summary.slice(0, 7).map(([k, v]) => <KV key={k} k={k} v={v} />)}</div>
                    <div>{summary.slice(7).map(([k, v]) => <KV key={k} k={k} v={v} />)}</div>
                  </div>
                  <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <GateRow title="Backtest" body="Required before live" />
                    <GateRow title="Paper session" body="Required before live" />
                    <GateRow title="Recorded consent" body="Required before live" />
                  </div>
                  <button className={`${btn.primary} mt-6 h-12 w-full text-[15.5px]`} disabled={!nameOk || saving} onClick={submit}>
                    <Save size={17} /> {saving ? "Starting…" : "Start robot with practice money"}
                  </button>
                  {!nameOk && <p className="mt-2 text-[13px] text-[var(--fd-amber-text)]">Add a robot name in step 1 first.</p>}
                  <p className="mt-2 text-[13px] text-[var(--fd-text3)]">Saving never activates live trading. Real money stays locked until the evidence checks, a past-price test, a practice session and your recorded consent all pass.</p>
                </Panel>
              )}

              <div className="sticky bottom-[92px] z-10 flex flex-wrap items-center gap-2.5 rounded-2xl fd-glass-strong border border-[var(--fd-border)] p-3 md:bottom-3">
                <button className={btn.secondary} onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1}><ArrowLeft size={16} /> Previous</button>
                <button className={btn.ghost} onClick={submit} disabled={!nameOk || saving} title="Start the robot now with these settings, using practice money"><Save size={16} /> Start now</button>
                <span className="ml-auto text-[13px] text-[var(--fd-text3)]">Step {step} of {STEPS.length}</span>
                {step < 9 ? (
                  <>
                    <button className={btn.ghost} onClick={() => (nameOk ? setStep(9) : setStep(1))}>Review robot</button>
                    <button className={btn.primary} onClick={() => setStep(Math.min(9, step + 1))} disabled={!canNext}>Next <ArrowRight size={16} /></button>
                  </>
                ) : (
                  <button className={btn.primary} onClick={submit} disabled={!nameOk || saving}><Rocket size={16} /> Save robot</button>
                )}
              </div>
            </div>

            {/* summary */}
            <aside className="h-fit rounded-2xl border border-[var(--fd-border)] fd-glass bg-[var(--fd-surface)] p-5 xl:sticky xl:top-20">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[16px] font-semibold text-[var(--fd-strong)]">Configuration summary</h2>
                <Badge tone="amber" dot>Paper</Badge>
              </div>
              {summary.map(([k, v]) => <KV key={k} k={k} v={v} />)}
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-[color:var(--fd-ink)]/[0.03] p-3 text-[13px] text-[var(--fd-text2)]"><Lock size={15} /> Live activation is locked behind the safety gates.</div>
            </aside>
          </div>
          )}
        </>
    </div>
  );
}

function SliderRow({ label, value, help, children }: { label: string; value: string; help?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-[14.5px] font-medium text-[var(--fd-text-soft)]">{label}</span>
        <span className="fd-num text-[16px] font-semibold text-[var(--fd-strong)]">{value}</span>
      </div>
      {children}
      {help && <p className="mt-2 text-[13px] text-[var(--fd-text3)]">{help}</p>}
    </div>
  );
}

function InfoCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] p-4">
      <div className="flex items-center gap-2 text-[14.5px] font-semibold text-[var(--fd-strong)]"><span className="text-[var(--fd-blue-text)]">{icon}</span>{title}</div>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--fd-text2)]">{children}</p>
    </div>
  );
}

function GateRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] p-3">
      <Lock size={16} className="text-[var(--fd-text3)]" />
      <div><div className="text-[14px] font-medium text-[var(--fd-strong)]">{title}</div><div className="text-[12.5px] text-[var(--fd-text3)]">{body}</div></div>
    </div>
  );
}

function GuidedStep({ done, n, title, body, action }: { done: boolean; n: number; title: string; body: string; action?: ReactNode }) {
  return (
    <div className={`flex flex-col gap-2 rounded-2xl border p-4 ${done ? "border-[#00D69A]/35 bg-[#00D69A]/[0.05]" : "border-[var(--fd-border)] bg-[var(--fd-bg2)]"}`}>
      <div className="flex items-center gap-2.5">
        <span className={`grid h-7 w-7 place-items-center rounded-full text-[13px] font-bold ${done ? "bg-[#00D69A]/20 text-[var(--fd-green-text)]" : "bg-[color:var(--fd-ink)]/[0.06] text-[var(--fd-text2)]"}`}>{done ? "✓" : n}</span>
        <span className="text-[15px] font-semibold text-[var(--fd-strong)]">{title}</span>
      </div>
      <p className="text-[13.5px] text-[var(--fd-text2)]">{body}</p>
      {action}
    </div>
  );
}

// ── Quick setup (default) ───────────────────────────────────────────────
// Three plain choices: what to start from, where it trades, how much money
// and how careful. One risk word sets every limit; the full nine-step
// builder stays one click away under "Advanced settings".

type RiskLevel = "CAREFUL" | "BALANCED" | "BOLD";
const PRESETS: Record<RiskLevel, { label: string; desc: string; perTradePct: number; maxOpen: number; daily: number; drawdown: number; minEdge: number; exitEdge: number }> = {
  CAREFUL: { label: "Careful", desc: "Small trades, only clear chances, stops early.", perTradePct: 5, maxOpen: 3, daily: 3, drawdown: 8, minEdge: 10, exitEdge: 3 },
  BALANCED: { label: "Balanced", desc: "Medium trades, stops after a normal bad day.", perTradePct: 10, maxOpen: 4, daily: 5, drawdown: 10, minEdge: 8, exitEdge: 2 },
  BOLD: { label: "Bold", desc: "Bigger trades, more chances, wider stops.", perTradePct: 20, maxOpen: 6, daily: 8, drawdown: 15, minEdge: 5, exitEdge: 1 },
};

const FAMILY_PLAIN: Record<string, string> = {
  PROBABILITY_EDGE: "Buys when its estimate says the price is clearly too low or too high.",
  MARKET_MAKING: "Offers to buy and sell around a fair price and earns the gap in between.",
  AI_RESEARCH: "Uses AI to read the evidence and trades when it moves the odds.",
};

function QuickSetup(props: {
  templates: TemplateDTO[];
  applied: TemplateDTO | null;
  custom: boolean;
  onPickTemplate: (t: TemplateDTO) => void;
  onCustom: () => void;
  onBrowseTemplates?: () => void;
  family: string;
  setFamily: (f: string) => void;
  venue: string;
  setVenue: (v: string) => void;
  venueStats: Array<{ venue: string; markets: number }>;
  allocated: number;
  setAllocated: (v: number) => void;
  riskLevel: RiskLevel;
  setRiskLevel: (l: RiskLevel) => void;
  posCap: number;
  maxOpen: number;
  dailyLoss: number;
  drawdown: number;
  name: string;
  setName: (v: string) => void;
  nameOk: boolean;
  saving: boolean;
  onStart: () => void;
}) {
  const p = props;
  const { data: avail } = useAvailability();
  const live = VENUES.filter((v) => v.adapter === "LIVE");
  const chosen = availabilityFor(avail, p.venue);
  const chosenReal = VENUE_GUIDES.find((g) => g.venue === p.venue)?.realMoney ?? false;
  const choiceCls = (on: boolean) =>
    `rounded-2xl border p-4 text-left transition-colors ${on ? "border-[var(--fd-brand-text)] bg-[color:var(--fd-brand-text)]/[0.08]" : "border-[var(--fd-border)] bg-[var(--fd-bg2)] hover:border-[var(--fd-border2)]"}`;
  const ready = p.nameOk && (p.applied != null || p.custom);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-5">
        <Panel title="1. Pick a starting point" subtitle="A ready-made robot fills in a proven strategy for you. You can also build your own.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {p.templates.filter((t) => t.venueLive).slice(0, 5).map((t) => (
              <button key={t.id} onClick={() => p.onPickTemplate(t)} aria-pressed={p.applied?.id === t.id} className={choiceCls(p.applied?.id === t.id)}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[15.5px] font-semibold text-[var(--fd-strong)]">{t.label}</span>
                  <Badge tone={t.riskProfile === "CONSERVATIVE" ? "green" : t.riskProfile === "AGGRESSIVE" ? "red" : "blue"}>{t.riskProfile === "CONSERVATIVE" ? "Careful" : t.riskProfile === "AGGRESSIVE" ? "Bold" : "Balanced"}</Badge>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-[var(--fd-text2)]">{t.thesis}</p>
                <div className="mt-2.5"><VenueTag venue={t.venue} /></div>
              </button>
            ))}
            <button onClick={p.onCustom} aria-pressed={p.custom && !p.applied} className={choiceCls(p.custom && !p.applied)}>
              <span className="text-[15.5px] font-semibold text-[var(--fd-strong)]">Build my own</span>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--fd-text2)]">Choose the strategy and the venue yourself.</p>
            </button>
          </div>
          {p.onBrowseTemplates && p.templates.length > 5 && (
            <button className="mt-3 text-[14px] font-semibold text-[var(--fd-brand-text)] hover:underline" onClick={p.onBrowseTemplates}>See all {p.templates.length} ready-made robots →</button>
          )}

          {p.custom && !p.applied && (
            <div className="mt-5">
              <h3 className="mb-2.5 text-[14.5px] font-semibold text-[var(--fd-strong)]">How should it trade?</h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {FAMILIES.filter((f) => f.id !== "ARBITRAGE").map((f) => (
                  <button key={f.id} onClick={() => p.setFamily(f.id)} aria-pressed={p.family === f.id} className={choiceCls(p.family === f.id)}>
                    <span className="text-[15px] font-semibold text-[var(--fd-strong)]">{FAMILY_LABEL[f.id] ?? f.label}</span>
                    <p className="mt-1 text-[13px] leading-relaxed text-[var(--fd-text2)]">{FAMILY_PLAIN[f.id]}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="2. Where should it trade?" subtitle="Each robot trades on one venue.">
          <div className="flex flex-wrap gap-2.5">
            {live.map((v) => {
              const on = p.venue === v.id;
              const n = p.venueStats.find((s) => s.venue === v.id)?.markets ?? 0;
              return (
                <button key={v.id} onClick={() => p.setVenue(v.id)} aria-pressed={on}
                  className="flex items-center gap-2.5 rounded-full border px-4 py-2.5 text-[14.5px] font-semibold transition-colors"
                  style={{ borderColor: on ? v.hex : "var(--fd-border)", background: on ? `color-mix(in srgb, ${v.hex} 14%, transparent)` : "var(--fd-bg2)", color: "var(--fd-strong)" }}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: v.hex }} aria-hidden />
                  {v.label}
                  <span className="text-[12.5px] font-normal text-[var(--fd-text3)]">{n} markets</span>
                  {(() => { const a = availabilityFor(avail, v.id); const real = VENUE_GUIDES.find((g) => g.venue === v.id)?.realMoney; return a && real && !a.realMoney ? <span className="rounded-full bg-[#FFB547]/15 px-2 py-0.5 text-[11.5px] font-semibold text-[var(--fd-amber-text)]">practice only</span> : null; })()}
                </button>
              );
            })}
          </div>
          {p.venue === "MANIFOLD" && <p className="mt-3 text-[13px] text-[var(--fd-text3)]">Manifold uses play money only: a safe place to try things.</p>}
          {chosen && chosenReal && !chosen.realMoney && (
            <p className="mt-3 text-[13px] leading-snug text-[var(--fd-amber-text)]">
              Real money on {VENUE_LABEL[p.venue]} is <b>{STATUS_LABEL[chosen.status].toLowerCase()}</b> in {chosen.country}: {chosen.note} You can still practice here.
            </p>
          )}
        </Panel>

        <Panel title="3. Money & safety" subtitle="How much it may use, and how careful it should be.">
          <SliderRow label="Money this robot may use" value={money(p.allocated * 100)} help="Practice money. It never uses more than this.">
            <Slider value={[p.allocated]} onValueChange={(v) => p.setAllocated(v[0])} min={100} max={10000} step={100} aria-label="Money this robot may use" />
          </SliderRow>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(Object.keys(PRESETS) as RiskLevel[]).map((l) => (
              <button key={l} onClick={() => p.setRiskLevel(l)} aria-pressed={p.riskLevel === l} className={choiceCls(p.riskLevel === l)}>
                <span className="text-[15px] font-semibold text-[var(--fd-strong)]">{PRESETS[l].label}</span>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--fd-text2)]">{PRESETS[l].desc}</p>
              </button>
            ))}
          </div>
          <label className="mt-6 block text-[14px] font-medium text-[var(--fd-text-soft)]" htmlFor="quick-name">Robot name</label>
          <input id="quick-name" value={p.name} onChange={(e) => p.setName(e.target.value)} placeholder="e.g. Election Watcher" className="mt-2 h-12 w-full rounded-xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] px-4 text-[16px] text-[var(--fd-strong)] placeholder:text-[var(--fd-text3)]" />
        </Panel>
      </div>

      <aside className="fd-glass h-fit rounded-3xl border border-[var(--fd-border)] bg-[var(--fd-surface)] p-5 xl:sticky xl:top-20">
        <h2 className="text-[17px] font-semibold text-[var(--fd-strong)]">{p.name.trim() || "Your robot"}</h2>
        <p className="mt-1 text-[13.5px] text-[var(--fd-text2)]">{p.applied ? `Based on “${p.applied.label}”` : FAMILY_LABEL[p.family] ?? p.family} on {VENUE_LABEL[p.venue]}</p>
        <ul className="mt-4 flex flex-col gap-2.5 text-[14px] leading-snug text-[var(--fd-text-soft)]">
          <li>Uses up to <b className="fd-num text-[var(--fd-strong)]">{money(p.allocated * 100)}</b>, never more than <b className="fd-num text-[var(--fd-strong)]">{money(p.posCap * 100)}</b> on one trade.</li>
          <li>Holds at most <b className="text-[var(--fd-strong)]">{p.maxOpen}</b> trades at once.</li>
          <li>Stops for the day after losing <b className="text-[var(--fd-strong)]">{p.dailyLoss}%</b>, and pauses if it falls <b className="text-[var(--fd-strong)]">{p.drawdown}%</b> from its best.</li>
          <li>Starts with <b className="text-[var(--fd-strong)]">practice money</b>. Real money stays locked until it passes the safety checks.</li>
        </ul>
        <button className={`${btn.primary} mt-5 h-12 w-full text-[15.5px]`} disabled={!ready || p.saving} onClick={p.onStart}>
          <Rocket size={17} /> {p.saving ? "Starting…" : "Start robot"}
        </button>
        {!ready && <p className="mt-2 text-center text-[13px] text-[var(--fd-text3)]">{!p.applied && !p.custom ? "Pick a starting point first." : "Give your robot a name."}</p>}
      </aside>
    </div>
  );
}
