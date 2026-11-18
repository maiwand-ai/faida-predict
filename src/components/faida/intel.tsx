"use client";

// FAIDA Predict — Intelligence Center. Research feed and model outputs on the
// left, the selected decision's full analysis on the right. Every item is
// labeled by what it is: verified venue data (prices), model-generated
// estimates (never presented as certain), and deterministic risk checks.

import { useEffect, useMemo, useState } from "react";
import { Brain, Cpu, Database, Sparkles } from "lucide-react";
import type { DashboardDTO, MarketDTO, ProbabilityDTO, TraceDTO } from "./types";
import { VENUES, venueColor } from "@/lib/venues";
import { ago, Badge, decisionBadge, EmptyState, KV, Metric, PageHeader, PageSkeleton, Panel, pct, T, Tabs, TableWrap, td, th, trow, VenueTag } from "./ds";
import { TraceDetail } from "./dashboard";
import type { Nav } from "./shell";

type JournalTrace = TraceDTO & {
  robot?: { id: string; name: string; venue: string };
  market?: { id: string; question: string; venue: string; yesPriceCents: number | null; category: string };
};

export function useDecisions(robotId?: string, limit = 200) {
  const [traces, setTraces] = useState<JournalTrace[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/decisions?limit=${limit}${robotId ? `&robotId=${robotId}` : ""}`);
        const json = (await res.json()) as { traces?: JournalTrace[] };
        if (alive && json.traces) setTraces(json.traces);
      } catch { /* transient; next poll recovers */ }
    };
    void load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [robotId, limit]);
  return traces;
}

export function IntelligenceView(props: {
  dash: DashboardDTO | null;
  markets: MarketDTO[];
  probability: ProbabilityDTO | null;
  tab: string;
  onTab: (t: string) => void;
  onOpenMarket: (id: string) => void;
  onOpenRobot: (id: string) => void;
  onNavigate: (n: Nav) => void;
}) {
  const { dash, markets, probability, tab, onTab, onOpenMarket, onOpenRobot, onNavigate } = props;
  const traces = useDecisions();
  const [selected, setSelected] = useState<string | null>(null);
  const [fDecision, setFDecision] = useState("ALL");
  const [fVenue, setFVenue] = useState("ALL");
  const [fRobot, setFRobot] = useState("ALL");

  const research = useMemo(() => (traces ?? []).filter((t) => t.modelEstimatePct != null), [traces]);
  const latestByMarket = useMemo(() => {
    const m = new Map<string, JournalTrace>();
    for (const t of research) if (t.market && !m.has(t.market.id)) m.set(t.market.id, t);
    return [...m.values()].sort((a, b) => Math.abs(b.edgeNetPct ?? 0) - Math.abs(a.edgeNetPct ?? 0));
  }, [research]);
  const movers = useMemo(() => markets.filter((m) => m.change24hCents != null && m.change24hCents !== 0).sort((a, b) => Math.abs(b.change24hCents!) - Math.abs(a.change24hCents!)).slice(0, 10), [markets]);

  if (!dash || traces == null) return <PageSkeleton />;

  const filtered = traces.filter((t) =>
    (fDecision === "ALL" || t.decision === fDecision) &&
    (fVenue === "ALL" || t.market?.venue === fVenue) &&
    (fRobot === "ALL" || t.robot?.id === fRobot),
  );
  const list = tab === "research" ? research : filtered;
  const sel = list.find((t) => t.id === selected) ?? list[0] ?? null;
  const aiTraces = research.filter((t) => t.modelKey?.startsWith("ai:"));
  const gov = probability?.governance;
  const decisions = [...new Set(traces.map((t) => t.decision))];
  const selCls = "h-10 rounded-xl border border-[#253247] bg-[#111827] px-3 text-[14px] text-[#E8EDF5]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={<Brain size={24} />} iconHex={T.purple} title="Intelligence" subtitle="Model research, market signals and every robot decision with its reasoning" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Decisions recorded" value={traces.length} sub="Latest 200" icon={<Database size={16} />} />
        <Metric label="Model estimates" value={research.length} sub={`${aiTraces.length} from AI models`} hex={T.purple} icon={<Sparkles size={16} />} />
        <Metric label="AI calls (24h)" value={gov?.totals24h.calls ?? "—"} sub={gov ? `${gov.totals24h.failed} failed · ${gov.totals24h.blocked} blocked` : "—"} hex={T.cyan} icon={<Cpu size={16} />} />
        <Metric label="Models in registry" value={probability?.models.length ?? "—"} sub={probability ? `${probability.models.filter((m) => m.status === "ACTIVE" || m.status === "PROMOTED").length} active` : "—"} hex={T.amber} />
      </div>

      <Tabs label="Intelligence sections" value={tab} onChange={(t) => { onTab(t); setSelected(null); }} tabs={[
        { id: "research", label: "AI Research", count: research.length },
        { id: "markets", label: "Market Intelligence" },
        { id: "decisions", label: "Decision Feed", count: traces.length },
      ]} />

      {tab === "markets" ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Panel title="Model vs. market" subtitle="Latest robot estimate per market, largest gap first" pad={false}>
            {latestByMarket.length === 0 ? (
              <EmptyState compact title="No model estimates yet" body="Run a robot cycle: each evaluation records the model estimate next to the market price." />
            ) : (
              <TableWrap minWidth={560}>
                <thead><tr><th className={th}>Market</th><th className={`${th} text-right`}>Market</th><th className={`${th} text-right`}>Model</th><th className={`${th} text-right`}>Net edge</th></tr></thead>
                <tbody>
                  {latestByMarket.slice(0, 15).map((t) => (
                    <tr key={t.id} className={`${trow} cursor-pointer`} onClick={() => t.market && onOpenMarket(t.market.id)}>
                      <td className={`${td} max-w-[300px]`}><div className="truncate">{t.market?.question}</div><div className="text-[12.5px] text-[#7C889B]">{ago(t.createdAt)}</div></td>
                      <td className={`${td} fd-num text-right`}>{t.marketPriceCents ?? "—"}¢</td>
                      <td className={`${td} fd-num text-right text-[#B9A2FF]`}>{t.modelEstimatePct?.toFixed(1)}%</td>
                      <td className={`${td} fd-num text-right font-semibold ${(t.edgeNetPct ?? 0) > 0 ? "text-[#3BE6B0]" : "text-[#9AA6B8]"}`}>{t.edgeNetPct != null ? `${t.edgeNetPct > 0 ? "+" : ""}${t.edgeNetPct.toFixed(1)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>
          <Panel title="Price movers (24h)" subtitle="Recorded YES price change, verified venue data" pad={false}>
            {movers.length === 0 ? (
              <EmptyState compact title="No 24h moves recorded" body="Moves appear once a market has been synced more than once within 24 hours." />
            ) : (
              <TableWrap minWidth={520}>
                <thead><tr><th className={th}>Market</th><th className={th}>Venue</th><th className={`${th} text-right`}>YES</th><th className={`${th} text-right`}>24h</th></tr></thead>
                <tbody>
                  {movers.map((m) => (
                    <tr key={m.id} className={`${trow} cursor-pointer`} onClick={() => onOpenMarket(m.id)}>
                      <td className={`${td} max-w-[280px] truncate`}>{m.question}</td>
                      <td className={td}><VenueTag venue={m.venue} /></td>
                      <td className={`${td} fd-num text-right`}>{m.yesPriceCents}¢</td>
                      <td className={`${td} fd-num text-right font-semibold ${m.change24hCents! > 0 ? "text-[#3BE6B0]" : "text-[#FF7A8B]"}`}>{m.change24hCents! > 0 ? "+" : ""}{m.change24hCents}¢</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>
          <Panel title="Model registry" subtitle="Calibration against resolved markets" className="xl:col-span-2" pad={false}>
            {!probability || probability.models.length === 0 ? <EmptyState compact title="No models registered" /> : (
              <TableWrap minWidth={720}>
                <thead><tr><th className={th}>Model</th><th className={th}>Kind</th><th className={th}>Status</th><th className={`${th} text-right`}>Samples</th><th className={`${th} text-right`}>Brier</th><th className={`${th} text-right`}>vs. baseline</th></tr></thead>
                <tbody>
                  {probability.models.map((m) => (
                    <tr key={m.key} className={trow}>
                      <td className={`${td} fd-num`}>{m.key}</td>
                      <td className={`${td} text-[#C9D2DE]`}>{m.kind.toLowerCase()}</td>
                      <td className={td}><Badge tone={m.status === "PROMOTED" || m.status === "ACTIVE" ? "green" : m.status === "DEMOTED" ? "red" : "neutral"}>{m.status.toLowerCase()}</Badge></td>
                      <td className={`${td} fd-num text-right`}>{m.calibration?.n ?? 0}</td>
                      <td className={`${td} fd-num text-right`}>{m.calibration ? m.calibration.brier.toFixed(3) : "—"}</td>
                      <td className={`${td} fd-num text-right ${m.calibration && m.calibration.deltaPct > 0 ? "text-[#3BE6B0]" : "text-[#9AA6B8]"}`}>{m.calibration ? pct(m.calibration.deltaPct, 1, true) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
            <div className="border-t border-[#1A2333] px-5 py-3 text-[13px] text-[#7C889B]">
              Manage providers and promote or demote models in <button className="text-[#6AA9FF] hover:underline" onClick={() => onNavigate({ view: "settings", tab: "models" })}>Settings › Model Registry</button>.
            </div>
          </Panel>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
          <Panel
            title={tab === "research" ? "Research feed" : "Decision feed"}
            subtitle={tab === "research" ? "Decisions that carry a model estimate" : "Every robot decision, newest first"}
            pad={false}
          >
            {tab === "decisions" && (
              <div className="flex flex-wrap gap-2 border-b border-[#1A2333] px-4 pb-4">
                <label className="sr-only" htmlFor="d-dec">Decision</label>
                <select id="d-dec" className={selCls} value={fDecision} onChange={(e) => setFDecision(e.target.value)}>
                  <option value="ALL">All decisions</option>
                  {decisions.map((d) => <option key={d} value={d}>{d.replace(/_/g, " ").toLowerCase()}</option>)}
                </select>
                <label className="sr-only" htmlFor="d-ven">Venue</label>
                <select id="d-ven" className={selCls} value={fVenue} onChange={(e) => setFVenue(e.target.value)}>
                  <option value="ALL">All venues</option>
                  {VENUES.filter((v) => v.adapter === "LIVE").map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
                <label className="sr-only" htmlFor="d-rob">Robot</label>
                <select id="d-rob" className={selCls} value={fRobot} onChange={(e) => setFRobot(e.target.value)}>
                  <option value="ALL">All robots</option>
                  {dash.robots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            )}
            {list.length === 0 ? (
              <EmptyState compact icon={<Brain size={22} />} title={tab === "research" ? "No research yet" : "No decisions match"} body="Run a robot cycle; every evaluation is recorded here with its reasons and risk checks." />
            ) : (
              <ul className="fd-scroll max-h-[720px] overflow-y-auto">
                {list.map((t) => {
                  const on = sel?.id === t.id;
                  return (
                    <li key={t.id}>
                      <button
                        onClick={() => setSelected(t.id)}
                        aria-current={on}
                        className={`flex w-full gap-3 border-t border-[#1A2333] px-4 py-3.5 text-left transition-colors ${on ? "bg-[#2583FF]/10" : "hover:bg-white/[0.03]"}`}
                      >
                        <span className="mt-1 h-10 w-1 shrink-0 rounded-full" style={{ background: venueColor(t.market?.venue ?? "") }} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            {decisionBadge(t.decision)}
                            <span className="text-[14px] font-semibold text-white">{t.robot?.name}</span>
                            <span className="ml-auto text-[12px] text-[#7C889B]">{ago(t.createdAt)}</span>
                          </span>
                          <span className="mt-1 block truncate text-[13.5px] text-[#C9D2DE]">{t.market?.question}</span>
                          {t.modelEstimatePct != null && (
                            <span className="fd-num mt-1 block text-[12.5px] text-[#9AA6B8]">model {t.modelEstimatePct.toFixed(1)}% · market {t.marketPriceCents}¢ · edge {t.edgeNetPct?.toFixed(1) ?? "—"} pts</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Analysis" subtitle={sel ? `${sel.robot?.name} · ${new Date(sel.createdAt).toUTCString().replace(" GMT", " UTC")}` : undefined}>
            {!sel ? (
              <EmptyState compact title="Select a decision" body="Its full reasoning, model provenance and risk checks appear here." />
            ) : (
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center gap-2">
                  {decisionBadge(sel.decision)}
                  {sel.market && <VenueTag venue={sel.market.venue} />}
                  <button className="text-[14px] font-semibold text-white hover:underline" onClick={() => sel.robot && onOpenRobot(sel.robot.id)}>{sel.robot?.name}</button>
                </div>
                <button className="text-left text-[18px] font-semibold leading-snug text-white hover:underline" onClick={() => sel.market && onOpenMarket(sel.market.id)}>{sel.market?.question}</button>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Labeled kind="verified" label="Market price" value={sel.marketPriceCents != null ? `${sel.marketPriceCents}¢` : "—"} />
                  <Labeled kind="model" label="Model estimate" value={sel.modelEstimatePct != null ? `${sel.modelEstimatePct.toFixed(1)}%` : "—"} />
                  <Labeled kind="derived" label="Net edge after fees" value={sel.edgeNetPct != null ? `${sel.edgeNetPct > 0 ? "+" : ""}${sel.edgeNetPct.toFixed(1)} pts` : "—"} />
                </div>

                <div>
                  <h3 className="mb-1.5 text-[14px] font-semibold uppercase tracking-wider text-[#7C889B]">Reasoning</h3>
                  <p className="text-[15px] leading-relaxed text-[#E8EDF5]">{sel.reason}</p>
                </div>

                <TraceDetail t={sel} />

                <div className="rounded-xl border border-[#9B7BFF]/25 bg-[#9B7BFF]/[0.06] p-4 text-[13.5px] leading-relaxed text-[#C9D2DE]">
                  Model estimates are probabilities, not guarantees. A trade only happens after deterministic risk checks pass; the estimate alone never places an order.
                </div>
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === "research" && gov && gov.providers.length > 0 && (
        <Panel title="AI providers" subtitle="Usage and latency over the last 24 hours" pad={false}>
          <TableWrap minWidth={640}>
            <thead><tr><th className={th}>Provider</th><th className={th}>Status</th><th className={`${th} text-right`}>Calls</th><th className={`${th} text-right`}>Blocked</th><th className={`${th} text-right`}>p50 / p95</th><th className={`${th} text-right`}>Budget used</th></tr></thead>
            <tbody>
              {gov.providers.map((p) => (
                <tr key={p.name} className={trow}>
                  <td className={`${td} font-semibold`}>{p.name}</td>
                  <td className={td}><Badge tone={p.enabled ? "green" : "neutral"}>{p.enabled ? "enabled" : "disabled"}</Badge></td>
                  <td className={`${td} fd-num text-right`}>{p.calls24h}</td>
                  <td className={`${td} fd-num text-right`}>{p.blocked24h}</td>
                  <td className={`${td} fd-num text-right text-[#C9D2DE]`}>{p.p50Ms ?? "—"} / {p.p95Ms ?? "—"} ms</td>
                  <td className={`${td} fd-num text-right`}>{pct(p.budgetUsedPct, 0)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Panel>
      )}
      {tab === "research" && probability && (
        <Panel title="Baseline estimator" subtitle="Used whenever no AI model is enabled">
          <KV k="Formula" v={probability.baseline.formula} />
          <KV k="Version" v={`v${probability.baseline.version}`} mono />
          <KV k="Tilt" v={`${probability.baseline.tiltPct}%`} mono />
        </Panel>
      )}
    </div>
  );
}

function Labeled({ kind, label, value }: { kind: "verified" | "model" | "derived"; label: string; value: string }) {
  const meta = {
    verified: { tag: "Verified venue data", tone: "cyan", color: "text-white" },
    model: { tag: "Model estimate", tone: "purple", color: "text-[#B9A2FF]" },
    derived: { tag: "Calculated", tone: "neutral", color: "text-white" },
  }[kind];
  return (
    <div className="rounded-xl border border-[#1E2A3D] bg-[#0D121C] p-4">
      <div className="text-[13px] text-[#9AA6B8]">{label}</div>
      <div className={`fd-num mt-1 text-[22px] font-semibold ${meta.color}`}>{value}</div>
      <div className="mt-2"><Badge tone={meta.tone}>{meta.tag}</Badge></div>
    </div>
  );
}
