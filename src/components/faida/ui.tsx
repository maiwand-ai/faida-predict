"use client";

// Shared brand primitives for the FAIDA Predict UI.
import type { CSSProperties, ReactNode } from "react";
import { VENUES, VENUE_LABEL, venueColor } from "@/lib/venues";

export const c = {
  bg: "bg-[#080B12]",
  surface: "bg-[#111827]",
  elevated: "bg-[#161F2D]",
  border: "border-[#1E2A3D]",
  borderStrong: "border-[#253247]",
  text: "text-[#E8EDF5]",
  text2: "text-[#9AA6B8]",
  text3: "text-[#7C889B]",
  accent: "text-[#2583FF]",
  bright: "text-[#08D9E8]",
  gain: "text-[#00D69A]",
  loss: "text-[#FF5268]",
  warn: "text-[#FFB547]",
  ai: "text-[#9B7BFF]",
  paper: "text-[#FFB547]",
};

export const card = `${c.surface} border ${c.border} rounded-2xl`;
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
      className={`vc-scope inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide whitespace-nowrap vc-chip ${
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
    FILLED: `${c.gain} bg-[#00D69A]/10`,
    OPEN: `${c.bright} bg-[#2583FF]/10`,
    PARTIALLY_FILLED: `${c.bright} bg-[#2583FF]/10`,
    SUBMITTED: `${c.accent} bg-[#2583FF]/10`,
    VALIDATED: `${c.accent} bg-[#2583FF]/10`,
    CREATED: c.text3 + " bg-[#161F2D]",
    CANCELLED: c.text3 + " bg-[#161F2D]",
    REJECTED: `${c.loss} bg-[#FF5268]/10`,
    EXPIRED: c.text3 + " bg-[#161F2D]",
    RECONCILING: `${c.warn} bg-[#FFB547]/10`,
    UNKNOWN: `${c.warn} bg-[#FFB547]/10`,
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[12px] font-bold tracking-wide ${map[state] ?? c.text2}`}>
      {state === "UNKNOWN" || state === "RECONCILING" ? "⚠ " : ""}
      {state.replace("_", " ")}
    </span>
  );
}

export function Pill({ status }: { status: string }) {
  const map: Record<string, string> = {
    RUNNING: `${c.bright} bg-[#2583FF]/10 border-[#2583FF]/30`,
    PAPER_ONLY: `${c.paper} bg-[#FFB547]/10 border-[#FFB547]/30`,
    PAUSED_BY_USER: `${c.warn} bg-[#FFB547]/10 border-[#FFB547]/30`,
    PAUSED_BY_RISK: `${c.warn} bg-[#FFB547]/10 border-[#FFB547]/30`,
    PAUSED_BY_AI_BUDGET: `${c.ai} bg-[#8B7CF6]/10 border-[#8B7CF6]/30`,
    ERROR: `${c.loss} bg-[#FF5268]/10 border-[#FF5268]/30`,
    STOPPED: c.text3 + " bg-[#161F2D] border-[#253247]",
  };
  const glyph: Record<string, string> = {
    RUNNING: "●", PAPER_ONLY: "◇", PAUSED_BY_USER: "‖", PAUSED_BY_RISK: "‖",
    PAUSED_BY_AI_BUDGET: "‖", ERROR: "✕", STOPPED: "■",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-bold tracking-wide ${map[status] ?? c.text2}`}>
      {glyph[status] ?? "•"} {status.replace("PAUSED_BY_", "PAUSED BY ").replace("_", " ")}
    </span>
  );
}

export function Meter({ label, pct, detail, tone = "accent" }: { label: string; pct: number; detail: string; tone?: "accent" | "warn" | "ai" }) {
  const fill = tone === "warn" ? "bg-[#FFB547]" : tone === "ai" ? "bg-[#8B7CF6]" : "bg-[#2583FF]";
  return (
    <div>
      <div className={`flex justify-between text-[13px] ${c.text2}`}>
        <span>{label}</span>
        <span className={mono}>{Math.round(pct)}%</span>
      </div>
      <div className="mt-1 h-1.5 rounded bg-[#161F2D]">
        <div className={`h-full rounded ${fill}`} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
      </div>
      <div className={`mt-1 text-[12px] ${c.text3}`}>{detail}</div>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className={`text-[15px] font-semibold tracking-wide ${c.text}`}>{children}</h2>
      {right}
    </div>
  );
}
