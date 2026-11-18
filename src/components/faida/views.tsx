"use client";

// FAIDA Predict — Studio (wizard + strategy lab), Trading, Settings.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type TemplateDTO,
  type VersionDTO,
  FAMILIES,
} from "./types";
import { FAMILY_LABEL } from "./types";
import { StateChip, VenueBadge, card, c, fmtCents, mono, venueScopeStyle } from "./ui";
import { ROLE_LABEL, VENUES, VENUE_LABEL, isVenue } from "@/lib/venues";

// Tolerant JSON parse — never let a transient empty response crash the UI.
async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── Robot Studio ─────────────────────────────────────────────────────────────
export function StudioView({ dash, onCreate, onAfterChange, initialVenue, onAction }: { dash: DashboardDTO | null; onCreate: (p: unknown) => Promise<unknown>; onAfterChange?: () => void; initialVenue?: string; onAction?: (url: string, body: unknown, okMsg: string) => Promise<unknown> }) {
  const [step, setStep] = useState(1);
  const [family, setFamily] = useState<string>("PROBABILITY_EDGE");
  // B11: every robot is scoped to exactly one venue; only live adapters selectable.
  // initialVenue pre-scopes the wizard when arriving from a venue workspace.
  const [venue, setVenue] = useState<string>(initialVenue && isVenue(initialVenue) ? initialVenue : "POLYMARKET");
  const [name, setName] = useState("");
  const [allocated, setAllocated] = useState(2000); // dollars
  const [posCap, setPosCap] = useState(200);
  const [maxOpen, setMaxOpen] = useState(4);
  const [dailyLoss, setDailyLoss] = useState(5);
  const [drawdown, setDrawdown] = useState(10);
  // C5 strategy knobs — set by a template (P-03) or tuned by hand in step 2;
  // the cycle engine reads them from the immutable strategy version.
  const [minEdge, setMinEdge] = useState(8);
  const [tilt, setTilt] = useState(25);
  const [exitEdge, setExitEdge] = useState(2);
  const [holdTicks, setHoldTicks] = useState(12);
  const platformMaxDaily = dash?.risk.find((r) => r.key === "DAILY_LOSS_STOP_PCT" && r.scope === "PLATFORM")?.valueNum ?? 20;
  const platformMaxDd = dash?.risk.find((r) => r.key === "DRAWDOWN_STOP_PCT" && r.scope === "PLATFORM")?.valueNum ?? 30;

  // P-03: template gallery + guided session (template → first backtest in one run).
  const [templates, setTemplates] = useState<TemplateDTO[]>([]);
  const [appliedTemplate, setAppliedTemplate] = useState<TemplateDTO | null>(null);
  const [guided, setGuided] = useState<{ robotId: string; robotName: string; templateLabel: string | null } | null>(null);
  const [guidedDone, setGuidedDone] = useState<{ cycle: boolean; backtest: boolean }>({ cycle: false, backtest: false });
  const [guidedBusy, setGuidedBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/robot-templates")
      .then((r) => (r.ok ? safeJson<{ templates: TemplateDTO[] }>(r) : null))
      .then((j) => j?.templates && setTemplates(j.templates))
      .catch(() => {/* transient — gallery stays empty, scratch path unaffected */});
  }, []);

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
    setStep(5); // one click lands on Review — the guided session carries the rest
  };

  const steps = ["Robot family", "Strategy & model", "Capital & risk", "Execution", "Review & activation"];
  const canNext = step !== 1 || name.trim().length > 1;

  const submit = async () => {
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
      // P-03 guided session: keep the template context and walk the user to
      // the first cycle and the first backtest — one session, no hunting.
      setGuided({ robotId: res.robot.id, robotName: res.robot.name ?? name.trim(), templateLabel: appliedTemplate?.label ?? null });
      setGuidedDone({ cycle: false, backtest: false });
    }
    setAppliedTemplate(null);
    setStep(1);
    setName("");
  };

  const runGuidedStep = async (what: "cycle" | "backtest") => {
    if (!guided) return;
    setGuidedBusy(what);
    try {
      if (what === "cycle") {
        const res = (await onAction?.("/api/cycle", { action: "CYCLE" }, "Cycle complete — trace recorded")) as { summaries?: Array<{ robotId?: string }> } | undefined;
        if (res?.summaries?.some((s) => s.robotId === guided.robotId)) setGuidedDone((d) => ({ ...d, cycle: true }));
      } else {
        const res = (await onAction?.("/api/backtests", { robotId: guided.robotId }, "First backtest complete — evidence recorded (A-05)")) as Record<string, unknown> | undefined;
        if (res && res.ok !== false) setGuidedDone((d) => ({ ...d, backtest: true }));
      }
      onAfterChange?.();
    } finally {
      setGuidedBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-semibold">Robot Studio</h1>
        <span className={`text-[12px] ${c.text3}`}>one decision per step — activation stays off until the Phase 7 gates pass (C5)</span>
      </div>

      {/* P-03 guided session — template → first cycle → first backtest, one run */}
      {guided && (
        <div className={`${card} border-[#00B0F0]/40 p-4`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${c.bright} bg-[#00B0F0]/10`}>GUIDED SESSION</span>
            <span className="text-[13px] font-semibold">From {guided.templateLabel ? `template “${guided.templateLabel}”` : "scratch"} to first backtest — {guided.robotName}</span>
          </div>
          <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className={`rounded-lg border p-2.5 ${c.border} ${guidedDone.cycle || guidedDone.backtest ? "border-[#2FC08E]/40" : ""}`}>
              <div className="flex items-center gap-2 text-[12px] font-semibold"><span className={guidedDone.cycle || guidedDone.backtest ? c.gain : c.text3}>✓</span>1 · Robot created</div>
              <div className={`mt-0.5 text-[10.5px] ${c.text3}`}>PAPER_ONLY draft saved with the template config (C5 v1)</div>
            </div>
            <div className={`rounded-lg border p-2.5 ${c.border} ${guidedDone.cycle ? "border-[#2FC08E]/40" : ""}`}>
              <div className="flex items-center gap-2 text-[12px] font-semibold"><span className={guidedDone.cycle ? c.gain : c.text3}>{guidedDone.cycle ? "✓" : "2"}</span>Run the first cycle</div>
              <div className={`mt-0.5 text-[10.5px] ${c.text3}`}>Every robot evaluates its book; the trace lands on the dashboard (A-08)</div>
              <Button size="sm" variant="outline" className={`mt-2 h-7 border-[#2E3C5F] bg-[#151D30] text-[9px] text-[#9AA8C0] hover:bg-[#1B2540]`} disabled={guidedBusy !== null} onClick={() => runGuidedStep("cycle")}>
                {guidedBusy === "cycle" ? "Running cycle…" : guidedDone.cycle ? "Run again" : "Run first cycle"}
              </Button>
            </div>
            <div className={`rounded-lg border p-2.5 ${c.border} ${guidedDone.backtest ? "border-[#2FC08E]/40" : ""}`}>
              <div className="flex items-center gap-2 text-[12px] font-semibold"><span className={guidedDone.backtest ? c.gain : c.text3}>{guidedDone.backtest ? "✓" : "3"}</span>Run the first backtest</div>
              <div className={`mt-0.5 text-[10.5px] ${c.text3}`}>Recorded-tick replay with adverse slippage + fees (A-05 evidence)</div>
              <Button size="sm" variant="outline" className={`mt-2 h-7 border-[#2E3C5F] bg-[#151D30] text-[9px] text-[#9AA8C0] hover:bg-[#1B2540]`} disabled={guidedBusy !== null} onClick={() => runGuidedStep("backtest")}>
                {guidedBusy === "backtest" ? "Backtesting…" : guidedDone.backtest ? "Run again" : "Run first backtest"}
              </Button>
            </div>
          </div>
          <div className={`mt-2 text-[10.5px] ${c.text3}`}>Evidence review lives in the Strategy lab below — a backtest is evidence, never a promise (A-05/D-03).</div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[250px_1fr_300px]">
        {/* step rail */}
        <div className={`${card} p-2.5`}>
          {steps.map((s, i) => (
            <button
              key={s}
              onClick={() => setStep(i + 1)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left ${step === i + 1 ? c.elevated : ""}`}
            >
              <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border text-[11px] ${step === i + 1 ? "border-[#3E9BF0] bg-[#3E9BF0] font-bold text-[#001040]" : i + 1 < step ? `border-[#00B0F0] ${c.bright}` : `border-[#2E3C5F] ${c.text3}`}`}>
                {i + 1 < step ? "✓" : i + 1}
              </span>
              <span className={`text-[12.5px] ${step === i + 1 ? `font-semibold ${c.text}` : c.text2}`}>{s}</span>
            </button>
          ))}
        </div>

        {/* form */}
        <div className="flex flex-col gap-3">
          {step === 1 && (
            <div className={`${card} flex flex-col gap-2.5 p-4`}>
              {/* P-03: template gallery — curated starting points per B6 family */}
              <div className={`text-[12px] font-semibold ${c.text2}`}>Start from a template (P-03) — one click prefills everything</div>
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => applyTemplate(t)}
                    disabled={!t.venueLive}
                    className={`rounded-lg border p-3 text-left transition-colors ${t.venueLive ? "border-[#202B45] hover:border-[#00B0F0] hover:bg-[#131A2C]" : "cursor-not-allowed border-[#202B45] opacity-50"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[12.5px] font-semibold ${c.text}`}>{t.label}</span>
                      <span className="flex items-center gap-1">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${t.riskProfile === "CONSERVATIVE" ? "text-[#2FC08E] bg-[#2FC08E]/10" : t.riskProfile === "AGGRESSIVE" ? "text-[#F0525F] bg-[#F0525F]/10" : `${c.bright} bg-[#00B0F0]/10`}`}>{t.riskProfile}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${c.text3} bg-[#151D30]`}>{t.venueLabel}{t.venueLive ? "" : " · offline"}</span>
                      </span>
                    </div>
                    <div className={`mt-1 text-[11px] ${c.text2}`}>{t.thesis}</div>
                    <div className={`mt-1 text-[10.5px] ${c.text3}`}>
                      entry ≥{t.strategy.minEdgePts} pts · fade {t.strategy.estimatorTiltPct}% · {fmtCents(t.capital.allocatedCents)} · {FAMILY_LABEL[t.family] ?? t.family}
                    </div>
                  </button>
                ))}
                <div className={`rounded-lg border border-dashed p-3 ${c.borderStrong}`}>
                  <div className={`text-[12.5px] font-semibold ${c.text2}`}>Start from scratch</div>
                  <div className={`mt-1 text-[11px] ${c.text2}`}>Pick venue, family and every knob yourself — nothing prefilled.</div>
                  <div className={`mt-1 text-[10.5px] ${c.text3}`}>Templates never promise performance — each robot still earns its own evidence (A-05/D-03).</div>
                </div>
              </div>
              <div className={`mt-1 text-[12px] font-semibold ${c.text2}`}>Venue — which market does this robot trade on?</div>
              {VENUES.map((v) => (
                // B12: each venue option shows its color; the selected venue
                // tints the row so the robot's scope is unmistakable.
                <button key={v.id} onClick={() => setVenue(v.id)} disabled={v.adapter === "PENDING"}
                  style={venueScopeStyle(v.id)}
                  className={`vc-scope rounded-lg border p-3 text-left transition-colors ${venue === v.id ? "vc-border vc-tint" : `border-[#202B45] hover:bg-[#131A2C]`} ${v.adapter === "PENDING" ? "vc-pending cursor-not-allowed opacity-50" : ""}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[12.5px] font-semibold ${c.text}`}>{v.label}</span>
                    <span className="flex items-center gap-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${c.text3} bg-[#151D30]`}>
                        {ROLE_LABEL[v.role]}{v.adapter === "PENDING" ? " · PENDING" : " · LIVE"}
                      </span>
                      {venue === v.id && <span className="vc-chip rounded px-1.5 py-0.5 text-[9px] font-bold">SELECTED</span>}
                    </span>
                  </div>
                  <div className={`mt-1 text-[11px] ${c.text2}`}>{v.note}</div>
                </button>
              ))}
              <div className={`text-[12px] font-semibold ${c.text2} mt-1`}>Robot family</div>
              {FAMILIES.map((f) => (
                <button key={f.id} onClick={() => setFamily(f.id)} disabled={f.id === "ARBITRAGE"}
                  className={`rounded-lg border p-3 text-left transition-colors ${family === f.id ? "border-[#00B0F0] bg-[#00B0F0]/5" : `border-[#202B45] hover:bg-[#131A2C]`} ${f.id === "ARBITRAGE" ? "cursor-not-allowed opacity-50" : ""}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[12.5px] font-semibold ${c.text}`}>{f.label}</span>
                    {family === f.id && <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${c.bright} bg-[#00B0F0]/10`}>SELECTED</span>}
                  </div>
                  <div className={`mt-1 text-[11px] ${c.text2}`}>{f.desc}</div>
                </button>
              ))}
              <div>
                <Label className={`mt-2 text-[12px] font-semibold ${c.text2}`}>Robot name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Senate Edge" className={`mt-1 border-[#2E3C5F] bg-[#151D30] ${c.text}`} />
              </div>
            </div>
          )}
          {step === 2 && (
            <div className={`${card} flex flex-col gap-3 p-4`}>
              <div className={`text-[12px] font-semibold ${c.text2}`}>Strategy & model</div>
              <div className={`rounded-lg border p-3 text-[12px] ${c.border} ${c.elevated} ${c.text2}`}>
                Probability source: <b className={c.text}>{family === "AI_RESEARCH" ? "AI estimator chain (A-01 registry → screening → cache → fallback)" : "heuristic estimator"}</b> — deterministic when no key is set; add any AI provider key in Settings and robots upgrade automatically (A-06).
              </div>
              {appliedTemplate && (
                <div className={`rounded-lg border p-3 text-[12px] ${c.border}`}>
                  <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold ${c.bright} bg-[#00B0F0]/10`}>TEMPLATE</span>
                  <span className={`ml-2 ${c.text2}`}>{appliedTemplate.label} — {appliedTemplate.behavior}</span>
                </div>
              )}
              <div className={`rounded-lg border p-3 text-[12px] ${c.border}`}>
                <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold ${c.bright} bg-[#00B0F0]/10`}>EDGE GATE</span>
                <span className={`ml-2 ${c.text2}`}>Only models that pass the gate trade live. Entry: edge ≥ <b className={c.text}>{minEdge} pts</b> net of fees. Edge alone never triggers a trade.</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className={`flex justify-between text-[12px] ${c.text2}`}><span>Min edge at entry (net of fees)</span><span className={mono + " " + c.text}>{minEdge} pts</span></div>
                  <Slider value={[minEdge]} onValueChange={(v) => setMinEdge(v[0])} min={1} max={25} step={1} className="mt-2" />
                  <div className={`mt-1 text-[10px] ${c.text3}`}>C5 knob — the cycle refuses entries below this edge.</div>
                </div>
                <div>
                  <div className={`flex justify-between text-[12px] ${c.text2}`}><span>Contrarian fade tilt</span><span className={mono + " " + c.text}>{tilt}%</span></div>
                  <Slider value={[tilt]} onValueChange={(v) => setTilt(v[0])} min={0} max={40} step={1} className="mt-2" />
                  <div className={`mt-1 text-[10px] ${c.text3}`}>How hard the heuristic fades the book price toward 50%.</div>
                </div>
                <div>
                  <div className={`flex justify-between text-[12px] ${c.text2}`}><span>Exit when edge falls below</span><span className={mono + " " + c.text}>{exitEdge} pts</span></div>
                  <Slider value={[exitEdge]} onValueChange={(v) => setExitEdge(v[0])} min={0} max={10} step={1} className="mt-2" />
                  <div className={`mt-1 text-[10px] ${c.text3}`}>Positions close when the thesis disappears.</div>
                </div>
                <div>
                  <div className={`flex justify-between text-[12px] ${c.text2}`}><span>Max hold (ticks)</span><span className={mono + " " + c.text}>{holdTicks}</span></div>
                  <Slider value={[holdTicks]} onValueChange={(v) => setHoldTicks(v[0])} min={3} max={60} step={1} className="mt-2" />
                  <div className={`mt-1 text-[10px] ${c.text3}`}>Hard time stop — every position ends somewhere.</div>
                </div>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className={`${card} flex flex-col gap-4 p-4`}>
              <div className={`text-[12px] font-semibold ${c.text2}`}>Capital & risk limits</div>
              <RiskSlider label="Capital allocation" valueDollars={allocated} setValue={setAllocated} min={100} max={10000} step={100} help="Total paper capital this robot may deploy." />
              <RiskSlider label="Max per position" valueDollars={posCap} setValue={setPosCap} min={50} max={Math.min(allocated, 2000)} step={50} help="Largest single order notional." />
              <div>
                <div className={`flex justify-between text-[12px] ${c.text2}`}><span>Max open positions</span><span className={mono + " " + c.text}>{maxOpen}</span></div>
                <Slider value={[maxOpen]} onValueChange={(v) => setMaxOpen(v[0])} min={1} max={10} step={1} className="mt-2" />
              </div>
              <div>
                <div className={`flex justify-between text-[12px] ${c.text2}`}><span>Daily loss stop</span><span className={mono + " " + c.text}>{dailyLoss}% <span className={c.text3}>(platform max {platformMaxDaily}%)</span></span></div>
                <Slider value={[dailyLoss]} onValueChange={(v) => setDailyLoss(Math.min(v[0], platformMaxDaily))} min={1} max={platformMaxDaily} step={1} className="mt-2" />
              </div>
              <div>
                <div className={`flex justify-between text-[12px] ${c.text2}`}><span>Total drawdown stop</span><span className={mono + " " + c.text}>{drawdown}% <span className={c.text3}>(platform max {platformMaxDd}%)</span></span></div>
                <Slider value={[drawdown]} onValueChange={(v) => setDrawdown(Math.min(v[0], platformMaxDd))} min={1} max={platformMaxDd} step={1} className="mt-2" />
              </div>
            </div>
          )}
          {step === 4 && (
            <div className={`${card} flex flex-col gap-3 p-4`}>
              <div className={`text-[12px] font-semibold ${c.text2}`}>Execution settings</div>
              <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2`}>
                <div className={`rounded-lg border p-3 text-[12px] ${c.border} ${c.elevated}`}>
                  <div className={c.text3}>Exit policy</div>
                  <div className={`mt-1 ${c.text}`}>Close when edge disappears or on adverse verified information</div>
                </div>
                <div className={`rounded-lg border p-3 text-[12px] ${c.border} ${c.elevated}`}>
                  <div className={c.text3}>Operating schedule</div>
                  <div className={`mt-1 ${c.text}`}>Continuous — robots run in the cloud, devices can be off (C3)</div>
                </div>
              </div>
            </div>
          )}
          {step === 5 && (
            <div className={`${card} flex flex-col gap-2 p-4`}>
              <div className={`text-[12px] font-semibold ${c.text2}`}>Review — term sheet</div>
              {[
                ["Venue", <span key="venue" className="vc-scope vc-text" style={venueScopeStyle(venue)}>{VENUE_LABEL[venue] ?? venue}</span>],
                ["Family", FAMILY_LABEL[family] ?? family],
                ["Template", appliedTemplate ? `${appliedTemplate.label} (${appliedTemplate.riskProfile})` : "custom — no template"],
                ["Name", name || "—"],
                ["Capital allocation", fmtCents(allocated * 100)],
                ["Max per position", fmtCents(posCap * 100)],
                ["Max open positions", String(maxOpen)],
                ["Daily loss stop", `${dailyLoss}%`],
                ["Total drawdown stop", `${drawdown}%`],
                ["Entry rule", `edge ≥ ${minEdge} pts net of fees · fade tilt ${tilt}% · exit ${exitEdge} pts · hold ≤ ${holdTicks} ticks`],
                ["Backtest", "required before live (recorder data, A-05)"],
                ["Paper session", "required before live"],
              ].map(([k, v]) => (
                <div key={String(k)} className={`flex justify-between border-b py-1.5 text-[12px] last:border-0 ${c.border}`}>
                  <span className={c.text2}>{k}</span><span className={c.text}>{v}</span>
                </div>
              ))}
              <Button className="mt-2 bg-[#00B0F0] font-semibold text-[#001040] hover:bg-[#2FC1F5]" onClick={submit}>
                Save as PAPER_ONLY draft (v1)
              </Button>
              <div className={`text-[10.5px] ${c.text3}`}>
                The primary action is save-as-draft — never activate. Live activation stays unavailable until edge gate, backtest, paper session and your recorded consent (C25).
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className={`border-[#2E3C5F] bg-[#151D30] text-[#9AA8C0] hover:bg-[#1B2540]`} onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1}>Back</Button>
            {step < 5 && <Button className="bg-[#00B0F0] font-semibold text-[#001040] hover:bg-[#2FC1F5]" onClick={() => setStep(Math.min(5, step + 1))} disabled={!canNext}>Next</Button>}
          </div>
        </div>

        {/* summary rail */}
        <div className={`${card} h-fit p-4`}>
          <div className={`mb-2 text-[13px] font-semibold`}>Configuration summary</div>
          {[["Venue", <span key="venue" className="vc-scope vc-text" style={venueScopeStyle(venue)}>{VENUE_LABEL[venue] ?? venue}</span>], ["Family", FAMILY_LABEL[family] ?? family], ["Template", appliedTemplate?.label ?? "custom"], ["Name", name || "—"], ["Allocation", fmtCents(allocated * 100)], ["Position cap", fmtCents(posCap * 100)], ["Daily stop", `${dailyLoss}%`], ["Drawdown stop", `${drawdown}%`], ["Entry", `≥ ${minEdge} pts · fade ${tilt}%`]].map(([k, v]) => (
            <div key={String(k)} className={`flex justify-between py-1 text-[12px]`}>
              <span className={c.text2}>{k}</span><span className={c.text}>{v}</span>
            </div>
          ))}
          <div className={`mt-2 rounded border border-dashed px-2.5 py-1.5 text-[10.5px] ${c.borderStrong} ${c.text2}`}>
            Fee impact — paper schedule, taker 0 bps [rates from config]
          </div>
        </div>
      </div>

      {/* Phase 2 — strategy versions + backtests (C5 / A-05) */}
      <StrategyLab dash={dash} onAfterChange={() => onAfterChange?.()} />
    </div>
  );
}

function RiskSlider({ label, valueDollars, setValue, min, max, step, help }: { label: string; valueDollars: number; setValue: (v: number) => void; min: number; max: number; step: number; help: string }) {
  return (
    <div>
      <div className={`flex justify-between text-[12px] ${c.text2}`}>
        <span>{label}</span>
        <span className={mono + " " + c.text}>${valueDollars.toLocaleString()}</span>
      </div>
      <Slider value={[valueDollars]} onValueChange={(v) => setValue(v[0])} min={min} max={Math.max(min, max)} step={step} className="mt-2" />
      <div className={`mt-1 text-[10px] ${c.text3}`}>{help}</div>
    </div>
  );
}

// ── Trading ──────────────────────────────────────────────────────────────────
export function TradingView(props: {
  markets: MarketDTO[];
  ordersData: { orders: OrderRowDTO[]; ledger: LedgerRowDTO[] } | null;
  busy: string | null;
  onPlace: (p: unknown) => void;
  onSimulateAckLoss: (marketId: string) => void;
  onReconcile: () => void;
  hasUnknown: boolean;
  onTradeSomething: () => void;
}) {
  const { ordersData, markets } = props;
  const [explicitSelected, setExplicitSelected] = useState("");
  const selected = explicitSelected || markets[0]?.id || "";
  const [side, setSide] = useState<"BUY_YES" | "BUY_NO">("BUY_YES");
  const [size, setSize] = useState("25.00");
  const market = markets.find((m) => m.id === selected);
  const price = market ? (side === "BUY_YES" ? market.yesPriceCents : market.noPriceCents) ?? 50 : 50;
  const sizeCents = Math.round(parseFloat(size || "0") * 100);

  const stateJournal = useMemo(() => ordersData?.orders.slice(0, 8) ?? [], [ordersData]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-semibold">Trading</h1>
        <span className={`text-[12px] ${c.text3}`}>paper ledger — every order walks the S-01 state machine with a full journal</span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        {/* ticket */}
        <div className={`${card} flex flex-col gap-3 p-4`}>
          <div className={`text-[13px] font-semibold`}>Manual paper order</div>
          <select
            value={selected}
            onChange={(e) => setExplicitSelected(e.target.value)}
            className={`w-full rounded-lg border px-3 py-2 text-[12px] ${c.borderStrong} ${c.elevated} ${c.text}`}
          >
            {VENUES.map((v) => {
              const rows = markets.filter((m) => m.venue === v.id);
              if (rows.length === 0) return null;
              return (
                <optgroup key={v.id} label={v.label}>
                  {rows.map((m) => (
                    <option key={m.id} value={m.id}>{m.question.slice(0, 64)}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          {market && (
            <div className={`flex items-center gap-1.5 text-[10.5px] ${c.text3}`}>
              entering via <VenueBadge venue={market.venue} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setSide("BUY_YES")} className={`rounded-lg border py-2 text-[12px] font-semibold ${side === "BUY_YES" ? "border-[#00B0F0] bg-[#00B0F0]/10 text-[#00B0F0]" : `${c.borderStrong} ${c.elevated} ${c.text2}`}`}>
              Buy YES · {market?.yesPriceCents ?? "—"}¢
            </button>
            <button onClick={() => setSide("BUY_NO")} className={`rounded-lg border py-2 text-[12px] font-semibold ${side === "BUY_NO" ? "border-[#00B0F0] bg-[#00B0F0]/10 text-[#00B0F0]" : `${c.borderStrong} ${c.elevated} ${c.text2}`}`}>
              Buy NO · {market?.noPriceCents ?? "—"}¢
            </button>
          </div>
          <div className={`flex justify-between rounded-lg border px-3 py-2 text-[12px] ${c.border} ${c.elevated}`}>
            <span className={c.text2}>Limit price</span><span className={mono}>{price}¢</span>
          </div>
          <div>
            <Label className={`text-[11px] ${c.text2}`}>Size ($)</Label>
            <Input value={size} onChange={(e) => setSize(e.target.value.replace(/[^0-9.]/g, ""))} className={`mt-1 border-[#2E3C5F] bg-[#151D30] ${c.text} ${mono}`} />
          </div>
          <div className={`flex justify-between text-[12px]`}><span className={c.text2}>Est. total</span><span className={mono}>{fmtCents(sizeCents)}</span></div>
          <Button className="bg-[#00B0F0] font-semibold text-[#001040] hover:bg-[#2FC1F5]" disabled={!market || sizeCents <= 0 || props.busy !== null}
            onClick={() => market && props.onPlace({ marketId: market.id, side, priceCents: price, sizeCents, nonce: crypto.randomUUID() })}>
            Place paper order
          </Button>
          <div className={`border-t pt-3 ${c.border}`}>
            <div className={`mb-2 text-[12px] font-semibold`}>Reconciliation drill (S-01/S-04)</div>
            <div className="flex flex-col gap-2">
              <Button size="sm" variant="outline" className={`border-[#E3A63B]/50 bg-[#151D30] text-[#E3A63B] hover:bg-[#1B2540]`} disabled={!market || props.busy !== null} onClick={() => market && props.onSimulateAckLoss(market.id)}>
                Simulate lost venue ack → UNKNOWN
              </Button>
              <Button size="sm" variant="outline" className={`border-[#2E3C5F] bg-[#151D30] text-[#9AA8C0] hover:bg-[#1B2540]`} disabled={!props.hasUnknown || props.busy !== null} onClick={props.onReconcile}>
                Run reconciliation pass {props.hasUnknown ? "(UNKNOWN orders present)" : "(nothing pending)"}
              </Button>
            </div>
          </div>
        </div>

        {/* orders + ledger */}
        <div className="flex flex-col gap-4">
          <div className={`${card} overflow-hidden`}>
            <div className={`px-4 pt-3 text-[13px] font-semibold`}>Orders</div>
            <div className="fd-scroll mt-2 max-h-[300px] overflow-y-auto">
              <table className="w-full">
                <thead className={`sticky top-0 ${c.surface}`}>
                  <tr className={`border-b text-left text-[10px] tracking-wider ${c.border} ${c.text3}`}>
                    <th className="px-4 py-2 font-semibold">MARKET</th><th className="px-3 py-2 font-semibold">VENUE</th><th className="px-3 py-2 font-semibold">SIDE</th>
                    <th className="px-3 py-2 font-semibold">PRICE</th><th className="px-3 py-2 font-semibold">SIZE</th>
                    <th className="px-3 py-2 font-semibold">STATE</th>
                  </tr>
                </thead>
                <tbody>
                  {stateJournal.map((o) => (
                    <tr key={o.id} className={`border-b text-[12px] last:border-0 ${c.border}`}>
                      <td className={`max-w-[220px] truncate px-4 py-2 ${c.text}`}>{o.market?.question}{o.robot ? ` · ${o.robot.name}` : ""}</td>
                      <td className="px-3 py-2">{o.market?.venue ? <VenueBadge venue={o.market.venue} withLabel={false} /> : "—"}</td>
                      <td className={`px-3 py-2 ${c.text2}`}>{o.side.replace("BUY_", "BUY ")}</td>
                      <td className={`px-3 py-2 ${mono} ${c.text2}`}>{o.priceCents}¢</td>
                      <td className={`px-3 py-2 ${mono} ${c.text2}`}>{fmtCents(o.sizeCents)}</td>
                      <td className="px-3 py-2"><StateChip state={o.state} /></td>
                    </tr>
                  ))}
                  {(ordersData?.orders.length ?? 0) === 0 && (
                    <tr><td colSpan={6} className={`px-4 py-6 text-center text-[12px] ${c.text3}`}>No orders yet — place one or run a robot cycle.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className={`px-4 pt-3 text-[13px] font-semibold`}>Paper ledger (P-02)</div>
            <div className="fd-scroll mt-2 max-h-[240px] overflow-y-auto">
              <table className="w-full">
                <thead className={`sticky top-0 ${c.surface}`}>
                  <tr className={`border-b text-left text-[10px] tracking-wider ${c.border} ${c.text3}`}>
                    <th className="px-4 py-2 font-semibold">TYPE</th><th className="px-3 py-2 font-semibold">AMOUNT</th>
                    <th className="px-3 py-2 font-semibold">BALANCE</th><th className="px-4 py-2 font-semibold">MEMO</th>
                  </tr>
                </thead>
                <tbody>
                  {(ordersData?.ledger ?? []).map((l) => (
                    <tr key={l.id} className={`border-b text-[12px] last:border-0 ${c.border}`}>
                      <td className={`px-4 py-2 font-semibold ${l.type === "DEPOSIT" ? c.bright : c.text2}`}>{l.type}</td>
                      <td className={`px-3 py-2 ${mono} ${l.amountCents < 0 ? c.loss : c.gain}`}>{l.amountCents < 0 ? "" : "+"}{fmtCents(l.amountCents)}</td>
                      <td className={`px-3 py-2 ${mono} ${c.text}`}>{fmtCents(l.balanceAfterCents)}</td>
                      <td className={`max-w-[260px] truncate px-4 py-2 text-[11px] ${c.text3}`}>{l.memo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────
export function SettingsView(props: {
  dash: DashboardDTO | null;
  riskView: RiskViewDTO | null;
  eligibility: EligibilityRuleDTO[];
  probability: ProbabilityDTO | null;
  onSaveRisk: (key: string, value: number) => Promise<void>;
  onSaveProvider: (p: { id: string; apiKey?: string | null; model?: string; enabled?: boolean; baseUrl?: string | null }) => Promise<void>;
  onFlipCountry: (country: string, allowed: boolean) => Promise<void>;
  onProbabilityAction: (body: Record<string, unknown>, okMsg: string) => Promise<void>;
  onOpenRisk: () => void;
}) {
  const { dash, riskView, eligibility } = props;
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  useEffect(() => { props.onOpenRisk(); }, []);
  if (!riskView || !dash) return null;

  const riskRows: Array<{ key: string; label: string; max: number; unit: string; val: number }> = [
    { key: "DAILY_LOSS_STOP_PCT", label: "Daily loss stop", max: riskView.platformMax.DAILY_LOSS_STOP_PCT ?? 20, unit: "%", val: riskView.effective.dailyLossStopPct },
    { key: "DRAWDOWN_STOP_PCT", label: "Total drawdown stop", max: riskView.platformMax.DRAWDOWN_STOP_PCT ?? 30, unit: "%", val: riskView.effective.drawdownStopPct },
    { key: "PER_EVENT_EXPOSURE_PCT", label: "Per-event exposure cap", max: riskView.platformMax.PER_EVENT_EXPOSURE_PCT ?? 50, unit: "%", val: riskView.effective.perEventExposurePct },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-semibold">Settings</h1>
        <span className={`text-[12px] ${c.text3}`}>custody, risk two-tier config, AI providers, model registry, eligibility matrix</span>
      </div>

      {/* custody */}
      <div className={`${card} p-4`}>
        <div className={`mb-2 text-[13px] font-semibold`}>Custody — decision B1: SELF-CUSTODY</div>
        <div className={`text-[12px] ${c.text2}`}>
          Your wallet signs every order (EIP-712). The platform stores the address only — it never holds, moves or custody keys.
          Since Phase 7 the signing path is live (self-custody, env-injected per process, redacted everywhere) but every real send stays behind the B10 gates below.
          Since Phase 9 a SECOND credential kind exists for Kalshi (B9): an asymmetric API key — RSA-PSS/SHA-256 or Ed25519 — env-injected per process
          (KALSHI_API_KEY_ID / KALSHI_PRIVATE_KEY), never stored, proven offline by `bun run selftest:kalshi` (K1–K6). Wallet signing and key signing are distinct paths; neither key material ever reaches the database.
        </div>
        <div className={`mt-2 flex flex-wrap items-center gap-2 text-[12px]`}>
          <span className={c.text3}>Wallet:</span>
          <span className={`rounded border px-2 py-0.5 ${c.borderStrong} ${mono} ${c.text}`}>{dash.wallet?.address.slice(0, 12)}…{dash.wallet?.address.slice(-6)}</span>
          <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold ${c.paper} bg-[#D9B25C]/10`}>{dash.wallet?.signingModel}</span>
          <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold ${c.text3} bg-[#151D30]`}>KALSHI_ASYMMETRIC_API_KEY (RSA/Ed25519)</span>
        </div>
      </div>

      {/* live trading control (Phase 7: B10 gates, C25 consent, pilot) */}
      <LiveTradingCard />

      {/* risk */}
      <div className={`${card} p-4`}>
        <div className={`mb-1 text-[13px] font-semibold`}>Risk limits — two-tier (B5/C10)</div>
        <div className={`mb-3 text-[11.5px] ${c.text3}`}>Users may tighten limits freely; they are clamped to founder-set platform maximums — never looser. All changes audited.</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {riskRows.map((r) => {
            return (
              <div key={r.key}>
                <div className={`flex justify-between text-[12px] ${c.text2}`}>
                  <span>{r.label}</span>
                  <span className={mono + " " + c.text}>{r.val}{r.unit} <span className={c.text3}>/ max {r.max}{r.unit}</span></span>
                </div>
                <Slider value={[r.val]} min={1} max={r.max} step={1} className="mt-2"
                  onValueCommit={(v) => props.onSaveRisk(r.key, v[0])}
                  onValueChange={() => undefined} />
              </div>
            );
          })}
        </div>
        <div className={`mt-3 text-[11px] ${c.text2}`}>
          AI monthly budget: {fmtCents(riskView.effective.aiMonthlyBudgetCents)} per user (platform max {fmtCents(riskView.platformMax.AI_MONTHLY_BUDGET_CENTS ?? 20000)}) — research pauses at 100%, risk management continues (A-07).
        </div>
      </div>

      {/* AI providers */}
      <div className={`${card} p-4`}>
        <div className={`mb-1 text-[13px] font-semibold`}>AI providers — provider-agnostic gateway (A-06)</div>
        <div className={`mb-3 text-[11.5px] ${c.text3}`}>Paste any provider key and enable it — the research engine uses the highest-priority enabled provider and falls back to the deterministic heuristic when none is configured. Keys are stored server-side and never returned (masked only).</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {dash.providers.map((p: ProviderDTO) => (
            <div key={p.id} className={`rounded-lg border p-3 ${c.border}`}>
              <div className="flex items-center justify-between">
                <span className={`text-[12.5px] font-semibold`}>{p.name}</span>
                <Switch checked={p.enabled} onCheckedChange={(v) => props.onSaveProvider({ id: p.id, enabled: v })} />
              </div>
              <div className={`mt-2 text-[11px] ${c.text3}`}>
                {p.hasKey ? `key ${p.keyMasked}` : "no key — add one below"}{p.baseUrl ? ` · ${p.baseUrl}` : ""}
              </div>
              <div className="mt-2 flex flex-col gap-2">
                <Input placeholder={p.name === "OPENAI_COMPATIBLE" ? "model name (required for custom)" : p.model} value={modelDrafts[p.id] ?? ""} onChange={(e) => setModelDrafts((d) => ({ ...d, [p.id]: e.target.value }))} className={`h-8 border-[#2E3C5F] bg-[#151D30] text-[12px] ${c.text}`} />
                <div className="flex gap-2">
                  <Input type="password" placeholder="API key" value={keyDrafts[p.id] ?? ""} onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.id]: e.target.value }))} className={`h-8 border-[#2E3C5F] bg-[#151D30] text-[12px] ${c.text}`} />
                  <Button size="sm" variant="outline" className={`border-[#2E3C5F] bg-[#151D30] text-[#E9EEF7] text-[11px] hover:bg-[#1B2540]`} disabled={!keyDrafts[p.id]}
                    onClick={async () => {
                      await props.onSaveProvider({ id: p.id, apiKey: keyDrafts[p.id], model: modelDrafts[p.id] || p.model || undefined });
                      setKeyDrafts((d) => ({ ...d, [p.id]: "" }));
                    }}>
                    Save key
                  </Button>
                </div>
                {p.name === "OPENAI_COMPATIBLE" && (
                  <Input placeholder="Base URL (e.g. https://api.deepseek.com/v1)" defaultValue={p.baseUrl ?? ""} onBlur={(e) => props.onSaveProvider({ id: p.id, baseUrl: e.target.value })} className={`h-8 border-[#2E3C5F] bg-[#151D30] text-[12px] ${c.text}`} />
                )}
                <div className={`text-[10px] ${c.text3}`}>budget {fmtCents(p.monthlyBudgetCents)} · spent {fmtCents(p.spentCents)} · priority {p.priority}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* model registry & calibration (Phase 5: A-01/A-03) */}
      <ModelRegistryCard probability={props.probability} onAction={props.onProbabilityAction} />

      {/* AI cost & latency governance (Phase 5: A-07) */}
      <GovernanceCard probability={props.probability} onAction={props.onProbabilityAction} />

      {/* notification dispatcher (Phase 2) */}
      <NotifyCard />

      {/* notification taxonomy + anti-storm (Phase 8, P-04) */}
      <NotificationsCard />

      {/* export + read-only API keys (Phase 8, P-06) */}
      <ApiKeysCard />

      {/* compliance ops + retention (Phase 8, P-07) */}
      <ComplianceCard />

      {/* platform metrics (Phase 8, P-08) */}
      <MetricsCard />

      {/* eligibility */}
      <div className={`${card} p-4`}>
        <div className={`mb-1 text-[13px] font-semibold`}>Jurisdiction eligibility matrix (C4.5)</div>
        <div className={`mb-3 text-[11.5px] ${c.text3}`}>Editable config — flip countries as counsel advises. Sanctioned jurisdictions can never be allowed (hard invariant). Default deny for unknown countries. [VERIFY] rows need counsel confirmation before launch.</div>
        <div className="fd-scroll flex max-h-[300px] flex-wrap gap-2 overflow-y-auto">
          {eligibility.map((r) => (
            <button key={r.id} onClick={() => props.onFlipCountry(r.country, !r.allowed)}
              title={r.reason ?? "no reason recorded"}
              className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                r.allowed ? `border-[#2FC08E]/40 bg-[#2FC08E]/10 ${c.gain}` : `border-[#F0525F]/40 bg-[#F0525F]/10 ${c.loss}`
              } ${r.source === "SANCTION_LIST" && r.allowed === false ? "cursor-not-allowed" : ""}`}>
              {r.country} {r.allowed ? "· allowed" : "· blocked"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Model registry & calibration — A-01/A-03 (Phase 5) ──────────────────────
function ModelRegistryCard({ probability, onAction }: { probability: ProbabilityDTO | null; onAction: (body: Record<string, unknown>, okMsg: string) => Promise<void> }) {
  const prob = probability;
  return (
    <div className={`${card} p-4`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className={`text-[13px] font-semibold`}>Model registry — calibration, promotion & demotion (A-01/A-03)</div>
        <Button size="sm" variant="outline" className="border-[#2E3C5F] bg-[#151D30] text-[#E9EEF7] text-[11px] hover:bg-[#1B2540]"
          onClick={() => onAction({ action: "RECOMPUTE" }, "Calibration recomputed")}>
          Recompute calibration
        </Button>
      </div>
      <div className={`mb-3 text-[11.5px] ${c.text3}`}>
        Baseline (A-03): <span className={mono}>{prob?.baseline.key}</span> — {prob?.baseline.formula}. A candidate may drive decisions only after beating the
        baseline by {prob?.knobs.promotionMarginPct}% Brier over ≥ {prob?.knobs.minSamples} resolved forecasts; an ACTIVE model drifting more than {prob?.knobs.demotionTolerancePct}% worse is demoted (drill-tested). Promotion is a founder action (B8).
      </div>
      {!prob && <div className={`py-3 text-center text-[12px] ${c.text3}`}>Loading registry…</div>}
      {prob && (
        <div className="flex flex-col gap-2">
          {prob.models.map((m: ModelRowDTO) => {
            const cal = m.calibration;
            const statusCls =
              m.status === "ACTIVE" ? `text-[#2FC08E] bg-[#2FC08E]/10`
              : m.status === "DEMOTED" ? `text-[#F0525F] bg-[#F0525F]/10`
              : m.status === "RETIRED" ? `${c.text3} bg-[#151D30]`
              : `text-[#D9B25C] bg-[#D9B25C]/10`;
            return (
              <div key={m.key} className={`rounded-lg border p-3 ${c.border}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold ${statusCls}`}>{m.status}</span>
                  <span className={`text-[12px] font-semibold ${mono} ${c.text}`}>{m.key}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${c.text3} bg-[#151D30]`}>{m.kind}</span>
                  {cal && cal.eligible && m.status !== "ACTIVE" && <span className="rounded bg-[#2FC08E]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#2FC08E]">promotion-ready</span>}
                  {cal && cal.demote && m.status === "ACTIVE" && <span className="rounded bg-[#F0525F]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#F0525F]">demotion warranted</span>}
                  <div className="ml-auto flex gap-2">
                    {m.status !== "ACTIVE" && (
                      <Button size="sm" variant="outline" className="h-7 border-[#2E3C5F] bg-[#151D30] px-2 text-[10.5px] text-[#E9EEF7] hover:bg-[#1B2540]"
                        onClick={() => onAction({ action: "PROMOTE", modelKey: m.key }, `Promote ${m.key}`)}>
                        Promote
                      </Button>
                    )}
                    {m.status === "ACTIVE" && m.key !== prob.baseline.key && (
                      <Button size="sm" variant="outline" className="h-7 border-[#F0525F]/40 bg-[#151D30] px-2 text-[10.5px] text-[#F0525F] hover:bg-[#2A1A22]"
                        onClick={() => onAction({ action: "DEMOTE", modelKey: m.key, reason: "manual demotion from Settings" }, `Demote ${m.key}`)}>
                        Demote
                      </Button>
                    )}
                  </div>
                </div>
                <div className={`mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] ${c.text2}`}>
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
                {m.notes && <div className={`mt-1 text-[10.5px] ${c.text3}`}>{m.notes}</div>}
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
        <div className={`text-[13px] font-semibold`}>AI cost & latency governance (A-07)</div>
        <Button size="sm" variant="outline" className="border-[#2E3C5F] bg-[#151D30] text-[#E9EEF7] text-[11px] hover:bg-[#1B2540]"
          onClick={() => onAction({ action: "CLEAR_CACHE" }, "Estimate cache cleared")}>
          Clear estimate cache
        </Button>
      </div>
      <div className={`mb-3 text-[11.5px] ${c.text3}`}>
        Per-provider budgets gate every call; identical estimates within the cache TTL are served free. Blocked attempts are logged, never silent — the fallback is stated in the trace.
      </div>
      {!g && <div className={`py-3 text-center text-[12px] ${c.text3}`}>Loading governance…</div>}
      {g && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className={`rounded-lg border p-3 ${c.border}`}>
              <div className={`text-[9px] font-semibold tracking-wider ${c.text3}`}>CALLS 24H</div>
              <div className={`mt-1 text-[16px] font-semibold ${mono} ${c.text}`}>{g.totals24h.calls}</div>
              <div className={`text-[9.5px] ${c.text3}`}>{g.totals24h.failed} failed · {g.totals24h.blocked} budget-blocked</div>
            </div>
            <div className={`rounded-lg border p-3 ${c.border}`}>
              <div className={`text-[9px] font-semibold tracking-wider ${c.text3}`}>CACHE HIT RATE</div>
              <div className={`mt-1 text-[16px] font-semibold ${mono} ${c.text}`}>{g.cache.hitRatePct}%</div>
              <div className={`text-[9.5px] ${c.text3}`}>{g.cache.hits24h} hits / {g.cache.misses24h} misses · {g.cache.entries} entries</div>
            </div>
            {g.providers.slice(0, 2).map((p) => (
              <div key={p.name} className={`rounded-lg border p-3 ${c.border}`}>
                <div className={`text-[9px] font-semibold tracking-wider ${c.text3}`}>{p.name} P50 / P95</div>
                <div className={`mt-1 text-[16px] font-semibold ${mono} ${c.text}`}>
                  {p.p50Ms != null ? `${p.p50Ms}ms` : "—"} / {p.p95Ms != null ? `${p.p95Ms}ms` : "—"}
                </div>
                <div className={`text-[9.5px] ${c.text3}`}>{p.calls24h} calls 24h · {p.blocked24h} blocked</div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {g.providers.map((p) => (
              <div key={p.name}>
                <div className={`flex justify-between text-[11.5px] ${c.text2}`}>
                  <span>{p.name}{!p.enabled && ` (disabled)`}</span>
                  <span className={mono}>
                    {fmtCents(p.spentCents)} / {fmtCents(p.monthlyBudgetCents)} · {p.budgetUsedPct}%
                  </span>
                </div>
                <div className={`mt-1 h-1.5 w-full rounded-full ${p.budgetUsedPct >= 100 ? "bg-[#F0525F]/30" : "bg-[#151D30]"}`}>
                  <div
                    className={`h-1.5 rounded-full ${p.budgetUsedPct >= 100 ? "bg-[#F0525F]" : "bg-[#00B0F0]"}`}
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
      <div className={`${card} p-4 text-[12px] ${c.text3}`}>
        Strategy versions &amp; backtests unlock once a robot exists — create one in the wizard above.
      </div>
    );
  }

  const s = bt?.stats;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">Strategy lab — versions &amp; backtests</h2>
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${c.bright} bg-[#00B0F0]/10`}>C5 · A-05</span>
        <span className={`text-[11.5px] ${c.text3}`}>versions are immutable; orders record the exact version. Backtest evidence for the live gate — never a promise (D-03).</span>
      </div>
      {/* robot selector */}
      <div className="flex flex-wrap gap-2">
        {robots.map((r) => (
          <button key={r.id} onClick={() => setRobotId(r.id)}
            className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${active.id === r.id ? "border-[#00B0F0] bg-[#00B0F0]/10 " + c.text : `border-[#2E3C5F] bg-[#151D30] ${c.text2} hover:bg-[#1B2540]`}`}>
            {r.name} <span className={mono + " " + c.text3}>v{r.activeVersion}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
        {/* versions */}
        <div className={`${card} p-4`}>
          <div className={`mb-2 text-[13px] font-semibold`}>Strategy versions — {active.name}</div>
          <div className="fd-scroll max-h-[220px] overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className={`text-left text-[10px] uppercase tracking-wide ${c.text3}`}>
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
                      {v.isActive ? <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${c.gain} bg-[#2FC08E]/10`}>ACTIVE</span> : <span className={`text-[10px] ${c.text3}`}>—</span>}
                    </td>
                    <td className="py-1.5">
                      {!v.isActive && (
                        <Button size="sm" variant="outline" className={`h-6 border-[#2E3C5F] bg-[#151D30] px-2 text-[10px] ${c.text} hover:bg-[#1B2540]`} disabled={labBusy !== null} onClick={() => activate(v.id)}>
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
            <div className={`mb-1 text-[11px] ${c.text2}`}>Save the sliders below as a new immutable version (C5):</div>
            <Button size="sm" className="bg-[#00B0F0] font-semibold text-[#001040] hover:bg-[#2FC1F5]" disabled={labBusy !== null} onClick={createVersion}>
              {labBusy === "create" ? "Saving…" : `Save as v${versions.reduce((m, v) => Math.max(m, v.version), 0) + 1}`}
            </Button>
          </div>
        </div>

        {/* backtest */}
        <div className={`${card} p-4`}>
          <div className="mb-2 flex items-center justify-between">
            <div className={`text-[13px] font-semibold`}>Backtest — replay over recorded ticks</div>
            {bt?.dataSource && (
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${bt.dataSource === "SYNTHETIC" ? c.paper + " bg-[#D9B25C]/10" : c.gain + " bg-[#2FC08E]/10"}`}>
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
          <Button size="sm" className="mt-3 bg-[#00B0F0] font-semibold text-[#001040] hover:bg-[#2FC1F5]" disabled={labBusy !== null} onClick={runBacktest}>
            {labBusy === "backtest" ? "Replaying…" : "Run backtest"}
          </Button>
          {btError && <div className={`mt-2 rounded border px-2.5 py-1.5 text-[11px] ${c.border} ${c.loss}`}>{btError}</div>}

          {bt?.ok && s && bt.params && (
            <div className="mt-3 flex flex-col gap-2">
              <div className={`grid grid-cols-4 gap-2 text-[11px]`}>
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
                  <div className={`flex justify-between text-[10px] ${c.text3}`}>
                    <span>sim capital {fmtCents(bt.params.simCapitalCents)}</span>
                    <span>{bt.marketQuestion?.slice(0, 44)}</span>
                  </div>
                </div>
              )}
              {(s.openAtEnd || s.skippedForLiquidity > 0) && (
                <div className={`text-[10.5px] ${c.text3}`}>
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
      <div className={`flex justify-between text-[11px] ${c.text2}`}>
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
      <div className={`text-[9.5px] uppercase tracking-wide ${c.text3}`}>{label}</div>
      <div className={`${mono} text-[12px] font-semibold ${tone === "gain" ? c.gain : tone === "loss" ? c.loss : c.text}`}>{val}</div>
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
      <line x1={pad} x2={w - pad} y1={y(baselineCents)} y2={y(baselineCents)} strokeDasharray="4 4" stroke="#2E3C5F" strokeWidth="1" />
      <path d={path} fill="none" stroke={up ? "#2FC08E" : "#F0525F"} strokeWidth="2" strokeLinejoin="round" />
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
        <div className={`text-[13px] font-semibold`}>Notification dispatcher — email fan-out (S-02/F8)</div>
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${s?.resendConfigured ? `${c.gain} bg-[#2FC08E]/10` : `${c.paper} bg-[#D9B25C]/10`}`}>
          {s ? (s.resendConfigured ? "RESEND ACTIVE" : "NO KEY — FEED ONLY") : "…"}
        </span>
      </div>
      <div className={`mb-3 text-[11.5px] ${c.text3}`}>
        The transactional outbox drains to the in-app feed first; severity events (risk pause, reconciliation) also page the user by email via Resend when an API key is present. Per-event email status is recorded — nothing is silently dropped.
      </div>
      {s && (
        <div className="grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-4">
          <Stat label="Sent 24h" val={String(s.last24h.sent)} tone="gain" />
          <Stat label="Failed 24h" val={String(s.last24h.failed)} tone={s.last24h.failed > 0 ? "loss" : undefined} />
          <Stat label="No-key 24h" val={String(s.last24h.noKey)} />
          <Stat label="From" val={s.from?.replace(/<.*>/, "").trim() || "—"} />
        </div>
      )}
      {s && !s.resendConfigured && <div className={`mt-2 text-[10.5px] ${c.text2}`}>{s.note}</div>}
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
        <div className={`text-[13px] font-semibold`}>Live trading — gated automation (Phase 7, B10)</div>
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${s?.armSwitch === "ARMED" ? `${c.loss} bg-[#F0525F]/10` : `${c.gain} bg-[#2FC08E]/10`}`}>
          SEND {s?.armSwitch ?? "…"}
        </span>
      </div>
      <div className={`mb-3 text-[11.5px] ${c.text3}`}>
        First real money passes four gate families: edge evidence (calibration, provenance, clean evidence, backtest, paper session, consent C25), execution (custody, credentials, pilot caps, B3 sign-off, geo), the small-capital pilot caps, and the send switch (env-only: orders are signed + audited but never transmitted while SAFE).
      </div>
      {s && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
            <Stat label="Signer key" val={s.custody.signerPresent ? `injected …${s.custody.fingerprint}` : "none (DRY-RUN only)"} tone={s.custody.signerPresent ? "gain" : undefined} />
            <Stat label="Kalshi key cred" val={s.kalshiCred ? (s.kalshiCred.keyPresent ? `${s.kalshiCred.keyType} …${s.kalshiCred.keyIdFingerprint}` : "none (paper only)") : "…"} tone={s.kalshiCred?.keyPresent ? "gain" : undefined} />
            <Stat label="Consent (C25)" val={s.consent.consented ? "RECORDED" : "absent"} tone={s.consent.consented ? "gain" : undefined} />
            <Stat label="Pilot" val={s.pilot.enabled ? "ENABLED" : "disabled"} tone={s.pilot.enabled ? "gain" : undefined} />
            <Stat label="Counsel (B3)" val={s.b3.signedOff ? `signed off (${s.b3.by})` : "owed"} tone={s.b3.signedOff ? "gain" : undefined} />
          </div>
          <div className={`text-[10.5px] ${c.text2}`}>
            Custody: address-only wallet (B1 — the platform never stores keys; the signer key is env-injected per process and redacted everywhere). Consent hash {s.consent.consentHash ? `${s.consent.consentHash.slice(0, 16)}…` : "—"}{s.consent.revokedAt ? ` · REVOKED ${s.consent.revokedAt}` : ""}. Pilot caps: ≤{s.pilot.maxOrderCents}¢/order, ≤{s.pilot.maxTotalNotionalCents}¢ total (ceilings {s.ceilings.maxOrderCents}¢ / {s.ceilings.maxTotalNotionalCents}¢), venues {s.pilot.venues.join("/")}.
            {" "}
            Kalshi carries the platform's SECOND credential kind — an asymmetric API key (RSA-PSS/SHA-256 or Ed25519, pre-sign text "timestamp+METHOD+path"), env-injected via KALSHI_API_KEY_ID / KALSHI_PRIVATE_KEY, never stored ({s.kalshiCred?.credentialModel ?? "KALSHI_ASYMMETRIC_API_KEY"}, keyStored false).
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="flex gap-2">
              <Input placeholder="0x… wallet address (registered address-only)" value={walletDraft} onChange={(e) => setWalletDraft(e.target.value)} className={`h-8 border-[#2E3C5F] bg-[#151D30] text-[12px] ${c.text}`} />
              <Button size="sm" variant="outline" className={`border-[#2E3C5F] bg-[#151D30] text-[#E9EEF7] text-[11px] hover:bg-[#1B2540]`} disabled={!/^0x[a-fA-F0-9]{40}$/.test(walletDraft)}
                onClick={() => act({ action: "REGISTER_WALLET", address: walletDraft }).then(() => setWalletDraft(""))}>
                Register wallet
              </Button>
            </div>
            <div className="flex gap-2">
              <Input placeholder={`type "${s.consent.phraseEcho}"`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className={`h-8 border-[#2E3C5F] bg-[#151D30] text-[12px] ${c.text}`} />
              {s.consent.consented ? (
                <Button size="sm" variant="outline" className={`border-[#F0525F]/50 bg-[#F0525F]/10 ${c.loss} text-[11px] hover:bg-[#F0525F]/20`} onClick={() => act({}, "DELETE", "/api/consent")}>
                  Revoke consent
                </Button>
              ) : (
                <Button size="sm" variant="outline" className={`border-[#2E3C5F] bg-[#151D30] text-[#E9EEF7] text-[11px] hover:bg-[#1B2540]`} disabled={confirmText !== s.consent.phraseEcho}
                  onClick={() => act({ confirm: confirmText, walletAddress: walletDraft || s.custody.address, capsAcknowledged: true }, "POST", "/api/consent").then(() => setConfirmText(""))}>
                  Record consent
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className={`border-[#2E3C5F] bg-[#151D30] text-[#E9EEF7] text-[11px] hover:bg-[#1B2540]`} disabled={s.pilot.enabled || !s.consent.consented} onClick={() => act({ action: "ENABLE_PILOT" })}>
              Enable pilot
            </Button>
            <Button size="sm" variant="outline" className={`border-[#2E3C5F] bg-[#151D30] text-[#E9EEF7] text-[11px] hover:bg-[#1B2540]`} disabled={!s.pilot.enabled} onClick={() => act({ action: "DISABLE_PILOT" })}>
              Disable pilot
            </Button>
          </div>
          {msg && <div className={`text-[10.5px] ${msg.startsWith("refused") ? c.loss : c.gain}`}>{msg}</div>}

          <div className={`mt-1 text-[12px] font-semibold ${c.text}`}>Per-robot live gate (Polymarket robots)</div>
          <div className="fd-scroll flex max-h-[260px] flex-col gap-2 overflow-y-auto">
            {s.gates.map((g) => {
              const blocking = [...(g.edge?.checks ?? []).filter((x) => !x.passed), ...g.exec.filter((x) => !x.passed)];
              return (
                <div key={g.robotId} className={`rounded-lg border p-2.5 ${c.border}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[12px] font-semibold ${c.text}`}>{g.robotName}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${g.mode === "LIVE_PILOT" ? `${c.loss} bg-[#F0525F]/10` : `${c.paper} bg-[#D9B25C]/10`}`}>{g.mode}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${g.ready ? `${c.gain} bg-[#2FC08E]/10` : `${c.text3} bg-[#1B2540]`}`}>{g.ready ? "GATE READY" : `GATE CLOSED (${blocking.length})`}</span>
                    {g.dryRun && g.ready && <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${c.paper} bg-[#D9B25C]/10`}>DRY-RUN (send SAFE)</span>}
                  </div>
                  {blocking.length > 0 && (
                    <div className="mt-1.5 flex flex-col gap-0.5">
                      {blocking.map((x) => (
                        <div key={x.check} className={`text-[10px] ${c.text3}`}><span className={c.loss}>{x.check}</span> — {x.detail}</div>
                      ))}
                    </div>
                  )}
                  {blocking.length === 0 && g.mode !== "LIVE_PILOT" && (
                    <Button size="sm" variant="outline" className={`mt-1.5 border-[#2E3C5F] bg-[#151D30] text-[#E9EEF7] text-[10.5px] hover:bg-[#1B2540]`} onClick={() => act({ action: "SET_ROBOT_MODE", robotId: g.robotId, mode: "LIVE_PILOT" })}>
                      Flip to LIVE_PILOT
                    </Button>
                  )}
                  {g.mode === "LIVE_PILOT" && (
                    <Button size="sm" variant="outline" className={`mt-1.5 border-[#2E3C5F] bg-[#151D30] text-[#E9EEF7] text-[10.5px] hover:bg-[#1B2540]`} onClick={() => act({ action: "SET_ROBOT_MODE", robotId: g.robotId, mode: "PAPER" })}>
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
        <div className={`text-[13px] font-semibold`}>Notification taxonomy & anti-storm (P-04)</div>
        {d && <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${c.text3} bg-[#151D30]`}>last 24h · {d.suppressedCount} absorbed</span>}
      </div>
      <div className={`mb-3 text-[11.5px] ${c.text3}`}>
        Every notification goes through one taxonomy (family → severity, dedupe window, hourly cap, digest policy). CRITICAL is never capped — a kill-switch event always breaks through. Suppressed repeats are RECORDED (never silently dropped) and counted here.
      </div>
      {!d && <div className={`py-3 text-center text-[12px] ${c.text3}`}>Loading taxonomy…</div>}
      {d && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
            {d.byFamily.map((f) => (
              <div key={f.family} className={`rounded-lg border p-2.5 ${c.border}`}>
                <div className={`text-[10.5px] font-semibold ${c.text}`}>{f.family}</div>
                <div className={`mt-1 flex flex-wrap gap-x-2 text-[9.5px] ${c.text3}`}>
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
            <div className={`rounded-lg border p-2.5 text-[11px] ${c.border}`}>
              <div className={`mb-1 text-[9.5px] uppercase tracking-wide ${c.text3}`}>DIGESTED (grouped at read time)</div>
              {d.digest.map((g) => (
                <div key={g.family} className={`flex justify-between ${c.text2}`}>
                  <span>{g.family} × {g.count}</span>
                  <span className={`text-[10px] ${c.text3}`}>{g.latestTitle}</span>
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
      <div className="mb-1 text-[13px] font-semibold">Export & read-only API keys (P-06)</div>
      <div className={`mb-3 text-[11.5px] ${c.text3}`}>
        Export your data (robots, orders, ledger, positions, traces — JSON/CSV, venue-labeled per B11). API keys are READ-ONLY by design: they authenticate /api/public/v1/* reads, no write surface exists. Plaintext is shown once and only its SHA-256 hash is stored (S-08 posture). Rate limit 60 req/min per key.
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className={`h-8 border-[#2E3C5F] bg-[#151D30] text-[11px] hover:bg-[#1B2540]`} onClick={() => window.open("/api/export?entity=all&format=json", "_blank")}>Export all (JSON)</Button>
        <Button size="sm" variant="outline" className={`h-8 border-[#2E3C5F] bg-[#151D30] text-[11px] hover:bg-[#1B2540]`} onClick={() => window.open("/api/export?entity=ledger&format=csv", "_blank")}>Export ledger (CSV)</Button>
        <Button size="sm" variant="outline" className={`h-8 border-[#2E3C5F] bg-[#151D30] text-[11px] hover:bg-[#1B2540]`} onClick={() => window.open("/api/export?entity=orders&format=csv", "_blank")}>Export orders (CSV)</Button>
      </div>
      <div className="mb-3 flex gap-2">
        <Input placeholder="key name (e.g. grafana-read)" value={name} onChange={(e) => setName(e.target.value)} className={`h-8 border-[#2E3C5F] bg-[#151D30] text-[12px] ${c.text}`} />
        <Button size="sm" variant="outline" className={`h-8 border-[#2E3C5F] bg-[#151D30] text-[11px] hover:bg-[#1B2540]`} disabled={busy} onClick={create}>Create key</Button>
      </div>
      {plaintext && (
        <div className={`mb-3 rounded-lg border border-[#D9B25C]/40 bg-[#D9B25C]/10 p-2.5 text-[11px] ${c.warn}`}>
          <div className="mb-1 font-semibold">Copy it now — this is shown ONCE and cannot be recovered:</div>
          <div className={`${mono} break-all text-[11px]`}>{plaintext}</div>
          <button className={`mt-1 text-[10px] underline ${c.text3}`} onClick={() => setPlaintext(null)}>dismiss</button>
        </div>
      )}
      {!keys && <div className={`py-2 text-center text-[12px] ${c.text3}`}>Loading keys…</div>}
      {keys && keys.length === 0 && <div className={`text-[11.5px] ${c.text3}`}>No API keys yet — create one above, then call /api/public/v1/robots with `Authorization: Bearer &lt;key&gt;`.</div>}
      {keys && keys.length > 0 && (
        <div className="flex flex-col gap-2">
          {keys.map((k) => (
            <div key={k.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-[11px] ${c.border}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${k.status === "ACTIVE" ? `${c.gain} bg-[#2FC08E]/10` : `${c.loss} bg-[#F0525F]/10`}`}>{k.status}</span>
                <span className={`font-semibold ${c.text}`}>{k.name}</span>
                <span className={`${mono} ${c.text2}`}>{k.prefix}…</span>
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${c.text3} bg-[#151D30]`}>{k.scope}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[9.5px] ${c.text3}`}>{k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleString()}` : "never used"}</span>
                {k.status === "ACTIVE" && (
                  <Button size="sm" variant="outline" className={`h-7 border-[#F0525F]/40 bg-[#151D30] px-2 text-[10.5px] text-[#F0525F] hover:bg-[#2A1A22]`} onClick={() => revoke(k.id)}>Revoke</Button>
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
        <div className={`text-[13px] font-semibold`}>Compliance ops — data retention (P-07)</div>
        <Button size="sm" variant="outline" className={`h-8 border-[#2E3C5F] bg-[#151D30] text-[11px] hover:bg-[#1B2540]`} disabled={busy} onClick={run}>{busy ? "Running…" : "Run retention now"}</Button>
      </div>
      <div className={`mb-3 text-[11.5px] ${c.text3}`}>
        Ephemeral operational data is pruned after its window; financial truth (ledger, orders, fills, positions, reconciliation, retention runs) is NEVER pruned — append-only is the product. Every run is audited (RetentionRun) and notified (COMPLIANCE).
      </div>
      {!d && <div className={`py-2 text-center text-[12px] ${c.text3}`}>Loading policies…</div>}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {d.policies.map((p) => (
              <div key={p.key} className={`rounded-lg border p-2.5 ${c.border}`}>
                <div className={`text-[10.5px] font-semibold ${c.text}`}>{p.label}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Input type="number" min={p.bounds.min} max={p.bounds.max} defaultValue={p.days}
                    onBlur={(e) => { const v = Number(e.target.value); if (v && v !== p.days) setDays(p.key, v); }}
                    className={`h-7 w-20 border-[#2E3C5F] bg-[#151D30] text-[12px] ${c.text}`} />
                  <span className={`text-[10px] ${c.text3}`}>days ({p.bounds.min}–{p.bounds.max})</span>
                </div>
              </div>
            ))}
          </div>
          <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] ${c.text2}`}>
            <span>would prune today: ticks {d.wouldPrune.ticks}</span>
            <span>traces {d.wouldPrune.traces}</span>
            <span>notifications {d.wouldPrune.notifications}</span>
            <span>failed outbox {d.wouldPrune.outboxFailed}</span>
          </div>
          {msg && <div className={`mt-2 rounded-lg border border-[#2FC08E]/30 bg-[#2FC08E]/10 p-2 text-[11px] ${c.gain}`}>{msg}</div>}
          {d.runs.length > 0 && (
            <div className={`mt-2 text-[10.5px] ${c.text3}`}>
              Last run {new Date(d.runs[0].ranAt).toLocaleString()} ({d.runs[0].kind.toLowerCase()}) — {d.runs.length} run{d.runs.length === 1 ? "" : "s"} audited.
            </div>
          )}
          <div className={`mt-1 text-[10px] ${c.text3}`}>{d.preservedNote}</div>
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
      <div className="mb-1 text-[13px] font-semibold">Platform metrics (P-08)</div>
      <div className={`mb-3 text-[11.5px] ${c.text3}`}>Operational snapshot — robots, orders, sync freshness per venue, notification anti-storm, outbox dispatch lag, AI governance. Null means the platform does not record that number — no invented precision (D-03).</div>
      {!m && <div className={`py-2 text-center text-[12px] ${c.text3}`}>Loading metrics…</div>}
      {m && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2 text-[11px] md:grid-cols-6">
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
            <div className={`text-[9.5px] uppercase tracking-wide ${c.text3}`}>SYNC FRESHNESS PER VENUE (B11)</div>
            {m.markets.freshness.map((f) => (
              <div key={f.venue} className={`flex flex-wrap items-center justify-between gap-2 text-[11px] ${c.text2}`}>
                <span className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${f.adapter === "LIVE" ? "bg-[#2FC08E]" : "bg-[#55617E]"}`} />
                  {f.label}
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${c.text3} bg-[#151D30]`}>{f.adapter}</span>
                </span>
                <span className={mono}>
                  {f.markets} market{f.markets === 1 ? "" : "s"} · {f.lastSyncMinAgo != null ? `last sync ${f.lastSyncMinAgo}m ago` : "never synced"}
                </span>
              </div>
            ))}
          </div>
          <div className={`flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] ${c.text2}`}>
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
