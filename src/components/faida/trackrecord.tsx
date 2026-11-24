"use client";

// Insights › Track record — the evidence page. Two honest questions:
//   1. How has each robot actually done? (recorded decisions, bets, closed
//      bets, win rate, realized profit, worst drop, past-price test)
//   2. Is the AI better than the market? (Brier score of the model's last
//      pre-resolution estimate vs. the market price, on resolved markets only,
//      plus a calibration chart: "when it said 70%, did it happen 70%?")
// Too little data is shown as "too early", never extrapolated.

import { useCallback, useEffect, useState } from "react";
import { Brain, FlaskConical, History, Trophy } from "lucide-react";
import { VENUE_LABEL, venueColor } from "@/lib/venues";
import { FAMILY_LABEL } from "./types";
import { ago, Badge, btn, EmptyState, Metric, money, PageSkeleton, Panel, pct, robotStatusBadge, Sparkline, T, toneOf, toneText } from "./ds";
import type { Nav } from "./shell";

type RobotRecord = {
  robotId: string; name: string; venue: string; family: string; status: string; since: string; days: number; allocatedCents: number;
  decisions: number; trades: number; closedBets: number; wins: number; winRatePct: number | null; realizedCents: number; returnPct: number | null;
  maxDrawdownPct: number; curve: Array<{ t: string; cents: number }>; lastDecisionAt: string | null;
  backtest: { roiPct: number | null; winRatePct: number | null; trades: number | null; at: string } | null;
};
type ModelAccuracy = {
  modelKey: string; label: string; resolved: number; brierModel: number | null; brierMarket: number | null;
  verdict: "AHEAD" | "BEHIND" | "EVEN" | "TOO_EARLY";
  bins: Array<{ from: number; to: number; n: number; avgForecastPct: number; hitRatePct: number }>;
  pending: number; nextResolution: string | null;
};
type Payload = { robots: RobotRecord[]; accuracy: ModelAccuracy[]; minResolvedForVerdict: number; generatedAt: string };

export function TrackRecordView({ onOpenRobot, onNavigate }: { onOpenRobot: (id: string) => void; onNavigate: (n: Nav) => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const load = useCallback(() => fetch("/api/track-record").then((r) => (r.ok ? r.json() : null)).then((j: Payload | null) => j && setData(j)).catch(() => undefined), []);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 60_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);
  if (!data) return <PageSkeleton />;

  const r = data.robots;
  const decisions = r.reduce((a, x) => a + x.decisions, 0);
  const trades = r.reduce((a, x) => a + x.trades, 0);
  const closed = r.reduce((a, x) => a + x.closedBets, 0);
  const wins = r.reduce((a, x) => a + x.wins, 0);
  const realized = r.reduce((a, x) => a + x.realizedCents, 0);
  const firstSince = r.length ? r.map((x) => x.since).sort()[0] : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Metric label="Decisions recorded" value={decisions} icon={<History size={17} />} hex={T.blue} sub={firstSince ? `since ${new Date(firstSince).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "No robots yet"} />
        <Metric label="Bets placed" value={trades} icon={<Trophy size={17} />} hex={T.purple} sub="Practice money" />
        <Metric label="Closed bets · win rate" value={closed ? `${closed} · ${pct((wins / closed) * 100, 0)}` : "0"} hex={T.amber} sub={closed ? `${wins} won, ${closed - wins} lost` : "None closed yet"} />
        <Metric label="Realized profit" value={money(realized, { sign: true })} tone={toneOf(realized)} hex={T.green} sub="From closed bets, after fees" />
      </div>

      <Panel title="Robot track records" icon={<Trophy size={18} />} subtitle="Every number comes from the robot's own recorded orders and decisions. Open bets aren't counted until they close.">
        {r.length === 0 ? (
          <EmptyState compact title="No robots yet" body="Start a robot and its record begins with its first decision." action={<button className={btn.primary} onClick={() => onNavigate({ view: "studio" })}>New robot</button>} />
        ) : (
          <ul className="flex flex-col gap-3">
            {r.map((x) => (
              <li key={x.robotId} className="rounded-2xl bg-[var(--fd-bg2)] p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: venueColor(x.venue) }} aria-hidden />
                  <button className="text-[16px] font-semibold text-[var(--fd-strong)] hover:underline" onClick={() => onOpenRobot(x.robotId)}>{x.name}</button>
                  <span className="text-[13px] text-[var(--fd-text2)]">{FAMILY_LABEL[x.family] ?? x.family} · {VENUE_LABEL[x.venue] ?? x.venue} · running {x.days} day{x.days === 1 ? "" : "s"}</span>
                  <span className="ml-auto">{robotStatusBadge(x.status)}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat k="Decisions" v={String(x.decisions)} sub={x.lastDecisionAt ? `last ${ago(x.lastDecisionAt)}` : "none yet"} />
                  <Stat k="Bets" v={String(x.trades)} />
                  <Stat k="Closed · won" v={`${x.closedBets} · ${x.wins}`} sub={x.winRatePct != null ? `${pct(x.winRatePct, 0)} win rate` : "—"} />
                  <Stat k="Realized" v={money(x.realizedCents, { sign: true })} tone={toneOf(x.realizedCents)} sub={x.returnPct != null ? `${pct(x.returnPct, 2, true)} of its money` : undefined} />
                  <Stat k="Worst drop" v={x.maxDrawdownPct > 0 ? `-${x.maxDrawdownPct.toFixed(2)}%` : "0%"} tone={x.maxDrawdownPct > 0 ? "loss" : undefined} />
                  <div className="flex items-end">
                    {x.curve.length >= 2 ? <Sparkline values={[0, ...x.curve.map((c) => c.cents)]} hex={x.realizedCents >= 0 ? T.green : T.red} w={120} h={40} /> : <span className="text-[12.5px] text-[var(--fd-text3)]">Chart starts after 2 closed bets</span>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--fd-line)] pt-3 text-[13px] text-[var(--fd-text2)]">
                  <FlaskConical size={14} />
                  {x.backtest ? (
                    <span>Past-price test: <b className={toneText[toneOf(x.backtest.roiPct)]}>{pct(x.backtest.roiPct, 2, true)}</b> over {x.backtest.trades ?? 0} trades{x.backtest.winRatePct != null ? `, ${pct(x.backtest.winRatePct, 0)} won` : ""} · {ago(x.backtest.at)}</span>
                  ) : (
                    <span>Not tested on past prices yet.</span>
                  )}
                  <button className="ml-auto font-semibold text-[var(--fd-brand-text)] hover:underline" onClick={() => onNavigate({ view: "robots", tab: "lab" })}>{x.backtest ? "Test again" : "Test it"} →</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Is the AI better than the market?" icon={<Brain size={18} />} subtitle="On markets that have already resolved, we compare the AI's last estimate with the market's own price at that moment, both against what actually happened.">
        {data.accuracy.length === 0 ? (
          <EmptyState compact icon={<Brain size={22} />} title="No estimates yet" body="Every robot decision records an estimate. Once those markets resolve, the scorecard fills in here." />
        ) : (
          <div className="flex flex-col gap-4">
            {data.accuracy.map((m) => <ModelCard key={m.modelKey} m={m} min={data.minResolvedForVerdict} />)}
          </div>
        )}
        <p className="mt-4 text-[13px] leading-relaxed text-[var(--fd-text3)]">
          Scored with the Brier score: the average squared gap between a probability and what happened (0 is perfect, 0.25 is a coin flip). Only the last estimate made <i>before</i> a market resolved counts, so nothing is scored with hindsight. A verdict needs at least {data.minResolvedForVerdict} resolved markets. All results so far are practice money; past results don&apos;t promise future ones.
        </p>
      </Panel>
    </div>
  );
}

function Stat({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: "gain" | "loss" | "flat" }) {
  return (
    <div>
      <div className="text-[12px] text-[var(--fd-text3)]">{k}</div>
      <div className={`fd-num text-[16px] font-semibold ${tone ? toneText[tone] : "text-[var(--fd-strong)]"}`}>{v}</div>
      {sub && <div className="text-[12px] text-[var(--fd-text3)]">{sub}</div>}
    </div>
  );
}

const VERDICT: Record<ModelAccuracy["verdict"], { tone: string; label: string }> = {
  AHEAD: { tone: "green", label: "Beats the market" },
  BEHIND: { tone: "red", label: "Behind the market" },
  EVEN: { tone: "neutral", label: "About the same as the market" },
  TOO_EARLY: { tone: "amber", label: "Too early to say" },
};

function ModelCard({ m, min }: { m: ModelAccuracy; min: number }) {
  const v = VERDICT[m.verdict];
  const W = 300;
  const H = 120;
  const used = m.bins.filter((b) => b.n > 0);
  return (
    <div className="rounded-2xl bg-[var(--fd-bg2)] p-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[15.5px] font-semibold text-[var(--fd-strong)]">{m.label}</span>
        <Badge tone={v.tone} dot>{v.label}</Badge>
        <span className="ml-auto text-[13px] text-[var(--fd-text2)]">{m.resolved} of {min} resolved markets needed</span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-2 text-[14px] text-[var(--fd-text-soft)]">
          {m.brierModel != null && m.brierMarket != null ? (
            <>
              <div className="flex items-baseline gap-3"><span className="w-24 text-[var(--fd-text3)]">AI score</span><b className="fd-num text-[18px] text-[var(--fd-strong)]">{m.brierModel.toFixed(3)}</b></div>
              <div className="flex items-baseline gap-3"><span className="w-24 text-[var(--fd-text3)]">Market score</span><b className="fd-num text-[18px] text-[var(--fd-strong)]">{m.brierMarket.toFixed(3)}</b><span className="text-[12.5px] text-[var(--fd-text3)]">lower is better</span></div>
            </>
          ) : (
            <p>No market it estimated has resolved yet.</p>
          )}
          <p className="text-[13px] text-[var(--fd-text2)]">
            {m.pending} market{m.pending === 1 ? "" : "s"} estimated and waiting to resolve{m.nextResolution ? `; the next closes ${new Date(m.nextResolution).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}.
          </p>
        </div>
        <div>
          <div className="mb-1 text-[12px] text-[var(--fd-text3)]">When it said X%, how often did it happen?</div>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-[120px] w-full" role="img" aria-label="Calibration chart">
            <line x1="0" y1={H} x2={W} y2="0" stroke="var(--fd-border2)" strokeDasharray="4 4" />
            {m.bins.map((b, i) => {
              const x = (i / 10) * W + 3;
              const w = W / 10 - 6;
              const h = (b.hitRatePct / 100) * H;
              return b.n > 0 ? <rect key={i} x={x} y={H - h} width={w} height={Math.max(2, h)} rx="3" fill="var(--fd-brand-b)" opacity={0.85}><title>{`${b.from}–${b.to}%: ${b.n} markets, happened ${b.hitRatePct.toFixed(0)}%`}</title></rect> : null;
            })}
          </svg>
          <div className="flex justify-between text-[11px] text-[var(--fd-text3)]"><span>AI said 0%</span><span>{used.length ? "bars = how often it happened · dashed = perfect" : "fills in as markets resolve"}</span><span>100%</span></div>
        </div>
      </div>
    </div>
  );
}
