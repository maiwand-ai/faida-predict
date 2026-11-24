"use client";

// FAIDA Predict — Dashboard (venue-first cockpit) + per-venue Workspace.
//
// The dashboard answers the founder's three questions at a glance:
//   1. What is the total balance / exposure / today's flow?   → KPI band
//   2. Which venue, market and robot are in trade right now?  → "In trade now"
//   3. Where do I go to work on a venue?                      → venue grid:
//      pick a venue → its workspace → robot creation, markets, orders.
//
// Every element names its venue (B11). The venue grid is driven by the
// registry rollup (`venues` in /api/dashboard), never by scattered data.

import { useState, useSyncExternalStore } from "react";
import { ArrowLeft, Play, Plus, RefreshCw } from "lucide-react";
import {
  type DashboardDTO,
  type MarketDTO,
  type TraceDTO,
  FAMILY_LABEL,
} from "./types";
import { c, mono, fmtCents, VenueBadge } from "./ui";
import { ROLE_LABEL, VENUES } from "@/lib/venues";
import { Badge, btn, EmptyState, KV, Metric, money, orderStateBadge, PageSkeleton, Panel, robotStatusBadge, Segmented, TableWrap, td, th, toneOf, toneText, trow } from "./ds";
import { EMPTY_ENTRY_RULES, VENUE_ENTRY_RULES } from "@/lib/venue/rules";





// ── Venue workspace ───────────────────────────────────────────────────────
// One architecture for every venue: header with connection and adapter
// status, KPIs, markets (left) and robots + rules (right), then positions,
// orders, decisions, connection health and data quality. The workspace wears
// the venue's color. Pending and suspended venues say why, and never offer
// actions their adapter can't perform.
export function VenueWorkspace(props: {
  venueId: string;
  dash: DashboardDTO | null;
  markets: MarketDTO[];
  busy: string | null;
  onBack: () => void;
  onSyncVenue: (venue: string) => void;
  onCycle: () => void;
  onTrade: (m: MarketDTO) => void;
  onOpenMarket: (id: string) => void;
  onCreateRobot: (venueId: string) => void;
  onControl: (body: Record<string, unknown>, okMsg: string) => void;
  onOpenRobot: (robotId: string) => void;
}) {
  const { venueId, dash, markets, busy, onBack, onSyncVenue, onCycle, onTrade, onOpenMarket, onCreateRobot, onOpenRobot } = props;
  const v = VENUES.find((x) => x.id === venueId);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [mktFilter, setMktFilter] = useState<"all" | "closing" | "thin">("all");
  if (!dash || !v) return <PageSkeleton />;
  const stat = dash.venues.find((s) => s.venue === venueId);
  const vRobots = dash.robots.filter((r) => r.venue === venueId);
  const vMarkets = markets.filter((m) => m.venue === venueId);
  const vPositions = dash.positions.filter((p) => p.market?.venue === venueId);
  const vOrders = dash.orders.filter((o) => o.market?.venue === venueId);
  const vTraces = dash.traces.filter((t) => t.market?.venue === venueId);
  const live = v.adapter === "LIVE";
  const suspended = v.id === "DRIFT_BET";
  const rules = VENUE_ENTRY_RULES[venueId] ?? EMPTY_ENTRY_RULES;
  const hex = v.hex;

  const robotPnl = new Map<string, { open: number; pnl: number | null }>();
  for (const p of vPositions) {
    const name = p.robot?.name ?? "—";
    const cur = robotPnl.get(name) ?? { open: 0, pnl: null };
    cur.open += 1;
    if (p.unrealizedCents != null) cur.pnl = (cur.pnl ?? 0) + p.unrealizedCents;
    robotPnl.set(name, cur);
  }

  const syncedAt = stat?.syncedAt ? new Date(stat.syncedAt).getTime() : null;
  const ageMin = mounted && syncedAt != null ? Math.floor((Date.now() - syncedAt) / 60000) : null;
  const freshLabel = ageMin == null ? "—" : ageMin < 1 ? "Just now" : ageMin < 60 ? `${ageMin}m ago` : ageMin < 1440 ? `${Math.floor(ageMin / 60)}h ago` : `${Math.floor(ageMin / 1440)}d ago`;
  const stale = ageMin != null && ageMin > 360;

  const closingSoon = vMarkets.filter((m) => m.closeDate && new Date(m.closeDate).getTime() - Date.now() < 14 * 86_400_000 && new Date(m.closeDate).getTime() > Date.now());
  const thinBook = vMarkets.filter((m) => rules.minTouchDepthCents != null && (m.yesTouchDepthCents == null || m.yesTouchDepthCents < rules.minTouchDepthCents));
  const shown = mktFilter === "closing" ? closingSoon : mktFilter === "thin" ? thinBook : vMarkets;
  const feeBps = vMarkets.map((m) => m.yesTakerFeeBps).filter((x): x is number => x != null);
  const feeRange = feeBps.length ? (Math.min(...feeBps) === Math.max(...feeBps) ? `${Math.min(...feeBps)} bps` : `${Math.min(...feeBps)}–${Math.max(...feeBps)} bps`) : null;
  const liveSrc = vMarkets.filter((m) => m.dataSource.endsWith("_LIVE") || m.dataSource.endsWith("_SYNC")).length;
  const missingPrice = vMarkets.filter((m) => m.yesPriceCents == null || m.noPriceCents == null).length;
  const flagged = vMarkets.filter((m) => m.ambiguityFlag).length;
  const credential: Record<string, string> = {
    POLYMARKET: "Wallet (EVM · Polygon)",
    MANIFOLD: "Public API, play money",
    LIMITLESS: "Public REST · wallet (Base)",
    KALSHI: "API key (RSA / Ed25519)",
    AZURO: "Wallet (EVM)",
    DRIFT_BET: "Adapter not built",
  };
  const unrealized = vPositions.reduce((a, p) => a + (p.unrealizedCents ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-[13.5px] text-[var(--fd-text3)]">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 hover:text-[var(--fd-strong)]"><ArrowLeft size={14} /> Markets</button>
        <span className="mx-1.5" aria-hidden>/</span><span className="text-[var(--fd-text-soft)]">Venues</span>
        <span className="mx-1.5" aria-hidden>/</span><span className="text-[var(--fd-text-soft)]">{v.label}</span>
      </nav>

      <section className="relative overflow-hidden rounded-2xl border fd-glass bg-[var(--fd-surface)] p-5 sm:p-6" style={{ borderColor: `color-mix(in srgb, ${hex} ${live ? 35 : 18}%, transparent)` }}>
        <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(720px 240px at 0% 0%, color-mix(in srgb, ${hex} ${live ? 18 : 8}%, transparent), transparent 70%)` }} />
        <div className="relative flex flex-wrap items-center gap-5">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-[28px] font-bold" style={live ? { background: hex, color: "#071018" } : { background: `color-mix(in srgb, ${hex} 14%, transparent)`, color: `color-mix(in srgb, ${hex} 60%, var(--fd-text2))` }} aria-hidden>
            {v.label.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[28px] font-bold tracking-tight text-[var(--fd-strong)] sm:text-[32px]">{v.label}</h1>
              {live ? <Badge tone="green" dot>Connected</Badge> : suspended ? <Badge tone="red" dot>Suspended</Badge> : <Badge tone="amber" dot>Adapter pending</Badge>}
              <Badge>{ROLE_LABEL[v.role].toLowerCase()}</Badge>
            </div>
            <p className="mt-1.5 text-[15px] text-[var(--fd-text2)]">
              {({ POLYMARKET: "Main venue · Polygon · USDC order book", MANIFOLD: "Play money · zero-risk test ground", LIMITLESS: "Crypto order book on Base · USDC", KALSHI: "CFTC-regulated US exchange · USD", AZURO: "On-chain sports betting · EVM", DRIFT_BET: "Solana prediction markets" } as Record<string, string>)[v.id]}
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {live && (
              <button className={btn.secondary} onClick={() => onSyncVenue(v.id)} disabled={busy === "sync"}>
                <RefreshCw size={16} className={busy === "sync" ? "animate-spin" : ""} /> {busy === "sync" ? "Refreshing…" : "Refresh"}
              </button>
            )}
            <button className={btn.secondary} onClick={onCycle} disabled={busy !== null || !live}><Play size={16} /> Check markets now</button>
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-[14.5px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: live ? hex : "var(--fd-border2)", color: live ? "#071018" : "var(--fd-text2)" }}
              disabled={!live}
              title={live ? undefined : "Robots can't be created here until the adapter is live"}
              onClick={() => onCreateRobot(v.id)}
            >
              <Plus size={16} /> Create robot
            </button>
          </div>
        </div>
      </section>

      {!live && (
        <div role="note" className="rounded-2xl border px-5 py-4 text-[14.5px] leading-relaxed text-[var(--fd-text)]" style={{ borderColor: suspended ? "rgba(255,82,104,0.35)" : "rgba(255,181,71,0.35)", background: suspended ? "rgba(255,82,104,0.08)" : "rgba(255,181,71,0.08)" }}>
          {suspended
            ? "This venue has been offline since the April 2026 exploit, so no adapter was built. The venue stays listed so the lineup never changes silently; a replacement venue may take its place later."
            : "The adapter is built but not verified yet: it goes live once its contract test passes against recorded market data. Until then there is no market data here and robot creation is disabled."}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Metric label="Markets synced" value={stat?.markets ?? 0} hex={hex} sub={live ? "Open markets" : "Adapter not live"} />
        <Metric label="Active robots" value={`${stat?.robotsActive ?? 0} / ${stat?.robotsTotal ?? 0}`} hex={hex} sub="Running / scoped here" />
        <Metric label="Open exposure" value={money(stat?.exposureCents ?? 0)} hex={hex} sub={`${stat?.openPositions ?? 0} positions`} />
        <Metric label="Today (open marks)" value={vPositions.length ? money(unrealized, { sign: true }) : "—"} tone={vPositions.length ? toneOf(unrealized) : "flat"} hex={hex} sub="Mark-to-market" />
        <Metric label="Data freshness" value={freshLabel} tone={stale ? "loss" : "text"} hex={hex} sub={stale ? "Stale: sync again" : live ? "Last venue sync" : "—"} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title={<span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: hex }} />Markets on {v.label}</span>}
          pad={false}
          action={
            <Segmented label="Market filter" value={mktFilter} onChange={setMktFilter} options={[
              { id: "all", label: `All ${vMarkets.length}` },
              { id: "closing", label: `Closing soon ${closingSoon.length}` },
              ...(rules.minTouchDepthCents != null ? [{ id: "thin" as const, label: `Thin book ${thinBook.length}` }] : []),
            ]} />
          }
        >
          <div className="mt-3">
            {shown.length === 0 ? (
              <EmptyState compact title={!live ? `No ${v.label} markets` : mktFilter === "all" ? `No ${v.label} markets synced yet` : "No markets match this filter"} body={live && mktFilter === "all" ? "Press Sync above to pull this venue's open markets." : undefined} />
            ) : (
              <TableWrap minWidth={760}>
                <thead><tr><th className={th}>Market</th><th className={th}>YES</th><th className={`${th} text-right`}>NO</th><th className={`${th} text-right`}>Top-of-book depth</th><th className={`${th} text-right`}>Volume</th><th className={th}><span className="sr-only">Trade</span></th></tr></thead>
                <tbody>
                  {shown.slice(0, 40).map((m) => {
                    const thin = rules.minTouchDepthCents != null && (m.yesTouchDepthCents == null || m.yesTouchDepthCents < rules.minTouchDepthCents);
                    return (
                      <tr key={m.id} className={`${trow} cursor-pointer`} onClick={() => onOpenMarket(m.id)}>
                        <td className={`${td} max-w-[320px]`}>
                          <div className="truncate font-medium">{m.question}</div>
                          <div className="mt-0.5 text-[12.5px] text-[var(--fd-text3)]">
                            <span className="capitalize">{m.category}</span>
                            {m.closeDate ? ` · closes ${new Date(m.closeDate).toLocaleDateString("en-US", { day: "numeric", month: "short" })}` : ""}
                            {m.eventKey ? " · event cluster" : ""}{m.ambiguityFlag ? " · flagged" : ""}
                          </div>
                        </td>
                        <td className={td}>
                          <div className="flex items-center gap-2.5">
                            <span className="fd-num w-10 font-semibold text-[var(--fd-strong)]">{m.yesPriceCents ?? "—"}¢</span>
                            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[color:var(--fd-ink)]/[0.07]" aria-hidden><span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, m.yesPriceCents ?? 0))}%`, background: hex }} /></span>
                          </div>
                        </td>
                        <td className={`${td} fd-num text-right text-[var(--fd-text-soft)]`}>{m.noPriceCents ?? "—"}¢</td>
                        <td className={`${td} fd-num text-right ${thin ? "text-[var(--fd-amber-text)]" : "text-[var(--fd-text-soft)]"}`} title={thin ? "Below the venue minimum: entries are refused" : undefined}>{m.yesTouchDepthCents != null ? money(m.yesTouchDepthCents) : "—"}</td>
                        <td className={`${td} fd-num text-right text-[var(--fd-text-soft)]`}>{money(m.volumeCents, { compact: true })}</td>
                        <td className={`${td} text-right`}>
                          <button className={btn.small} onClick={(e) => { e.stopPropagation(); onTrade(m); }} disabled={m.ambiguityFlag || !live}>Trade</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            )}
          </div>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title={`Robots on ${v.label}`} action={<span className="text-[13px] text-[var(--fd-text3)]">{vRobots.length} scoped</span>}>
            {vRobots.length === 0 ? (
              <EmptyState compact title="No robots here yet" body={live ? "Create one pre-scoped to this venue." : "Robots can be scoped here once the adapter is live."} />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {vRobots.map((r) => {
                  const rp = robotPnl.get(r.name);
                  return (
                    <li key={r.id}>
                      <button onClick={() => onOpenRobot(r.id)} className="w-full rounded-xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] p-3.5 text-left transition-colors hover:border-[var(--fd-border2)]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[15px] font-semibold text-[var(--fd-strong)]">{r.name}</span>
                          <span className={`fd-num text-[14px] font-semibold ${toneText[toneOf(rp?.pnl)]}`}>{rp?.pnl != null ? money(rp.pnl, { sign: true }) : "—"}</span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-2 text-[13px] text-[var(--fd-text2)]">
                          <span className="truncate">{FAMILY_LABEL[r.family] ?? r.family} · v{r.activeVersion}</span>
                          {robotStatusBadge(r.status)}
                        </div>
                        <div className="fd-num mt-2 text-[12.5px] text-[var(--fd-text3)]">{money(r.allocatedCents)} allocated · cap {money(r.maxPositionCents)} · ≤ {r.maxOpenPositions} open</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel title="Venue rules" subtitle="Enforced by the risk engine at cycle and ticket time">
            <KV k="Adapter" v={live ? "Live · market data" : suspended ? "Suspended" : "Pending"} />
            <KV k="Credential" v={credential[v.id] ?? "—"} />
            <KV k="Minimum book depth" v={rules.minTouchDepthCents != null ? money(rules.minTouchDepthCents) : "Not required"} mono />
            <KV k="Per-market cap" v={rules.perMarketPositionCapCents != null ? money(rules.perMarketPositionCapCents) : "Not set"} mono />
            <KV k="Close window" v={rules.minMinutesBeforeClose != null ? `${rules.minMinutesBeforeClose} min before close` : "Not set"} mono />
            <KV k="Taker fee" v={feeRange ?? "Not reported"} mono />
          </Panel>
        </div>
      </div>

      {vPositions.length > 0 && (
        <Panel title={`In trade on ${v.label}`} pad={false}>
          <TableWrap minWidth={720}>
            <thead><tr><th className={th}>Market</th><th className={th}>Robot</th><th className={th}>Side</th><th className={`${th} text-right`}>Size</th><th className={`${th} text-right`}>Entry → mark</th><th className={`${th} text-right`}>P&L</th></tr></thead>
            <tbody>
              {vPositions.map((p) => {
                const mark = p.side === "YES" ? p.market?.yesPriceCents : p.market?.noPriceCents;
                return (
                  <tr key={p.id} className={trow}>
                    <td className={`${td} max-w-[320px] truncate`}>{p.market?.question}</td>
                    <td className={`${td} text-[var(--fd-text-soft)]`}>{p.robot?.name ?? "Manual"}</td>
                    <td className={td}><Badge tone={p.side === "YES" ? "green" : "red"}>{p.side}</Badge></td>
                    <td className={`${td} fd-num text-right`}>{money(p.sizeCents)}</td>
                    <td className={`${td} fd-num text-right text-[var(--fd-text-soft)]`}>{p.avgPriceCents}¢ → {mark != null ? `${mark}¢` : "—"}</td>
                    <td className={`${td} fd-num text-right font-semibold ${toneText[toneOf(p.unrealizedCents)]}`}>{p.unrealizedCents != null ? money(p.unrealizedCents, { sign: true }) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Recent orders" pad={false}>
          {vOrders.length === 0 ? <EmptyState compact title={`No orders on ${v.label} yet`} /> : (
            <TableWrap minWidth={520}>
              <thead><tr><th className={th}>Market</th><th className={th}>Side</th><th className={`${th} text-right`}>Size</th><th className={th}>State</th></tr></thead>
              <tbody>
                {vOrders.map((o) => (
                  <tr key={o.id} className={trow}>
                    <td className={`${td} max-w-[240px] truncate`}>{o.market?.question}{o.robot ? <span className="text-[var(--fd-text3)]"> · {o.robot.name}</span> : null}</td>
                    <td className={td}><Badge tone={o.side.includes("YES") ? "green" : "red"}>{o.side.replace("_", " ")}</Badge></td>
                    <td className={`${td} fd-num text-right`}>{money(o.sizeCents)}</td>
                    <td className={td}>{orderStateBadge(o.state)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
        <Panel title="Recent decisions">
          {vTraces.length === 0 ? <EmptyState compact title={`No robot decisions on ${v.label} yet`} /> : <div>{vTraces.map((t) => <TraceRow key={t.id} t={t} />)}</div>}
        </Panel>
        <Panel title="Connection health">
          <KV k="Adapter status" v={live ? <Badge tone="green" dot>Live</Badge> : suspended ? <Badge tone="red" dot>Suspended</Badge> : <Badge tone="amber" dot>Pending</Badge>} />
          <KV k="Last successful sync" v={stat?.syncedAt ? `${new Date(stat.syncedAt).toUTCString().replace(" GMT", " UTC")}` : "Never"} />
          <KV k="Freshness" v={stale ? <Badge tone="amber">Stale</Badge> : stat?.syncedAt ? <Badge tone="green">Fresh</Badge> : "—"} />
          <KV k="Order sending" v="Paper only: live sends stay behind the gates" />
        </Panel>
        <Panel title="Data quality">
          <KV k="Markets from live data" v={vMarkets.length ? `${liveSrc} of ${vMarkets.length}` : "—"} mono />
          <KV k="Missing prices" v={missingPrice} mono />
          <KV k="Flagged for ambiguous resolution" v={flagged} mono />
          <KV k="Below minimum book depth" v={rules.minTouchDepthCents != null ? thinBook.length : "Rule not used here"} mono />
        </Panel>
      </div>
    </div>
  );
}

// ── A-08 front-end depth: one expandable trace row, shared by the dashboard
// traces list and every venue workspace. Collapsed = the glanceable verdict;
// expanded = the full evidence: provenance envelope (A-02) and the pre-trade
// risk checks with their pass/fail verdicts and details. "A forecast without
// provenance is not evidence" — clicking any trace shows exactly that.
export function TraceRow({ t }: { t: TraceDTO }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`border-b py-2.5 last:border-0 ${c.border}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-2 text-left" aria-expanded={open}>
        <span className={`rounded px-2 py-0.5 text-[12px] font-bold ${t.decision === "TRADE" ? `${c.bright} bg-[#2583FF]/10` : `${c.text3} bg-[var(--fd-elevated)]`}`}>{t.decision}</span>
        <ModelChip modelKey={t.modelKey} provenance={t.provenance} />
        <span className={`text-[14px] font-semibold ${c.text}`}>{t.robot?.name}</span>
        {t.market?.venue && <VenueBadge venue={t.market.venue} withLabel={false} />}
        <span className={`text-[13px] ${c.text3}`}>on {t.market?.question.slice(0, 60)}</span>
        {t.modelEstimatePct != null && (
          <span className={`ml-auto text-[13px] ${c.text2} ${mono}`}>est {t.modelEstimatePct}% · mkt {t.marketPriceCents}¢ · edge {t.edgeNetPct} pts</span>
        )}
        <span className={`text-[12px] ${open ? c.bright : c.text3}`}>{open ? "▾" : "▸"}</span>
      </button>
      <div className={`mt-1 text-[13px] ${c.text2}`}>{t.reason}</div>
      {open && <TraceDetail t={t} />}
    </div>
  );
}

export function TraceDetail({ t }: { t: TraceDTO }) {
  const prov = parseProvenance(t.provenance);
  const checks = parseRiskChecks(t.riskChecks);
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1">
      <span className={`shrink-0 text-[13.5px] ${c.text3}`}>{k}</span>
      <span className={`text-right text-[13.5px] ${c.text2}`}>{v}</span>
    </div>
  );
  return (
    <div className="mt-2 rounded-xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] p-4">
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
        <div>
          <div className={`mb-2 text-[13px] font-semibold uppercase tracking-wider ${c.text3}`}>Model & provenance</div>
          {row("model", <span className={mono}>{t.modelKey ?? "—"}</span>)}
          {prov?.kind && row("kind", prov.kind)}
          {prov?.provider && row("provider / model", `${prov.provider}${prov.model ? " · " + prov.model : ""}`)}
          {prov?.estimatorVersion && row("estimator version", <span className={mono}>{prov.estimatorVersion}</span>)}
          {prov?.latencyMs != null && row("latency", `${prov.latencyMs} ms`)}
          {prov?.cache && row("cache", prov.cache === "HIT" ? "HIT (cached, zero cost)" : prov.cache)}
          {row("screening", <span className={prov?.screening === "FLAGGED" ? "text-[var(--fd-red-text)]" : "text-[var(--fd-green-text)]"}>{prov?.screening ?? "—"}{prov?.screeningReasons?.length ? ` — ${prov.screeningReasons.join("; ")}` : ""}</span>)}
          {prov?.fallbackFrom && row("fallback from", <span className="text-[var(--fd-amber-text)]">{prov.fallbackFrom}</span>)}
          {prov?.costCents != null && row("AI cost", fmtCents(prov.costCents))}
          {prov?.evidenceHash && row("evidence hash", <span className={mono} title={prov.evidenceHash}>{prov.evidenceHash.slice(0, 18)}…</span>)}
        </div>
        <div>
          <div className={`mb-2 text-[13px] font-semibold uppercase tracking-wider ${c.text3}`}>Pre-trade risk checks</div>
          {checks.length === 0 && <div className={`text-[13.5px] ${c.text3}`}>No checks recorded on this decision</div>}
          {checks.map((ck, i) => (
            <div key={i} className="py-1">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1 py-px text-[12px] font-bold ${ck.passed ? "text-[var(--fd-green-text)] bg-[#00D69A]/10" : "text-[var(--fd-red-text)] bg-[#FF5268]/10"}`}>{ck.passed ? "PASS" : "FAIL"}</span>
                <span className={`text-[13.5px] font-semibold ${c.text}`}>{ck.check}</span>
              </div>
              <div className={`ml-1 border-l pl-2 text-[13px] ${c.text3}`} style={{ borderColor: ck.passed ? "#1D4A3C" : "#4A1D25" }}>{ck.detail}</div>
            </div>
          ))}
        </div>
      </div>
      <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-[13px] ${c.border} ${c.text3}`}>
        <span>trace <span className={mono}>{t.id.slice(0, 10)}…</span></span>
        <span>trigger <b className={c.text2}>{t.trigger ?? "—"}</b></span>
        <span>strategy <span className={mono}>{t.strategyVersionId ? t.strategyVersionId.slice(0, 10) + "…" : "—"}</span></span>
        <span>decided {new Date(t.createdAt).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}

function parseProvenance(p?: string | null): ProvenanceShape | null {
  if (!p) return null;
  try {
    return JSON.parse(p) as ProvenanceShape;
  } catch {
    return null;
  }
}

interface ProvenanceShape {
  kind?: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  cache?: string;
  screening?: string;
  screeningReasons?: string[];
  estimatorVersion?: string;
  fallbackFrom?: string;
  evidenceHash?: string;
  costCents?: number;
}

function parseRiskChecks(rc?: string | null): Array<{ check: string; passed: boolean; detail: string }> {
  if (!rc) return [];
  try {
    const arr = JSON.parse(rc) as Array<{ check: string; passed: boolean; detail: string }>;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}


// Phase 5 (A-02): which estimator produced this forecast — visible on every
// trace. BL = baseline heuristic, AI:<PROVIDER> = registry AI model; a cache
// hit or a screening flag is stated so provenance is glanceable (D-03 style).
function ModelChip({ modelKey, provenance }: { modelKey?: string | null; provenance?: string | null }) {
  if (!modelKey) return null;
  let cache: string | null = null;
  let flagged = false;
  try {
    const p = provenance ? (JSON.parse(provenance) as { cache?: string; screening?: string }) : null;
    cache = p?.cache ?? null;
    flagged = p?.screening === "FLAGGED";
  } catch {
    /* provenance is optional metadata */
  }
  const isAI = modelKey.startsWith("ai:");
  const label = isAI ? `AI:${modelKey.slice(3).split("/")[0]}` : "BL";
  return (
    <span
      title={`${modelKey}${cache ? " · cache " + cache : ""}${flagged ? " · flagged by the safety screen" : ""}`}
      className={`rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide ${
        isAI ? `text-[var(--fd-purple-text)] bg-[var(--fd-purple-text)]/10` : `${c.text3} bg-[var(--fd-elevated)]`
      }`}
    >
      {label}
      {cache === "HIT" && <span className="text-[var(--fd-green-text)]"> ·C</span>}
      {flagged && <span className="text-[var(--fd-red-text)]"> · flagged</span>}
    </span>
  );
}

