"use client";

// FAIDA Predict design system — shared building blocks for every page.
// Pages compose these instead of styling ad hoc, so the whole product reads
// as one system: same surfaces, spacing, type scale, badges, tables, charts.
// Charts only ever render real application data; with too few points they
// show an honest empty state instead of a decorative line.

import { useId, type CSSProperties, type ReactNode } from "react";
import { Area, AreaChart as RAreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Inbox } from "lucide-react";
import { VENUES, venueColor } from "@/lib/venues";

export const T = {
  bg: "#080B12",
  bg2: "#0D121C",
  card: "#111827",
  elevated: "#161F2D",
  border: "#1E2A3D",
  borderStrong: "#253247",
  text: "#E8EDF5",
  text2: "#9AA6B8",
  text3: "#7C889B",
  blue: "#2583FF",
  cyan: "#08D9E8",
  green: "#00D69A",
  amber: "#FFB547",
  red: "#FF5268",
  purple: "#9B7BFF",
} as const;

export const num = "fd-num";

// ── formatting ────────────────────────────────────────────────────────────
export function money(cents: number | null | undefined, opts: { sign?: boolean; compact?: boolean } = {}): string {
  if (cents == null || Number.isNaN(cents)) return "—";
  const v = cents / 100;
  const sign = v < 0 ? "-" : opts.sign && v > 0 ? "+" : "";
  const abs = Math.abs(v);
  if (opts.compact && abs >= 1000) {
    const units: Array<[number, string]> = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
    for (const [d, u] of units) if (abs >= d) return `${sign}$${(abs / d).toFixed(abs / d >= 100 ? 0 : 1)}${u}`;
  }
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function pct(v: number | null | undefined, digits = 1, sign = false): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${sign && v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function toneOf(v: number | null | undefined): "gain" | "loss" | "flat" {
  if (v == null || v === 0) return "flat";
  return v > 0 ? "gain" : "loss";
}

export const toneText: Record<string, string> = {
  gain: "text-[#00D69A]",
  loss: "text-[#FF5268]",
  flat: "text-[#9AA6B8]",
};

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function utcTime(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19) + " UTC";
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── surfaces ──────────────────────────────────────────────────────────────
export function Panel(props: {
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  pad?: boolean;
  style?: CSSProperties;
}) {
  const { title, icon, action, subtitle, children, className = "", bodyClassName = "", pad = true, style } = props;
  return (
    <section className={`min-w-0 rounded-2xl border border-[#1E2A3D] bg-[#111827] ${className}`} style={style}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && <span className="text-[#2583FF]" aria-hidden>{icon}</span>}
            <div className="min-w-0">
              {title && <h2 className="truncate text-[17px] font-semibold text-[#E8EDF5]">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-[13px] text-[#7C889B]">{subtitle}</p>}
            </div>
          </div>
          {action}
        </header>
      )}
      <div className={`${pad ? "p-5" : ""} ${title && pad ? "pt-4" : ""} ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function PageHeader(props: { icon?: ReactNode; iconHex?: string; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: ReactNode; badges?: ReactNode }) {
  const { icon, iconHex = T.blue, title, subtitle, actions, crumbs, badges } = props;
  return (
    <div className="flex flex-col gap-3">
      {crumbs && <nav aria-label="Breadcrumb" className="text-[13px] text-[#7C889B]">{crumbs}</nav>}
      <div className="flex flex-wrap items-center gap-4">
        {icon && (
          <span
            aria-hidden
            className="hidden h-12 w-12 shrink-0 place-items-center rounded-2xl sm:grid"
            style={{ background: `color-mix(in srgb, ${iconHex} 16%, transparent)`, color: iconHex, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${iconHex} 35%, transparent)` }}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[26px] font-bold tracking-tight text-white sm:text-[28px]">{title}</h1>
            {badges}
          </div>
          {subtitle && <p className="mt-1 text-[15px] text-[#9AA6B8]">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
      </div>
    </div>
  );
}

export function IconTile({ hex = T.blue, children, size = 40 }: { hex?: string; children: ReactNode; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-xl"
      style={{ width: size, height: size, background: `color-mix(in srgb, ${hex} 16%, transparent)`, color: hex }}
    >
      {children}
    </span>
  );
}

// ── metrics ───────────────────────────────────────────────────────────────
export function Metric(props: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "gain" | "loss" | "flat" | "text";
  icon?: ReactNode;
  hex?: string;
  spark?: number[];
  title?: string;
}) {
  const { label, value, sub, tone = "text", icon, hex = T.blue, spark, title } = props;
  const color = tone === "text" ? "text-white" : toneText[tone];
  return (
    <div className="relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-2xl border border-[#1E2A3D] bg-[#111827] p-4" title={title}>
      <div className="flex items-center gap-2.5">
        {icon && <IconTile hex={hex} size={34}>{icon}</IconTile>}
        <span className="text-[13.5px] font-medium text-[#9AA6B8]">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={`fd-num truncate text-[19px] font-semibold leading-tight sm:text-[24px] ${color}`}>{value}</div>
          {sub && <div className="mt-1 text-[13px] text-[#7C889B]">{sub}</div>}
        </div>
        {spark && spark.length >= 2 && <Sparkline values={spark} hex={hex} />}
      </div>
    </div>
  );
}

export function Sparkline({ values, hex = T.blue, w = 96, h = 36 }: { values: number[]; hex?: string; w?: number; h?: number }) {
  const id = useId();
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={hex} stopOpacity="0.35" />
          <stop offset="1" stopColor={hex} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${w} ${h} L0 ${h} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={hex} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── badges ────────────────────────────────────────────────────────────────
const badgeTone: Record<string, string> = {
  green: "bg-[#00D69A]/12 text-[#3BE6B0] ring-[#00D69A]/25",
  amber: "bg-[#FFB547]/12 text-[#FFC266] ring-[#FFB547]/25",
  red: "bg-[#FF5268]/12 text-[#FF7A8B] ring-[#FF5268]/25",
  blue: "bg-[#2583FF]/14 text-[#6AA9FF] ring-[#2583FF]/30",
  cyan: "bg-[#08D9E8]/12 text-[#4FE6F0] ring-[#08D9E8]/25",
  purple: "bg-[#9B7BFF]/14 text-[#B9A2FF] ring-[#9B7BFF]/30",
  neutral: "bg-white/[0.05] text-[#B4BECC] ring-white/10",
};

export function Badge({ tone = "neutral", dot, children, title }: { tone?: keyof typeof badgeTone | string; dot?: boolean; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12.5px] font-semibold ring-1 ring-inset ${badgeTone[tone] ?? badgeTone.neutral}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

// robot / order status → badge tone + plain-language label
export function robotStatusBadge(status: string) {
  const map: Record<string, [string, string]> = {
    RUNNING: ["green", "Running"],
    PAPER_ONLY: ["blue", "Paper trading"],
    PAUSED_BY_USER: ["amber", "Paused"],
    PAUSED_BY_RISK: ["red", "Paused by risk"],
    PAUSED_BY_AI_BUDGET: ["purple", "Paused: AI budget"],
    ERROR: ["red", "Error"],
    STOPPED: ["neutral", "Stopped"],
  };
  const [tone, label] = map[status] ?? ["neutral", status.replace(/_/g, " ").toLowerCase()];
  return <Badge tone={tone} dot>{label}</Badge>;
}

export function orderStateBadge(state: string) {
  const map: Record<string, string> = {
    FILLED: "green", OPEN: "blue", PARTIALLY_FILLED: "blue", SUBMITTED: "blue", VALIDATED: "blue",
    CREATED: "neutral", CANCELLED: "neutral", EXPIRED: "neutral", REJECTED: "red", RECONCILING: "amber", UNKNOWN: "amber",
  };
  return <Badge tone={map[state] ?? "neutral"}>{state.replace(/_/g, " ").toLowerCase()}</Badge>;
}

export function decisionBadge(decision: string) {
  const d = decision.toUpperCase();
  const tone = d.includes("NO_TRADE") || d.includes("SKIP") || d.includes("HOLD") ? "neutral" : d.includes("EXIT") || d.includes("CLOSE") ? "amber" : d.includes("REFUSE") || d.includes("BLOCK") ? "red" : "green";
  return <Badge tone={tone}>{decision.replace(/_/g, " ")}</Badge>;
}

export function VenueTag({ venue }: { venue: string }) {
  const def = VENUES.find((v) => v.id === venue);
  const hex = venueColor(venue);
  const live = def?.adapter === "LIVE";
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12.5px] font-semibold"
      style={{ background: `color-mix(in srgb, ${hex} ${live ? 15 : 8}%, transparent)`, color: live ? hex : `color-mix(in srgb, ${hex} 55%, #9AA6B8)` }}
      title={def?.label ?? venue}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: hex, opacity: live ? 1 : 0.5 }} aria-hidden />
      {def?.label ?? venue}
    </span>
  );
}

// ── tabs ──────────────────────────────────────────────────────────────────
export function Tabs<T extends string>({ tabs, value, onChange, size = "md", label }: {
  tabs: Array<{ id: T; label: string; count?: number | string; disabled?: boolean }>;
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="fd-scroll -mx-1 flex gap-1 overflow-x-auto px-1">
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            className={`relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              size === "sm" ? "px-3 py-1.5 text-[13.5px]" : "px-4 py-2.5 text-[14.5px]"
            } ${on ? "bg-[#2583FF]/15 text-white ring-1 ring-inset ring-[#2583FF]/40" : "text-[#9AA6B8] hover:bg-white/[0.04] hover:text-white"}`}
          >
            {t.label}
            {t.count != null && (
              <span className={`fd-num rounded-md px-1.5 py-0.5 text-[11.5px] ${on ? "bg-[#2583FF]/25 text-white" : "bg-white/[0.06] text-[#9AA6B8]"}`}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl bg-[#0D121C] p-1 ring-1 ring-inset ring-[#1E2A3D]">
      {options.map((o) => (
        <button
          key={o.id}
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${o.id === value ? "bg-[#2583FF] text-white" : "text-[#9AA6B8] hover:text-white"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── states ────────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, body, action, compact }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "gap-2 py-8" : "gap-3 py-14"}`}>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.04] text-[#7C889B]" aria-hidden>
        {icon ?? <Inbox size={22} />}
      </span>
      <div className="text-[16px] font-semibold text-[#E8EDF5]">{title}</div>
      {body && <div className="max-w-md text-[14px] leading-relaxed text-[#9AA6B8]">{body}</div>}
      {action}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-[#161F2D] ${className}`} />;
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-12 w-72" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      <Skeleton className="h-80" />
    </div>
  );
}

// ── tables ────────────────────────────────────────────────────────────────
export const th = "px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wider text-[#7C889B] whitespace-nowrap";
export const td = "px-4 py-3.5 text-[14px] text-[#E8EDF5]";
export const trow = "border-t border-[#1A2333] transition-colors hover:bg-white/[0.025]";

export function TableWrap({ children, minWidth = 720 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="fd-scroll overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth }}>{children}</table>
    </div>
  );
}

// ── buttons ───────────────────────────────────────────────────────────────
export const btn = {
  primary: "inline-flex items-center justify-center gap-2 rounded-xl bg-[#2583FF] px-4 h-11 text-[14.5px] font-semibold text-white transition-colors hover:bg-[#3D92FF] disabled:cursor-not-allowed disabled:opacity-45",
  secondary: "inline-flex items-center justify-center gap-2 rounded-xl border border-[#253247] bg-[#161F2D] px-4 h-11 text-[14.5px] font-medium text-[#E8EDF5] transition-colors hover:bg-[#1C2740] disabled:cursor-not-allowed disabled:opacity-45",
  ghost: "inline-flex items-center justify-center gap-2 rounded-xl px-3 h-10 text-[14px] font-medium text-[#9AA6B8] transition-colors hover:bg-white/[0.05] hover:text-white disabled:opacity-45",
  danger: "inline-flex items-center justify-center gap-2 rounded-xl border border-[#FF5268]/45 bg-[#FF5268]/10 px-4 h-11 text-[14.5px] font-semibold text-[#FF7A8B] transition-colors hover:bg-[#FF5268]/18 disabled:cursor-not-allowed disabled:opacity-45",
  small: "inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#253247] bg-[#161F2D] px-3 h-9 text-[13px] font-medium text-[#E8EDF5] transition-colors hover:bg-[#1C2740] disabled:cursor-not-allowed disabled:opacity-45",
};

// ── progress ──────────────────────────────────────────────────────────────
export function Bar({ value, max = 100, hex = T.blue, warnAt, label }: { value: number; max?: number; hex?: string; warnAt?: number; label?: string }) {
  const p = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const color = warnAt != null && p >= warnAt ? (p >= 95 ? T.red : T.amber) : hex;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(p, value > 0 ? 2 : 0)}%`, background: color }} />
    </div>
  );
}

// ── charts (real data only) ───────────────────────────────────────────────
export function AreaChart(props: {
  data: Array<{ x: string; y: number }>;
  hex?: string;
  height?: number;
  format?: (v: number) => string;
  emptyTitle?: string;
  emptyBody?: ReactNode;
  domain?: [number | "auto", number | "auto"];
}) {
  const { data, hex = T.blue, height = 260, format = (v) => String(v), emptyTitle = "Not enough data yet", emptyBody, domain } = props;
  const gid = useId().replace(/:/g, "");
  if (data.length < 2) {
    return (
      <div style={{ height }} className="grid place-items-center">
        <EmptyState compact title={emptyTitle} body={emptyBody} />
      </div>
    );
  }
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RAreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={hex} stopOpacity={0.35} />
              <stop offset="100%" stopColor={hex} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1A2333" vertical={false} />
          <XAxis dataKey="x" tick={{ fill: T.text3, fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={36} />
          <YAxis tick={{ fill: T.text3, fontSize: 12 }} tickLine={false} axisLine={false} width={64} tickFormatter={format} domain={domain ?? ["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: T.elevated, border: `1px solid ${T.borderStrong}`, borderRadius: 12, color: T.text, fontSize: 13 }}
            labelStyle={{ color: T.text2 }}
            formatter={(v: number) => [format(v), ""]}
            separator=""
          />
          <Area type="monotone" dataKey="y" stroke={hex} strokeWidth={2.5} fill={`url(#${gid})`} isAnimationActive={false} />
        </RAreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Donut({ segments, center, size = 180 }: { segments: Array<{ label: string; value: number; hex: string }>; center?: ReactNode; size?: number }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total <= 0) {
    return (
      <div className="grid place-items-center rounded-full border-[14px] border-white/[0.05]" style={{ width: size, height: size }}>
        <span className="px-4 text-center text-[13px] text-[#7C889B]">Nothing allocated</span>
      </div>
    );
  }
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={segments} dataKey="value" nameKey="label" innerRadius="70%" outerRadius="100%" paddingAngle={segments.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
            {segments.map((s) => <Cell key={s.label} fill={s.hex} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {center && <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">{center}</div>}
    </div>
  );
}

export function LegendRow({ hex, label, value, sub }: { hex: string; label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: hex }} aria-hidden />
        <span className="truncate text-[14px] text-[#C9D2DE]">{label}</span>
      </span>
      <span className="text-right">
        <span className="fd-num text-[14px] font-semibold text-white">{value}</span>
        {sub && <span className="ml-2 text-[12.5px] text-[#7C889B]">{sub}</span>}
      </span>
    </div>
  );
}

export function KV({ k, v, mono }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-[#1A2333] py-2.5 first:border-t-0">
      <span className="shrink-0 text-[14px] text-[#9AA6B8]">{k}</span>
      <span className={`text-right text-[14px] text-[#E8EDF5] ${mono ? "fd-num" : ""}`}>{v}</span>
    </div>
  );
}
