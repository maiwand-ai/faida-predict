"use client";

// FAIDA Predict — Market Discovery terminal, Market Detail, and the manual
// paper-order ticket. Every number comes from synced venue data
// (GET /api/markets, GET /api/markets/[id]); orders go through the existing
// POST /api/orders path with all of its eligibility and risk checks.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Compass, RefreshCw, Star } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { DashboardDTO, MarketDTO, OrderRowDTO, TraceDTO } from "./types";
import { VENUES, venueColor } from "@/lib/venues";
import { EMPTY_ENTRY_RULES, VENUE_ENTRY_RULES } from "@/lib/venue/rules";
import {
  AreaChart, Badge, btn, decisionBadge, EmptyState, KV, money, orderStateBadge, PageHeader, PageSkeleton, Panel,
  Segmented, shortDate, Tabs, TableWrap, td, th, trow, VenueTag, ago,
} from "./ds";

// ── watchlist (per-viewer convenience, browser-local) ─────────────────────
const WL_KEY = "faida.watchlist";
function readWatchlist(): string[] {
  try {
    return JSON.parse(localStorage.getItem(WL_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function useWatchlist() {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from browser storage after mount
    setIds(readWatchlist());
  }, []);
  const toggle = (id: string) =>
    setIds((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      try { localStorage.setItem(WL_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  return { ids, toggle };
}

type MarketWithMeta = MarketDTO & { createdAt?: string };

function probabilityBar(p: number | null, hex: string) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="fd-num w-11 text-[14px] font-semibold text-[var(--fd-strong)]">{p != null ? `${p}%` : "—"}</span>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[color:var(--fd-ink)]/[0.07]" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, p ?? 0))}%`, background: hex }} />
      </span>
    </div>
  );
}

function change(v: number | null | undefined) {
  if (v == null) return <span className="text-[var(--fd-text3)]">—</span>;
  if (v === 0) return <span className="fd-num text-[var(--fd-text2)]">0¢</span>;
  const up = v > 0;
  return (
    <span className={`fd-num inline-flex items-center gap-0.5 font-semibold ${up ? "text-[var(--fd-green-text)]" : "text-[var(--fd-red-text)]"}`}>
      {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      {up ? "+" : ""}{v}¢
    </span>
  );
}

const TAB_DEFS = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New Markets" },
  { id: "active", label: "Most Active" },
  { id: "liquid", label: "Most Liquid" },
  { id: "closing", label: "Closing Soon" },
  { id: "movers", label: "Price Movers" },
  { id: "watchlist", label: "Watchlist" },
  { id: "all", label: "All Markets" },
  { id: "categories", label: "Categories" },
] as const;

const PAGE = 25;

export function MarketsView(props: {
  markets: MarketDTO[];
  dash: DashboardDTO | null;
  tab: string;
  onTab: (t: string) => void;
  onSync: (venue?: string) => void;
  onTrade: (m: MarketDTO) => void;
  onOpenMarket: (id: string) => void;
  busy: string | null;
}) {
  const { markets, tab, onTab, onSync, onTrade, onOpenMarket, busy } = props;
  const wl = useWatchlist();
  const [q, setQ] = useState("");
  const [venue, setVenue] = useState<string>("ALL");
  const [category, setCategory] = useState<string>("ALL");
  const [prob, setProb] = useState<string>("any");
  const [closing, setClosing] = useState<string>("any");
  const [status, setStatus] = useState<string>("any");
  const [minVol, setMinVol] = useState<string>("0");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of markets) m.set(x.category, (m.get(x.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [markets]);

  const rows = useMemo(() => {
    const now = Date.now();
    let r = markets as MarketWithMeta[];
    if (tab === "watchlist") r = r.filter((m) => wl.ids.includes(m.id));
    if (tab === "closing") r = r.filter((m) => m.closeDate && new Date(m.closeDate).getTime() > now);
    if (tab === "movers") r = r.filter((m) => m.change24hCents != null && m.change24hCents !== 0);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      r = r.filter((m) => m.question.toLowerCase().includes(s) || m.category.toLowerCase().includes(s));
    }
    if (venue !== "ALL") r = r.filter((m) => m.venue === venue);
    if (category !== "ALL") r = r.filter((m) => m.category === category);
    if (prob !== "any") {
      const [lo, hi] = prob.split("-").map(Number);
      r = r.filter((m) => m.yesPriceCents != null && m.yesPriceCents >= lo && m.yesPriceCents <= hi);
    }
    if (closing !== "any") {
      const days = Number(closing);
      r = r.filter((m) => m.closeDate && new Date(m.closeDate).getTime() - now <= days * 86400000 && new Date(m.closeDate).getTime() > now);
    }
    if (status === "tradeable") r = r.filter((m) => !m.ambiguityFlag);
    if (status === "flagged") r = r.filter((m) => m.ambiguityFlag);
    const mv = Number(minVol) * 100;
    if (mv > 0) r = r.filter((m) => (m.volumeCents ?? 0) >= mv);

    const by: Record<string, (m: MarketWithMeta) => number> = {
      volume: (m) => m.volumeCents ?? -1,
      liquidity: (m) => m.liquidityCents ?? -1,
      yes: (m) => m.yesPriceCents ?? -1,
      no: (m) => m.noPriceCents ?? -1,
      change: (m) => m.change24hCents ?? -999,
      close: (m) => (m.closeDate ? new Date(m.closeDate).getTime() : Number.MAX_SAFE_INTEGER),
      created: (m) => (m.createdAt ? new Date(m.createdAt).getTime() : 0),
    };
    const tabSort: Record<string, [string, 1 | -1]> = {
      trending: ["volume", -1], new: ["created", -1], active: ["volume", -1], liquid: ["liquidity", -1],
      closing: ["close", 1], movers: ["change", -1], watchlist: ["volume", -1], all: ["volume", -1],
    };
    const [key, dir] = sort ? [sort.key, sort.dir] : tabSort[tab] ?? ["volume", -1];
    const f = by[key] ?? by.volume;
    const sorted = [...r];
    if (tab === "trending" && !sort) {
      sorted.sort((a, b) => Math.abs(b.change24hCents ?? 0) - Math.abs(a.change24hCents ?? 0) || f(b) - f(a));
    } else if (tab === "movers" && !sort) {
      sorted.sort((a, b) => Math.abs(b.change24hCents ?? 0) - Math.abs(a.change24hCents ?? 0));
    } else sorted.sort((a, b) => (f(a) - f(b)) * dir);
    return sorted;
  }, [markets, tab, wl.ids, q, venue, category, prob, closing, status, minVol, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const shown = rows.slice(cur * PAGE, cur * PAGE + PAGE);
  const sortBtn = (key: string, label: string, align: "left" | "right" = "left") => (
    <button
      onClick={() => { setSort((s) => (s?.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 })); setPage(0); }}
      className={`inline-flex items-center gap-1 uppercase hover:text-[var(--fd-strong)] ${align === "right" ? "justify-end" : ""}`}
      aria-label={`Sort by ${label}`}
    >
      {label}{sort?.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
    </button>
  );
  const sel = "h-10 rounded-xl border border-[var(--fd-border2)] bg-[var(--fd-surface)] px-3 text-[14px] text-[var(--fd-text)]";
  const liveVenues = VENUES.filter((v) => v.adapter === "LIVE");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<Compass size={24} />}
        title="Market Discovery"
        subtitle={`${markets.length} open markets across ${new Set(markets.map((m) => m.venue)).size} venues · read-only venue data, synced on demand`}
        actions={
          <button className={btn.primary} onClick={() => onSync()} disabled={busy === "sync"}>
            <RefreshCw size={16} className={busy === "sync" ? "animate-spin" : ""} /> {busy === "sync" ? "Syncing…" : "Sync all venues"}
          </button>
        }
      />

      <Tabs
        label="Market lists"
        tabs={TAB_DEFS.map((t) => ({ id: t.id, label: t.label, count: t.id === "watchlist" ? wl.ids.length : undefined }))}
        value={tab}
        onChange={(t) => { onTab(t); setPage(0); setSort(null); }}
      />

      {tab === "categories" ? (
        categories.length === 0 ? (
          <Panel><EmptyState title="No markets synced yet" body="Sync the venues to load their markets." action={<button className={btn.primary} onClick={() => onSync()}>Sync now</button>} /></Panel>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {categories.map(([cat, n]) => {
              const inCat = markets.filter((m) => m.category === cat);
              const vol = inCat.reduce((a, m) => a + (m.volumeCents ?? 0), 0);
              const venues = [...new Set(inCat.map((m) => m.venue))];
              return (
                <button key={cat} onClick={() => { setCategory(cat); onTab("all"); }} className="rounded-2xl border border-[var(--fd-border)] bg-[var(--fd-surface)] p-5 text-left transition-colors hover:border-[#2583FF]/50">
                  <div className="flex items-center justify-between">
                    <span className="text-[17px] font-semibold capitalize text-[var(--fd-strong)]">{cat}</span>
                    <Badge tone="blue">{n} markets</Badge>
                  </div>
                  <div className="mt-3 text-[14px] text-[var(--fd-text2)]">Volume <span className="fd-num font-semibold text-[var(--fd-strong)]">{money(vol, { compact: true })}</span></div>
                  <div className="mt-3 flex flex-wrap gap-1.5">{venues.map((v) => <VenueTag key={v} venue={v} />)}</div>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <Panel pad={false}>
          <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--fd-line)] p-4">
            <label className="sr-only" htmlFor="mkt-q">Search markets</label>
            <input id="mkt-q" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search markets…" className={`${sel} min-w-[200px] flex-1 placeholder:text-[var(--fd-text3)]`} />
            <label className="sr-only" htmlFor="f-venue">Venue</label>
            <select id="f-venue" className={sel} value={venue} onChange={(e) => { setVenue(e.target.value); setPage(0); }}>
              <option value="ALL">All venues</option>
              {liveVenues.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <label className="sr-only" htmlFor="f-cat">Category</label>
            <select id="f-cat" className={sel} value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }}>
              <option value="ALL">All categories</option>
              {categories.map(([c]) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="sr-only" htmlFor="f-prob">Probability</label>
            <select id="f-prob" className={sel} value={prob} onChange={(e) => { setProb(e.target.value); setPage(0); }}>
              <option value="any">Any probability</option>
              <option value="0-20">0–20%</option>
              <option value="20-40">20–40%</option>
              <option value="40-60">40–60%</option>
              <option value="60-80">60–80%</option>
              <option value="80-100">80–100%</option>
            </select>
            <label className="sr-only" htmlFor="f-vol">Minimum volume</label>
            <select id="f-vol" className={sel} value={minVol} onChange={(e) => { setMinVol(e.target.value); setPage(0); }}>
              <option value="0">Any volume</option>
              <option value="1000">Vol ≥ $1K</option>
              <option value="10000">Vol ≥ $10K</option>
              <option value="100000">Vol ≥ $100K</option>
              <option value="1000000">Vol ≥ $1M</option>
            </select>
            <label className="sr-only" htmlFor="f-close">Closing</label>
            <select id="f-close" className={sel} value={closing} onChange={(e) => { setClosing(e.target.value); setPage(0); }}>
              <option value="any">Any close date</option>
              <option value="1">Closes within 24h</option>
              <option value="7">Within 7 days</option>
              <option value="30">Within 30 days</option>
            </select>
            <label className="sr-only" htmlFor="f-status">Status</label>
            <select id="f-status" className={sel} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
              <option value="any">Any status</option>
              <option value="tradeable">Tradeable</option>
              <option value="flagged">Flagged for review</option>
            </select>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title={markets.length === 0 ? "No markets synced yet" : tab === "watchlist" ? "Your watchlist is empty" : tab === "movers" ? "No price moves recorded in the last 24h" : "No markets match these filters"}
              body={markets.length === 0 ? "Pull live markets from the venues to start exploring." : tab === "watchlist" ? "Tap the star next to any market to follow it here." : tab === "movers" ? "Moves appear once a market has been synced more than once within 24 hours." : "Try widening the filters."}
              action={markets.length === 0 ? <button className={btn.primary} onClick={() => onSync()}>Sync now</button> : undefined}
            />
          ) : (
            <>
              <TableWrap minWidth={1080}>
                <thead>
                  <tr>
                    <th className={`${th} w-10`}><span className="sr-only">Watch</span></th>
                    <th className={th}>Market</th>
                    <th className={th}>Venue</th>
                    <th className={th}>{sortBtn("yes", "YES")}</th>
                    <th className={th}>{sortBtn("no", "NO")}</th>
                    <th className={th}>Probability</th>
                    <th className={th}>{sortBtn("change", "24h")}</th>
                    <th className={`${th} text-right`}>{sortBtn("volume", "Volume", "right")}</th>
                    <th className={`${th} text-right`}>{sortBtn("liquidity", "Liquidity", "right")}</th>
                    <th className={th}>{sortBtn("close", "Closes")}</th>
                    <th className={th}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => {
                    const hex = venueColor(m.venue);
                    const watched = wl.ids.includes(m.id);
                    return (
                      <tr key={m.id} className={`${trow} cursor-pointer`} onClick={() => onOpenMarket(m.id)}>
                        <td className="pl-4">
                          <button
                            onClick={(e) => { e.stopPropagation(); wl.toggle(m.id); }}
                            aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
                            aria-pressed={watched}
                            className={`grid h-9 w-9 place-items-center rounded-lg ${watched ? "text-[var(--fd-amber-text)]" : "text-[var(--fd-text3)] hover:text-[var(--fd-strong)]"}`}
                          >
                            <Star size={17} fill={watched ? "currentColor" : "none"} />
                          </button>
                        </td>
                        <td className={`${td} max-w-[380px]`}>
                          <div className="truncate font-medium">{m.question}</div>
                          <div className="mt-0.5 flex items-center gap-2 text-[12.5px] text-[var(--fd-text3)]">
                            <span className="capitalize">{m.category}</span>
                            {m.ambiguityFlag && <Badge tone="amber">Flagged</Badge>}
                          </div>
                        </td>
                        <td className={td}><VenueTag venue={m.venue} /></td>
                        <td className={`${td} fd-num font-semibold text-[var(--fd-green-text)]`}>{m.yesPriceCents ?? "—"}¢</td>
                        <td className={`${td} fd-num text-[var(--fd-red-text)]`}>{m.noPriceCents ?? "—"}¢</td>
                        <td className={td}>{probabilityBar(m.yesPriceCents, hex)}</td>
                        <td className={td}>{change(m.change24hCents)}</td>
                        <td className={`${td} fd-num text-right text-[var(--fd-text-soft)]`}>{money(m.volumeCents, { compact: true })}</td>
                        <td className={`${td} fd-num text-right text-[var(--fd-text-soft)]`}>{money(m.liquidityCents, { compact: true })}</td>
                        <td className={`${td} whitespace-nowrap text-[var(--fd-text-soft)]`}>{m.closeDate ? shortDate(m.closeDate) : "—"}</td>
                        <td className={`${td} text-right`}>
                          <button
                            className={btn.small}
                            onClick={(e) => { e.stopPropagation(); onTrade(m); }}
                            disabled={m.ambiguityFlag}
                            title={m.ambiguityFlag ? "Resolution criteria flagged as ambiguous: trading blocked" : "Place a paper order"}
                          >
                            Trade
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--fd-line)] px-4 py-3 text-[13.5px] text-[var(--fd-text2)]">
                <span>
                  Showing <span className="fd-num text-[var(--fd-strong)]">{cur * PAGE + 1}–{Math.min(rows.length, cur * PAGE + PAGE)}</span> of <span className="fd-num text-[var(--fd-strong)]">{rows.length}</span>
                </span>
                <div className="flex items-center gap-2">
                  <button className={btn.small} disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</button>
                  <span className="fd-num">{cur + 1} / {pages}</span>
                  <button className={btn.small} disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button>
                </div>
              </div>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}

// ── Market detail ─────────────────────────────────────────────────────────
type DetailDTO = {
  market: MarketDTO & { resolutionSource: string | null; updatedAt: string; createdAt: string; resolvedAt: string | null };
  ticks: Array<{ yesCents: number; noCents: number; source: string; capturedAt: string }>;
  traces: Array<TraceDTO & { robot?: { id: string; name: string } }>;
  orders: OrderRowDTO[];
  positions: Array<{ id: string; side: string; sizeCents: number; avgPriceCents: number; status: string; openedAt: string; closedAt: string | null; robot?: { id: string; name: string } }>;
  related: Array<MarketDTO & { relation: string }>;
};

const RANGES = [
  { id: "1H", label: "1H", ms: 3600e3 },
  { id: "4H", label: "4H", ms: 4 * 3600e3 },
  { id: "1D", label: "1D", ms: 86400e3 },
  { id: "1W", label: "1W", ms: 7 * 86400e3 },
  { id: "1M", label: "1M", ms: 30 * 86400e3 },
  { id: "ALL", label: "ALL", ms: Infinity },
] as const;

export function MarketDetail(props: {
  marketId: string;
  dash: DashboardDTO | null;
  busy: string | null;
  onBack: () => void;
  onOpenMarket: (id: string) => void;
  onOpenRobot: (id: string) => void;
  onOpenVenue: (id: string) => void;
  onPlace: (p: unknown) => Promise<unknown> | void;
}) {
  const { marketId, busy, onBack, onOpenMarket, onOpenRobot, onOpenVenue, onPlace } = props;
  const [data, setData] = useState<DetailDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("ALL");
  const [tab, setTab] = useState("overview");

  const load = useMemo(
    () => async () => {
      try {
        const res = await fetch(`/api/markets/${marketId}`);
        const json = (await res.json()) as DetailDTO & { error?: string };
        if (!res.ok) setErr(json.error ?? "Could not load this market");
        else { setData(json); setErr(null); }
      } catch {
        setErr("Could not load this market");
      }
    },
    [marketId],
  );
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30000);
    return () => clearInterval(t);
  }, [load]);

  if (err) return <Panel><EmptyState title={err} action={<button className={btn.secondary} onClick={onBack}>Back to markets</button>} /></Panel>;
  if (!data) return <PageSkeleton />;

  const m = data.market;
  const def = VENUES.find((v) => v.id === m.venue);
  const hex = venueColor(m.venue);
  const venueLive = def?.adapter === "LIVE";
  const r = RANGES.find((x) => x.id === range)!;
  const cutoff = r.ms === Infinity ? 0 : Date.now() - r.ms;
  const series = data.ticks
    .filter((t) => new Date(t.capturedAt).getTime() >= cutoff)
    .map((t) => ({ x: new Date(t.capturedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), y: t.yesCents }));
  const first = series[0]?.y;
  const moveCents = first != null && m.yesPriceCents != null ? m.yesPriceCents - first : null;
  const closed = !!m.resolvedAt || (m.closeDate ? new Date(m.closeDate).getTime() < Date.now() : false);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={
          <button onClick={onBack} className="inline-flex items-center gap-1.5 hover:text-[var(--fd-strong)]"><ArrowLeft size={14} /> Markets</button>
        }
        title={<span className="block max-w-[900px] text-[24px] leading-snug sm:text-[26px]">{m.question}</span>}
        badges={
          <>
            <button onClick={() => onOpenVenue(m.venue)}><VenueTag venue={m.venue} /></button>
            <Badge tone="neutral"><span className="capitalize">{m.category}</span></Badge>
            {m.ambiguityFlag ? <Badge tone="amber" dot>Flagged: trading blocked</Badge> : closed ? <Badge tone="neutral" dot>Closed</Badge> : <Badge tone="green" dot>Open</Badge>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatBox label="Probability (YES)" value={m.yesPriceCents != null ? `${m.yesPriceCents}%` : "—"} hex={hex} sub={moveCents != null ? <>{change(moveCents)} <span className="text-[var(--fd-text3)]">· {range}</span></> : undefined} />
        <StatBox label="YES price" value={m.yesPriceCents != null ? `${m.yesPriceCents}¢` : "—"} tone="text-[var(--fd-green-text)]" />
        <StatBox label="NO price" value={m.noPriceCents != null ? `${m.noPriceCents}¢` : "—"} tone="text-[var(--fd-red-text)]" />
        <StatBox label="Volume" value={money(m.volumeCents, { compact: true })} />
        <StatBox label="Liquidity" value={money(m.liquidityCents, { compact: true })} />
        <StatBox label="Resolves" value={m.closeDate ? shortDate(m.closeDate) : "—"} sub={<span className="text-[var(--fd-text3)]">updated {ago(m.updatedAt)}</span>} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title="Probability history"
          subtitle={`${data.ticks.length} recorded price point${data.ticks.length === 1 ? "" : "s"} · source: venue syncs and robot cycles`}
          action={<Segmented label="Chart range" options={RANGES.map((x) => ({ id: x.id, label: x.label }))} value={range} onChange={setRange} />}
        >
          <AreaChart
            data={series}
            hex={hex}
            height={320}
            format={(v) => `${v}%`}
            domain={[0, 100]}
            emptyTitle="No price history in this range"
            emptyBody="Each venue sync and robot cycle records a price point. Sync again later or choose a wider range."
          />
        </Panel>
        <TradePanel market={m} venueLive={venueLive} closed={closed} busy={busy} onPlace={async (p) => { await onPlace(p); void load(); }} />
      </div>

      <Panel pad={false}>
        <div className="border-b border-[var(--fd-line)] p-3">
          <Tabs
            label="Market sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "overview", label: "Market Overview" },
              { id: "history", label: "Price History", count: data.ticks.length },
              { id: "book", label: "Order Book" },
              { id: "trades", label: "Recent Trades", count: data.orders.length },
              { id: "related", label: "Related Markets", count: data.related.length },
              { id: "ai", label: "AI Research", count: data.traces.filter((t) => t.modelEstimatePct != null).length },
              { id: "robots", label: "Robot Activity", count: data.traces.length },
            ]}
          />
        </div>
        <div className="p-5">
          {tab === "overview" && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-[15px] font-semibold text-[var(--fd-strong)]">Resolution</h3>
                <KV k="Resolution source" v={m.resolutionSource ?? <span className="text-[var(--fd-text3)]">Not provided by the venue</span>} />
                <KV k="Resolution date" v={m.closeDate ? new Date(m.closeDate).toUTCString().replace(" GMT", " UTC") : "—"} />
                <KV k="Ambiguity check" v={m.ambiguityFlag ? <Badge tone="amber">Flagged: trading blocked until reviewed</Badge> : <Badge tone="green">Clear</Badge>} />
                <KV k="Status" v={closed ? "Closed" : "Open for trading"} />
              </div>
              <div>
                <h3 className="mb-2 text-[15px] font-semibold text-[var(--fd-strong)]">Market data</h3>
                <KV k="Venue" v={def?.label ?? m.venue} />
                <KV k="Venue market id" v={m.venueSymbol} mono />
                <KV k="Data source" v={<Badge tone={m.dataSource.endsWith("_LIVE") || m.dataSource.endsWith("_SYNC") ? "cyan" : "amber"}>{m.dataSource.replace(/_/g, " ").toLowerCase()}</Badge>} />
                <KV k="Last updated" v={`${new Date(m.updatedAt).toUTCString().replace(" GMT", " UTC")}`} />
                <KV k="Taker fee (YES / NO)" v={`${m.yesTakerFeeBps ?? "—"} / ${m.noTakerFeeBps ?? "—"} bps`} mono />
                {m.eventKey && <KV k="Event cluster" v={m.eventKey} mono />}
              </div>
            </div>
          )}
          {tab === "history" && (
            data.ticks.length === 0 ? (
              <EmptyState compact title="No price points recorded yet" body="Price points are recorded on every venue sync and robot cycle." />
            ) : (
              <TableWrap minWidth={560}>
                <thead><tr><th className={th}>Captured (UTC)</th><th className={th}>YES</th><th className={th}>NO</th><th className={th}>Source</th></tr></thead>
                <tbody>
                  {[...data.ticks].reverse().slice(0, 200).map((t, i) => (
                    <tr key={i} className={trow}>
                      <td className={`${td} fd-num text-[var(--fd-text-soft)]`}>{new Date(t.capturedAt).toISOString().replace("T", " ").slice(0, 19)}</td>
                      <td className={`${td} fd-num text-[var(--fd-green-text)]`}>{t.yesCents}¢</td>
                      <td className={`${td} fd-num text-[var(--fd-red-text)]`}>{t.noCents}¢</td>
                      <td className={td}><Badge>{t.source.replace(/_/g, " ").toLowerCase()}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )
          )}
          {tab === "book" && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-[15px] font-semibold text-[var(--fd-strong)]">Top of book at last sync</h3>
                <KV k="YES best ask" v={m.yesPriceCents != null ? `${m.yesPriceCents}¢` : "—"} mono />
                <KV k="Depth at YES ask" v={m.yesTouchDepthCents != null ? money(m.yesTouchDepthCents) : "Not captured"} mono />
                <KV k="NO best ask" v={m.noPriceCents != null ? `${m.noPriceCents}¢` : "—"} mono />
                <KV k="Depth at NO ask" v={m.noTouchDepthCents != null ? money(m.noTouchDepthCents) : "Not captured"} mono />
              </div>
              <div className="rounded-2xl border border-dashed border-[var(--fd-border2)] p-5 text-[14px] leading-relaxed text-[var(--fd-text2)]">
                FAIDA stores the top of the book (best price and the notional available there) on each sync. That is what the risk engine
                checks before an entry. The full depth ladder is not streamed, so it isn&apos;t shown here.
              </div>
            </div>
          )}
          {tab === "trades" && (
            data.orders.length === 0 ? (
              <EmptyState compact title="No trades on this market yet" body="Your paper orders on this market appear here. Venue-wide public trades are not streamed." />
            ) : (
              <OrdersTable orders={data.orders} />
            )
          )}
          {tab === "related" && (
            data.related.length === 0 ? (
              <EmptyState compact title="No related markets found" />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {data.related.map((rm) => (
                  <button key={rm.id} onClick={() => onOpenMarket(rm.id)} className="flex items-center justify-between gap-4 rounded-xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] p-4 text-left transition-colors hover:border-[#2583FF]/50">
                    <span className="min-w-0">
                      <span className="block truncate text-[14.5px] font-medium text-[var(--fd-strong)]">{rm.question}</span>
                      <span className="mt-1 block text-[12.5px] text-[var(--fd-text3)]">{rm.relation === "SAME_EVENT" ? "Same event cluster" : `Same category · ${rm.category}`}</span>
                    </span>
                    <span className="fd-num shrink-0 rounded-lg bg-[#00D69A]/12 px-2.5 py-1 text-[14px] font-semibold text-[var(--fd-green-text)]">{rm.yesPriceCents ?? "—"}%</span>
                  </button>
                ))}
              </div>
            )
          )}
          {tab === "ai" && (
            data.traces.filter((t) => t.modelEstimatePct != null).length === 0 ? (
              <EmptyState compact title="No model estimates for this market yet" body="When a robot evaluates this market, its probability estimate, the model that produced it and the edge versus the market price are recorded here." />
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-[13.5px] text-[var(--fd-text2)]">Estimates are model outputs, not guarantees. They are shown next to the market price they were compared against.</p>
                {data.traces.filter((t) => t.modelEstimatePct != null).map((t) => (
                  <div key={t.id} className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] p-4 sm:grid-cols-5">
                    <div><div className="text-[12.5px] text-[var(--fd-text3)]">Model estimate</div><div className="fd-num text-[18px] font-semibold text-[var(--fd-purple-text)]">{t.modelEstimatePct?.toFixed(1)}%</div></div>
                    <div><div className="text-[12.5px] text-[var(--fd-text3)]">Market price</div><div className="fd-num text-[18px] font-semibold text-[var(--fd-strong)]">{t.marketPriceCents ?? "—"}¢</div></div>
                    <div><div className="text-[12.5px] text-[var(--fd-text3)]">Net edge</div><div className={`fd-num text-[18px] font-semibold ${(t.edgeNetPct ?? 0) > 0 ? "text-[var(--fd-green-text)]" : "text-[var(--fd-text2)]"}`}>{t.edgeNetPct != null ? `${t.edgeNetPct > 0 ? "+" : ""}${t.edgeNetPct.toFixed(1)} pts` : "—"}</div></div>
                    <div><div className="text-[12.5px] text-[var(--fd-text3)]">Model</div><div className="fd-num truncate text-[13.5px] text-[var(--fd-text-soft)]">{t.modelKey ?? "baseline"}</div></div>
                    <div><div className="text-[12.5px] text-[var(--fd-text3)]">When</div><div className="text-[13.5px] text-[var(--fd-text-soft)]">{ago(t.createdAt)}</div></div>
                  </div>
                ))}
              </div>
            )
          )}
          {tab === "robots" && (
            data.traces.length === 0 && data.positions.length === 0 ? (
              <EmptyState compact title="No robot activity on this market" body="Decisions your robots make about this market will be listed here with their reasons." />
            ) : (
              <div className="flex flex-col gap-2">
                {data.positions.filter((p) => p.status === "OPEN").map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#2583FF]/30 bg-[#2583FF]/[0.06] px-4 py-3 text-[14px]">
                    <Badge tone="blue">Open position</Badge>
                    <button className="font-semibold text-[var(--fd-strong)] hover:underline" onClick={() => p.robot && onOpenRobot(p.robot.id)}>{p.robot?.name ?? "Manual"}</button>
                    <span className="text-[var(--fd-text2)]">{p.side} · {money(p.sizeCents)} @ {p.avgPriceCents}¢</span>
                  </div>
                ))}
                {data.traces.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] px-4 py-3">
                    <span className="fd-num w-[86px] shrink-0 pt-0.5 text-[12.5px] text-[var(--fd-text3)]">{new Date(t.createdAt).toISOString().slice(11, 19)}</span>
                    {decisionBadge(t.decision)}
                    <button className="font-semibold text-[var(--fd-strong)] hover:underline" onClick={() => t.robot && onOpenRobot(t.robot.id)}>{t.robot?.name}</button>
                    <span className="min-w-[200px] flex-1 text-[14px] text-[var(--fd-text2)]">{t.reason}</span>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </Panel>
    </div>
  );
}

function StatBox({ label, value, sub, hex, tone }: { label: string; value: ReactNode; sub?: ReactNode; hex?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--fd-border)] bg-[var(--fd-surface)] p-4">
      <div className="text-[13px] text-[var(--fd-text2)]">{label}</div>
      <div className={`fd-num mt-1.5 text-[24px] font-semibold ${tone ?? "text-[var(--fd-strong)]"}`} style={hex ? { color: `color-mix(in srgb, ${hex} 70%, var(--fd-strong))` } : undefined}>{value}</div>
      {sub && <div className="mt-1 text-[13px]">{sub}</div>}
    </div>
  );
}

export function OrdersTable({ orders, onOpenMarket }: { orders: OrderRowDTO[]; onOpenMarket?: (id: string) => void }) {
  return (
    <TableWrap minWidth={820}>
      <thead>
        <tr>
          <th className={th}>Time (UTC)</th>
          <th className={th}>Market</th>
          <th className={th}>Side</th>
          <th className={`${th} text-right`}>Price</th>
          <th className={`${th} text-right`}>Size</th>
          <th className={`${th} text-right`}>Filled</th>
          <th className={`${th} text-right`}>Fee</th>
          <th className={th}>State</th>
          <th className={th}>Robot</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id} className={trow}>
            <td className={`${td} fd-num whitespace-nowrap text-[var(--fd-text-soft)]`}>{new Date(o.createdAt).toISOString().replace("T", " ").slice(5, 19)}</td>
            <td className={`${td} max-w-[300px]`}>
              {onOpenMarket ? (
                <button className="block w-full truncate text-left hover:underline" onClick={() => onOpenMarket(o.marketId)}>{o.market?.question ?? o.marketId}</button>
              ) : (
                <span className="block truncate">{o.market?.question ?? o.marketId}</span>
              )}
            </td>
            <td className={td}><Badge tone={o.side.includes("YES") ? "green" : "red"}>{o.side.replace("_", " ")}</Badge></td>
            <td className={`${td} fd-num text-right`}>{o.priceCents}¢</td>
            <td className={`${td} fd-num text-right`}>{money(o.sizeCents)}</td>
            <td className={`${td} fd-num text-right text-[var(--fd-text-soft)]`}>{money(o.filledCents)}</td>
            <td className={`${td} fd-num text-right text-[var(--fd-text-soft)]`}>{money(o.feeCents)}</td>
            <td className={td}>{orderStateBadge(o.state)}</td>
            <td className={`${td} text-[var(--fd-text-soft)]`}>{o.robot?.name ?? "Manual"}</td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

// ── trading panel (market detail) ─────────────────────────────────────────
function useTicket(market: MarketDTO) {
  const [side, setSide] = useState<"BUY_YES" | "BUY_NO">("BUY_YES");
  const [price, setPrice] = useState<number>(market.yesPriceCents ?? 50);
  const [sizeDollars, setSizeDollars] = useState("25");
  const sizeCents = Math.round(parseFloat(sizeDollars || "0") * 100);
  const valid = Number.isInteger(price) && price >= 1 && price <= 99 && Number.isInteger(sizeCents) && sizeCents > 0;
  const feeBps = side === "BUY_YES" ? market.yesTakerFeeBps : market.noTakerFeeBps;
  const feeCents = feeBps != null ? Math.round((sizeCents * feeBps) / 10000) : null;
  const shares = valid ? sizeCents / price : 0; // contracts paying $1 each
  const payoutCents = Math.round(shares * 100);
  const profitCents = payoutCents - sizeCents - (feeCents ?? 0);
  const pick = (s: "BUY_YES" | "BUY_NO") => { setSide(s); setPrice((s === "BUY_YES" ? market.yesPriceCents : market.noPriceCents) ?? 50); };
  return { side, pick, price, setPrice, sizeDollars, setSizeDollars, sizeCents, valid, feeBps, feeCents, shares, payoutCents, profitCents };
}

function TicketBody({ market, t, disabledReason, busy, onSubmit }: { market: MarketDTO; t: ReturnType<typeof useTicket>; disabledReason: string | null; busy: string | null; onSubmit: () => void }) {
  const sideBtn = (s: "BUY_YES" | "BUY_NO", label: string, price: number | null) => {
    const on = t.side === s;
    const yes = s === "BUY_YES";
    return (
      <button
        onClick={() => t.pick(s)}
        aria-pressed={on}
        className={`flex h-14 flex-col items-center justify-center rounded-xl border text-[15px] font-semibold transition-colors ${
          on ? (yes ? "border-[#00D69A] bg-[#00D69A]/15 text-[var(--fd-green-text)]" : "border-[#FF5268] bg-[#FF5268]/15 text-[var(--fd-red-text)]") : "border-[var(--fd-border2)] bg-[var(--fd-bg2)] text-[var(--fd-text2)] hover:text-[var(--fd-strong)]"
        }`}
      >
        {label}
        <span className="fd-num text-[13px] font-medium opacity-85">{price ?? "—"}¢</span>
      </button>
    );
  };
  const inp = "fd-num mt-1.5 h-11 w-full rounded-xl border border-[var(--fd-border2)] bg-[var(--fd-bg2)] px-3 text-[15px] text-[var(--fd-strong)]";
  const rr = t.sizeCents > 0 && t.profitCents > 0 ? (t.profitCents / t.sizeCents).toFixed(2) : "—";
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2.5">
        {sideBtn("BUY_YES", "Buy YES", market.yesPriceCents)}
        {sideBtn("BUY_NO", "Buy NO", market.noPriceCents)}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-[13px] text-[var(--fd-text2)]">
          Limit price (¢)
          <input type="number" min={1} max={99} value={t.price} onChange={(e) => t.setPrice(parseInt(e.target.value || "0", 10))} className={inp} />
        </label>
        <label className="text-[13px] text-[var(--fd-text2)]">
          Order size ($)
          <input inputMode="decimal" value={t.sizeDollars} onChange={(e) => t.setSizeDollars(e.target.value.replace(/[^0-9.]/g, ""))} className={inp} />
        </label>
      </div>
      <div className="flex gap-2">
        {[10, 25, 50, 100].map((v) => (
          <button key={v} onClick={() => t.setSizeDollars(String(v))} className="fd-num h-9 flex-1 rounded-lg border border-[var(--fd-border2)] bg-[var(--fd-bg2)] text-[13px] text-[var(--fd-text-soft)] hover:text-[var(--fd-strong)]">${v}</button>
        ))}
      </div>
      <div className="rounded-xl bg-[var(--fd-bg2)] p-4">
        <KV k="Estimated cost" v={money(t.sizeCents)} mono />
        <KV k="Fees" v={t.feeCents != null ? `${money(t.feeCents)} · ${t.feeBps} bps` : "Not reported by venue"} mono />
        <KV k="Contracts" v={t.shares ? t.shares.toFixed(2) : "—"} mono />
        <KV k="Payout if correct" v={t.valid ? money(t.payoutCents) : "—"} mono />
        <KV k="Potential profit" v={t.valid ? <span className={t.profitCents >= 0 ? "text-[var(--fd-green-text)]" : "text-[var(--fd-red-text)]"}>{money(t.profitCents, { sign: true })}</span> : "—"} mono />
        <KV k="Reward / risk" v={rr === "—" ? "—" : `${rr} : 1`} mono />
      </div>
      <button className={btn.primary + " h-12 text-[15.5px]"} disabled={!t.valid || busy !== null || !!disabledReason} onClick={onSubmit}>
        Place paper order
      </button>
      <p className="text-[12.5px] leading-relaxed text-[var(--fd-text3)]">
        {disabledReason ?? "Paper order: no real money moves. Eligibility and risk checks still apply; robot entries additionally need the edge gate."}
      </p>
    </div>
  );
}

// The venue's structural entry rules (minimum book depth, close window), checked
// before submitting so the ticket explains a refusal up front. The risk engine
// still enforces them server-side; this only mirrors the same rule for clarity.
function structuralBlock(market: MarketDTO, side: "BUY_YES" | "BUY_NO"): string | null {
  const rules = VENUE_ENTRY_RULES[market.venue] ?? EMPTY_ENTRY_RULES;
  const depth = side === "BUY_YES" ? market.yesTouchDepthCents : market.noTouchDepthCents;
  if (rules.minTouchDepthCents != null && (depth == null || depth < rules.minTouchDepthCents)) {
    return `The order book is too thin: ${depth != null ? money(depth) : "no depth"} available at the best price, and this venue requires at least ${money(rules.minTouchDepthCents)}.`;
  }
  if (rules.minMinutesBeforeClose != null && market.closeDate && new Date(market.closeDate).getTime() - Date.now() < rules.minMinutesBeforeClose * 60_000) {
    return `New entries stop ${rules.minMinutesBeforeClose} minutes before this market closes.`;
  }
  return null;
}

function TradePanel({ market, venueLive, closed, busy, onPlace }: { market: MarketDTO; venueLive: boolean; closed: boolean; busy: string | null; onPlace: (p: unknown) => Promise<void> }) {
  const t = useTicket(market);
  const disabledReason = market.ambiguityFlag
    ? "Trading is blocked: the resolution criteria were flagged as ambiguous."
    : !venueLive
      ? "This venue's adapter is not live, so orders can't be placed here."
      : closed
        ? "This market is closed."
        : structuralBlock(market, t.side);
  return (
    <Panel title="Trade" subtitle="Manual paper order" action={<Badge tone="amber" dot>Paper</Badge>}>
      <TicketBody
        market={market}
        t={t}
        disabledReason={disabledReason}
        busy={busy}
        onSubmit={() => void onPlace({ marketId: market.id, side: t.side, priceCents: t.price, sizeCents: t.sizeCents, nonce: crypto.randomUUID() })}
      />
    </Panel>
  );
}

// ── quick-trade dialog (from tables) ──────────────────────────────────────
export function TradeDialog({ market, onClose, onPlace, busy }: { market: MarketDTO | null; onClose: () => void; onPlace: (p: unknown) => void; busy: string | null }) {
  if (!market) return null;
  return <TradeDialogInner market={market} onClose={onClose} onPlace={onPlace} busy={busy} />;
}

function TradeDialogInner({ market, onClose, onPlace, busy }: { market: MarketDTO; onClose: () => void; onPlace: (p: unknown) => void; busy: string | null }) {
  const t = useTicket(market);
  const def = VENUES.find((v) => v.id === market.venue);
  const disabledReason = market.ambiguityFlag
    ? "Trading is blocked: the resolution criteria were flagged as ambiguous."
    : def?.adapter !== "LIVE"
      ? "This venue's adapter is not live, so orders can't be placed here."
      : structuralBlock(market, t.side);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-[var(--fd-border2)] bg-[var(--fd-surface)] text-[var(--fd-text)] sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">Paper order</DialogTitle>
          <DialogDescription className="text-[14px] text-[var(--fd-text2)]">{market.question}</DialogDescription>
        </DialogHeader>
        <div className="-mt-1 flex items-center gap-2"><VenueTag venue={market.venue} /><Badge tone="amber" dot>Paper</Badge></div>
        <TicketBody
          market={market}
          t={t}
          disabledReason={disabledReason}
          busy={busy}
          onSubmit={() => { onPlace({ marketId: market.id, side: t.side, priceCents: t.price, sizeCents: t.sizeCents, nonce: crypto.randomUUID() }); onClose(); }}
        />
      </DialogContent>
    </Dialog>
  );
}
