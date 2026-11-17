"use client";

// Shared brand primitives for the FAIDA Predict UI.
import type { CSSProperties, ReactNode } from "react";
import { VENUES, VENUE_COLOR, VENUE_LABEL, venueColor } from "@/lib/venues";

export const c = {
  bg: "bg-[#0A0F1C]",
  surface: "bg-[#0F1523]",
  elevated: "bg-[#151D30]",
  border: "border-[#202B45]",
  borderStrong: "border-[#2E3C5F]",
  text: "text-[#E9EEF7]",
  text2: "text-[#9AA8C0]",
  text3: "text-[#64748E]",
  accent: "text-[#3E9BF0]",
  bright: "text-[#00B0F0]",
  gain: "text-[#2FC08E]",
  loss: "text-[#F0525F]",
  warn: "text-[#E3A63B]",
  ai: "text-[#8B7CF6]",
  paper: "text-[#D9B25C]",
};

export const card = `${c.surface} border ${c.border} rounded-xl`;
export const mono = "font-mono tabular-nums";

// B12: scope helper — set the venue accent (--vc) on any surface. Pair with the
// vc-* classes in globals.css (vc-chip, vc-strip, vc-tint, venue-card, …).
export function venueScopeStyle(venue: string): CSSProperties {
  return { "--vc": venueColor(venue) } as CSSProperties;
}

export function fmtCents(v: number): string {
  const sign = v < 0 ? "-" : "";
  return `${sign}$${(Math.abs(v) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// B11 + B12: venue chip — every market, order, robot and ticket states which
// venue it belongs to, in that venue's own color. Live venues render the full
// hue; pending venues render the same hue muted toward slate.
export function VenueBadge({ venue, withLabel = true }: { venue: string; withLabel?: boolean }) {
  const def = VENUES.find((v) => v.id === venue);
  const live = def?.adapter === "LIVE";
  return (
    <span
      title={def ? `${def.label} — ${def.note}` : venue}
      style={venueScopeStyle(venue)}
      className={`vc-scope inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide whitespace-nowrap vc-chip ${
        live ? "" : "vc-pending"
      }`}
    >
      <span className="opacity-80">{def?.short ?? "??"}</span>
      {withLabel ? <span>{VENUE_LABEL[venue] ?? venue}</span> : null}
      {!live && <span className="opacity-70">PENDING</span>}
    </span>
  );
}

export function StateChip({ state }: { state: string }) {
  const map: Record<string, string> = {
    FILLED: `${c.gain} bg-[#2FC08E]/10`,
    OPEN: `${c.bright} bg-[#00B0F0]/10`,
    PARTIALLY_FILLED: `${c.bright} bg-[#00B0F0]/10`,
    SUBMITTED: `${c.accent} bg-[#3E9BF0]/10`,
    VALIDATED: `${c.accent} bg-[#3E9BF0]/10`,
    CREATED: c.text3 + " bg-[#151D30]",
    CANCELLED: c.text3 + " bg-[#151D30]",
    REJECTED: `${c.loss} bg-[#F0525F]/10`,
    EXPIRED: c.text3 + " bg-[#151D30]",
    RECONCILING: `${c.warn} bg-[#E3A63B]/10`,
    UNKNOWN: `${c.warn} bg-[#E3A63B]/10`,
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold tracking-wide ${map[state] ?? c.text2}`}>
      {state === "UNKNOWN" || state === "RECONCILING" ? "⚠ " : ""}
      {state.replace("_", " ")}
    </span>
  );
}

export function Pill({ status }: { status: string }) {
  const map: Record<string, string> = {
    RUNNING: `${c.bright} bg-[#00B0F0]/10 border-[#00B0F0]/30`,
    PAPER_ONLY: `${c.paper} bg-[#D9B25C]/10 border-[#D9B25C]/30`,
    PAUSED_BY_USER: `${c.warn} bg-[#E3A63B]/10 border-[#E3A63B]/30`,
    PAUSED_BY_RISK: `${c.warn} bg-[#E3A63B]/10 border-[#E3A63B]/30`,
    PAUSED_BY_AI_BUDGET: `${c.ai} bg-[#8B7CF6]/10 border-[#8B7CF6]/30`,
    ERROR: `${c.loss} bg-[#F0525F]/10 border-[#F0525F]/30`,
    STOPPED: c.text3 + " bg-[#151D30] border-[#2E3C5F]",
  };
  const glyph: Record<string, string> = {
    RUNNING: "●", PAPER_ONLY: "◇", PAUSED_BY_USER: "‖", PAUSED_BY_RISK: "‖",
    PAUSED_BY_AI_BUDGET: "‖", ERROR: "✕", STOPPED: "■",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wide ${map[status] ?? c.text2}`}>
      {glyph[status] ?? "•"} {status.replace("PAUSED_BY_", "PAUSED BY ").replace("_", " ")}
    </span>
  );
}

export function Meter({ label, pct, detail, tone = "accent" }: { label: string; pct: number; detail: string; tone?: "accent" | "warn" | "ai" }) {
  const fill = tone === "warn" ? "bg-[#E3A63B]" : tone === "ai" ? "bg-[#8B7CF6]" : "bg-[#3E9BF0]";
  return (
    <div>
      <div className={`flex justify-between text-[11px] ${c.text2}`}>
        <span>{label}</span>
        <span className={mono}>{Math.round(pct)}%</span>
      </div>
      <div className="mt-1 h-1.5 rounded bg-[#151D30]">
        <div className={`h-full rounded ${fill}`} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
      </div>
      <div className={`mt-1 text-[10px] ${c.text3}`}>{detail}</div>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className={`text-[13px] font-semibold tracking-wide ${c.text}`}>{children}</h2>
      {right}
    </div>
  );
}
