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
  type NotifyStatusDTO,
  type OrderRowDTO,
  type ProviderDTO,
  type RiskViewDTO,
  type VersionDTO,
  FAMILIES,
} from "./types";
import { StateChip, card, c, fmtCents, mono } from "./ui";

// Tolerant JSON parse — never let a transient empty response crash the UI.
async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── Robot Studio ─────────────────────────────────────────────────────────────
export function StudioView({ dash, onCreate, onAfterChange }: { dash: DashboardDTO | null; onCreate: (p: unknown) => Promise<unknown>; onAfterChange?: () => void }) {
  const [step, setStep] = useState(1);
  const [family, setFamily] = useState<string>("PROBABILITY_EDGE");
  const [name, setName] = useState("");
  const [allocated, setAllocated] = useState(2000); // dollars
  const [posCap, setPosCap] = useState(200);
  const [maxOpen, setMaxOpen] = useState(4);
  const [dailyLoss, setDailyLoss] = useState(5);
  const [drawdown, setDrawdown] = useState(10);
  const platformMaxDaily = dash?.risk.find((r) => r.key === "DAILY_LOSS_STOP_PCT" && r.scope === "PLATFORM")?.valueNum ?? 20;
  const platformMaxDd = dash?.risk.find((r) => r.key === "DRAWDOWN_STOP_PCT" && r.scope === "PLATFORM")?.valueNum ?? 30;

  const steps = ["Robot family", "Strategy & model", "Capital & risk", "Execution", "Review & activation"];
  const canNext = step !== 1 || name.trim().length > 1;

  const submit = async () => {
    await onCreate({
      name: name.trim(),
      family,
      allocatedCents: allocated * 100,
      maxPositionCents: posCap * 100,
      maxOpenPositions: maxOpen,
      dailyLossStopPct: dailyLoss,
      drawdownStopPct: drawdown,
      config: {
        family,
        entryRule: "edge>=8pts net of fees",
        exitPolicy: "edge_disappears_or_adverse_verified_info",
        schedule: "continuous_cloud",
        estimator: family === "AI_RESEARCH" ? "AI_OR_HEURISTIC" : "HEURISTIC",
      },
    });
    setStep(1);
    setName("");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-semibold">Robot Studio</h1>
        <span className={`text-[12px] ${c.text3}`}>one decision per step — activation stays off until the Phase 7 gates pass (C5)</span>
      </div>
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
              <div className={`text-[12px] font-semibold ${c.text2}`}>Robot family</div>
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
                Probability source: <b className={c.text}>heuristic estimator</b> (deterministic, no key needed). Add any AI provider key in Settings and robots upgrade automatically (A-06).
              </div>
              <div className={`rounded-lg border p-3 text-[12px] ${c.border}`}>
                <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold ${c.bright} bg-[#00B0F0]/10`}>EDGE GATE</span>
                <span className={`ml-2 ${c.text2}`}>Only models that pass the gate trade live. Entry rule: model-vs-market edge ≥ <b className={c.text}>8.0 pts</b> net of fees. Edge alone never triggers a trade.</span>
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
                ["Family", FAMILIES.find((f) => f.id === family)?.label ?? family],
                ["Name", name || "—"],
                ["Capital allocation", fmtCents(allocated * 100)],
                ["Max per position", fmtCents(posCap * 100)],
                ["Max open positions", String(maxOpen)],
                ["Daily loss stop", `${dailyLoss}%`],
                ["Total drawdown stop", `${drawdown}%`],
                ["Backtest", "required before live (recorder data, A-05)"],
                ["Paper session", "required before live"],
              ].map(([k, v]) => (
                <div key={k} className={`flex justify-between border-b py-1.5 text-[12px] last:border-0 ${c.border}`}>
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
          {[["Family", FAMILIES.find((f) => f.id === family)?.label ?? family], ["Name", name || "—"], ["Allocation", fmtCents(allocated * 100)], ["Position cap", fmtCents(posCap * 100)], ["Daily stop", `${dailyLoss}%`], ["Drawdown stop", `${drawdown}%`]].map(([k, v]) => (
            <div key={k} className={`flex justify-between py-1 text-[12px]`}>
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
            {markets.map((m) => (
              <option key={m.id} value={m.id}>{m.question.slice(0, 64)}</option>
            ))}
          </select>
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
                    <th className="px-4 py-2 font-semibold">MARKET</th><th className="px-3 py-2 font-semibold">SIDE</th>
                    <th className="px-3 py-2 font-semibold">PRICE</th><th className="px-3 py-2 font-semibold">SIZE</th>
                    <th className="px-3 py-2 font-semibold">STATE</th>
                  </tr>
                </thead>
                <tbody>
                  {stateJournal.map((o) => (
                    <tr key={o.id} className={`border-b text-[12px] last:border-0 ${c.border}`}>
                      <td className={`max-w-[220px] truncate px-4 py-2 ${c.text}`}>{o.market?.question}{o.robot ? ` · ${o.robot.name}` : ""}</td>
                      <td className={`px-3 py-2 ${c.text2}`}>{o.side.replace("BUY_", "BUY ")}</td>
                      <td className={`px-3 py-2 ${mono} ${c.text2}`}>{o.priceCents}¢</td>
                      <td className={`px-3 py-2 ${mono} ${c.text2}`}>{fmtCents(o.sizeCents)}</td>
                      <td className="px-3 py-2"><StateChip state={o.state} /></td>
                    </tr>
                  ))}
                  {(ordersData?.orders.length ?? 0) === 0 && (
                    <tr><td colSpan={5} className={`px-4 py-6 text-center text-[12px] ${c.text3}`}>No orders yet — place one or run a robot cycle.</td></tr>
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
  onSaveRisk: (key: string, value: number) => Promise<void>;
  onSaveProvider: (p: { id: string; apiKey?: string | null; model?: string; enabled?: boolean; baseUrl?: string | null }) => Promise<void>;
  onFlipCountry: (country: string, allowed: boolean) => Promise<void>;
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
        <span className={`text-[12px] ${c.text3}`}>custody, risk two-tier config, AI providers, eligibility matrix</span>
      </div>

      {/* custody */}
      <div className={`${card} p-4`}>
        <div className={`mb-2 text-[13px] font-semibold`}>Custody — decision B1: SELF-CUSTODY</div>
        <div className={`text-[12px] ${c.text2}`}>
          Your wallet signs every order (EIP-712). The platform stores the address only — it never holds, moves or custody keys.
          Signing integration arrives with the Phase 7 live-trading work; until then all execution is paper.
        </div>
        <div className={`mt-2 flex flex-wrap items-center gap-2 text-[12px]`}>
          <span className={c.text3}>Wallet:</span>
          <span className={`rounded border px-2 py-0.5 ${c.borderStrong} ${mono} ${c.text}`}>{dash.wallet?.address.slice(0, 12)}…{dash.wallet?.address.slice(-6)}</span>
          <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold ${c.paper} bg-[#D9B25C]/10`}>{dash.wallet?.signingModel}</span>
        </div>
      </div>

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

      {/* notification dispatcher (Phase 2) */}
      <NotifyCard />

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
