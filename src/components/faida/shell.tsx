"use client";

// FAIDA Predict — application shell: collapsible sidebar (grouped navigation,
// venue shortcuts, mode / robots / health / emergency pause), top bar (global
// search, mode, connection, notifications, profile), mobile bottom navigation
// with a "More" drawer, and the ⌘K search palette. The shell only navigates
// and displays state; every action still goes through the existing APIs.

import { useEffect, useMemo, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  BarChart3, Bell, Bot, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, CircleUser, Compass, Gauge, HelpCircle, Home,
  LogOut, Palette, PieChart, Search, Settings, ShieldCheck, Sparkles, Users, Wallet,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { DashboardDTO, MarketDTO } from "./types";
import { VENUES, venueColor } from "@/lib/venues";
import { ago, Badge, money } from "./ds";
import { PersonalizeButton } from "./personalize";
import { systemStatus } from "./status";

export type View =
  | "overview" | "venue" | "markets" | "market" | "studio" | "robots" | "robot"
  | "trading" | "analytics" | "intel" | "risk" | "settings" | "beta" | "help";

export type Nav = { view: View; tab?: string };

export type OperatingMode = "PAPER" | "LIVE" | "RESTRICTED" | "PAUSED";

type NavItem = { id: string; label: string; hint: string; icon: (size: number) => ReactNode; to: Nav };

// FAIDA Predict's own information architecture, built around the five jobs a
// prediction-market trader comes to do:
//   Home      — my profits, my venues, my robots, what just happened
//   Markets   — find events worth betting on (venues live inside)
//   Robots    — create, watch and tune robots (templates + tests inside)
//   Portfolio — my positions, orders, history and performance
//   Insights  — why: AI probability vs market price, every robot decision
// Safety and Settings are visited occasionally, so they sit apart at the
// bottom of the sidebar (and behind the status chip / avatar on mobile).
export const NAV: NavItem[] = [
  { id: "overview", label: "Home", hint: "Your profits, venues and robots at a glance", icon: (s) => <Home size={s} />, to: { view: "overview" } },
  { id: "markets", label: "Markets", hint: "Find events on every venue", icon: (s) => <Compass size={s} />, to: { view: "markets", tab: "trending" } },
  { id: "robots", label: "Robots", hint: "Create, watch and tune", icon: (s) => <Bot size={s} />, to: { view: "robots" } },
  { id: "trading", label: "Portfolio", hint: "Positions, history, performance", icon: (s) => <PieChart size={s} />, to: { view: "trading", tab: "positions" } },
  { id: "intel", label: "Insights", hint: "AI odds and robot decisions", icon: (s) => <Sparkles size={s} />, to: { view: "intel", tab: "record" } },
];

export const NAV_FOOT: Array<NavItem & { operatorOnly?: boolean }> = [
  { id: "risk", label: "Safety", hint: "System check, limits, emergency stop", icon: (s) => <ShieldCheck size={s} />, to: { view: "risk", tab: "check" } },
  { id: "help", label: "Help", hint: "Which markets you can use, and how", icon: (s) => <HelpCircle size={s} />, to: { view: "help" } },
  { id: "settings", label: "Settings", hint: "Account, wallet, AI, alerts", icon: (s) => <Settings size={s} />, to: { view: "settings", tab: "general" } },
  { id: "beta", label: "Beta ops", hint: "Tester cohort and feedback", icon: (s) => <Users size={s} />, to: { view: "beta" }, operatorOnly: true },
];

// which section a view belongs to (for highlighting)
export function groupOf(view: View): string {
  if (view === "venue" || view === "market") return "markets";
  if (view === "robot" || view === "studio") return "robots";
  if (view === "analytics") return "trading";
  return view;
}

export const MODE_META: Record<OperatingMode, { label: string; tone: string; hex: string; desc: string }> = {
  PAPER: { label: "Practice money", tone: "amber", hex: "#FFB547", desc: "Paper mode: simulated orders only. No real money moves." },
  RESTRICTED: { label: "Live (test sends)", tone: "purple", hex: "#9B7BFF", desc: "Live pilot enabled, but orders are not sent until you arm it." },
  LIVE: { label: "Real money", tone: "red", hex: "#FF5268", desc: "Real orders are being sent within your pilot limits." },
  PAUSED: { label: "Emergency stop", tone: "red", hex: "#FF5268", desc: "All robots and new orders are stopped." },
};

// ── Sidebar ───────────────────────────────────────────────────────────────
export function Sidebar(props: {
  nav: Nav;
  onNavigate: (n: Nav) => void;
  dash: DashboardDTO | null;
  mode: OperatingMode;
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  inDrawer?: boolean;
  isOperator?: boolean;
  onOpenVenue?: (id: string) => void;
}) {
  const { nav, onNavigate, dash, mode, collapsed, onToggleCollapsed, inDrawer, isOperator, onOpenVenue } = props;
  const active = groupOf(nav.view);
  const st = systemStatus(dash);
  const mm = MODE_META[mode];
  const dot = st.tone === "green" ? "#00D69A" : st.tone === "red" ? "#FF5268" : "#FFB547";

  const item = (g: NavItem) => {
    const on = active === g.id;
    const isSafety = g.id === "risk";
    const btn = (
      <button
        onClick={() => onNavigate(g.to)}
        aria-current={on ? "page" : undefined}
        className={`group flex w-full items-center gap-3 rounded-2xl text-left text-[15px] font-medium transition-colors ${collapsed ? "h-12 justify-center" : "h-12 px-3.5"} ${
          on ? "bg-[color:var(--fd-ink)]/[0.09] text-[var(--fd-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-[var(--fd-text2)] hover:bg-[color:var(--fd-ink)]/[0.04] hover:text-[var(--fd-strong)]"
        }`}
      >
        <span className={`relative ${on ? "text-[var(--fd-brand-text)]" : "text-[var(--fd-text3)] group-hover:text-[var(--fd-text-soft)]"}`}>
          {g.icon(19)}
          {isSafety && collapsed && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full" style={{ background: dot }} aria-hidden />}
        </span>
        {!collapsed && <span className="flex-1 truncate">{g.label}</span>}
        {!collapsed && isSafety && (
          <span className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: st.tone === "green" ? "var(--fd-green-text)" : st.tone === "red" ? "var(--fd-red-text)" : "var(--fd-amber-text)" }}>
            <span className="h-2 w-2 rounded-full" style={{ background: dot }} aria-hidden />
            {st.ok ? "OK" : st.issues.length}
          </span>
        )}
      </button>
    );
    return (
      <li key={g.id}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{btn}</TooltipTrigger>
            <TooltipContent side="right">{g.label} · {isSafety ? st.label : g.hint}</TooltipContent>
          </Tooltip>
        ) : btn}
      </li>
    );
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className={`flex h-full flex-col ${collapsed ? "px-2.5" : "px-3.5"} py-4`}>
        <div className={`mb-6 flex items-center ${collapsed ? "justify-center" : "justify-between px-1.5"}`}>
          <button onClick={() => onNavigate({ view: "overview" })} className="flex items-center gap-2.5" aria-label="FAIDA Predict home">
            <Image src="/brand/logo_mark.png" alt="" width={34} height={34} className="object-contain" />
            {!collapsed && (
              <span className="leading-tight">
                <span className="block text-[17px] font-bold tracking-wide text-[var(--fd-strong)]">FAIDA</span>
                <span className="block text-[12px] font-bold tracking-[0.22em] text-[var(--fd-blue-text)]">PREDICT</span>
              </span>
            )}
          </button>
          {!collapsed && !inDrawer && onToggleCollapsed && (
            <button onClick={onToggleCollapsed} className="rounded-lg p-1.5 text-[var(--fd-text3)] hover:bg-[color:var(--fd-ink)]/[0.05] hover:text-[var(--fd-strong)]" aria-label="Collapse sidebar">
              <ChevronsLeft size={18} />
            </button>
          )}
        </div>

        <nav aria-label="Main" className="fd-scroll -mx-1 flex-1 overflow-y-auto px-1">
          <ul className="flex flex-col gap-1">{NAV.map(item)}</ul>

          <div className="mt-5">
            {!collapsed && <div className="mb-1.5 px-3.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-[var(--fd-text3)]">Venues</div>}
            <ul className="flex flex-col gap-0.5">
              {VENUES.map((v) => {
                const live = v.adapter === "LIVE";
                const stat = dash?.venues.find((x) => x.venue === v.id);
                const on = nav.view === "venue" && nav.tab === v.id;
                const btn = (
                  <button
                    onClick={() => onOpenVenue?.(v.id)}
                    aria-current={on ? "page" : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl text-left transition-colors ${collapsed ? "h-10 justify-center" : "h-10 px-3.5"} ${on ? "bg-[color:var(--fd-ink)]/[0.08]" : "hover:bg-[color:var(--fd-ink)]/[0.04]"}`}
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold" style={{ background: `color-mix(in srgb, ${v.hex} ${live ? 24 : 10}%, transparent)`, color: live ? v.hex : `color-mix(in srgb, ${v.hex} 50%, var(--fd-text3))` }} aria-hidden>
                      {v.label.slice(0, 1)}
                    </span>
                    {!collapsed && (
                      <>
                        <span className={`flex-1 truncate text-[14px] ${live ? "text-[var(--fd-text-soft)]" : "text-[var(--fd-text3)]"}`}>{v.label}</span>
                        <span className="fd-num text-[12px] text-[var(--fd-text3)]">{live ? (stat?.markets ?? 0) : v.id === "DRIFT_BET" ? "off" : "soon"}</span>
                      </>
                    )}
                  </button>
                );
                return (
                  <li key={v.id}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{btn}</TooltipTrigger>
                        <TooltipContent side="right">{v.label} · {live ? `${stat?.markets ?? 0} markets` : v.id === "DRIFT_BET" ? "Suspended" : "Coming soon"}</TooltipContent>
                      </Tooltip>
                    ) : btn}
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>

        <ul className="mt-3 flex flex-col gap-1 border-t border-[var(--fd-line)] pt-3">{NAV_FOOT.filter((g) => !g.operatorOnly || isOperator).map(item)}</ul>

        <div className="mt-3 flex flex-col gap-2.5">
          {collapsed ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => onNavigate({ view: "settings", tab: "modes" })} className="mx-auto grid h-10 w-10 place-items-center rounded-xl hover:bg-[color:var(--fd-ink)]/[0.05]" aria-label={mm.label}>
                    <span className="h-3 w-3 rounded-full" style={{ background: mm.hex }} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{mm.label}</TooltipContent>
              </Tooltip>
              {onToggleCollapsed && (
                <button onClick={onToggleCollapsed} className="grid h-9 place-items-center rounded-lg text-[var(--fd-text3)] hover:bg-[color:var(--fd-ink)]/[0.05] hover:text-[var(--fd-strong)]" aria-label="Expand sidebar">
                  <ChevronsRight size={18} />
                </button>
              )}
            </>
          ) : (
            <button onClick={() => onNavigate({ view: "settings", tab: "modes" })} className="rounded-2xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] p-3.5 text-left transition-colors hover:border-[var(--fd-border2)]" title={mm.desc}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] text-[var(--fd-text3)]">Trading with</span>
                <ChevronRight size={15} className="text-[var(--fd-text3)]" />
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[14.5px] font-semibold text-[var(--fd-strong)]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: mm.hex }} aria-hidden />
                {mm.label}
              </div>
              <div className="mt-1 text-[12.5px] leading-snug text-[var(--fd-text2)]">{mode === "PAPER" ? "No real money moves." : mm.desc}</div>
            </button>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

// status chip: one tap to the system check (like the forex app's header chip)
export function StatusChip({ dash, onNavigate, className = "inline-flex" }: { dash: DashboardDTO | null; onNavigate: (n: Nav) => void; className?: string }) {
  const st = systemStatus(dash);
  const color = st.tone === "green" ? "var(--fd-green-text)" : st.tone === "red" ? "var(--fd-red-text)" : "var(--fd-amber-text)";
  return (
    <button
      onClick={() => onNavigate({ view: "risk", tab: "check" })}
      className={`items-center gap-2 whitespace-nowrap rounded-full border border-[var(--fd-border)] bg-[var(--fd-bg2)] px-3 py-1.5 text-[13px] font-semibold transition-colors hover:border-[var(--fd-border2)] ${className}`}
      style={{ color }}
      title="Open system check"
    >
      <span aria-hidden>{st.ok ? "✓" : "!"}</span>
      <span className="text-[var(--fd-text)]">{st.label}</span>
      <ChevronRight size={14} className="text-[var(--fd-text3)]" />
    </button>
  );
}

// ── Top bar ───────────────────────────────────────────────────────────────
export function TopBar(props: {
  dash: DashboardDTO | null;
  mode: OperatingMode;
  me: { email: string; role: string; name: string | null; via?: string } | null;
  onOpenSearch: () => void;
  onNavigate: (n: Nav) => void;
  onSignOut: () => void;
}) {
  const { dash, mode, me, onOpenSearch, onNavigate, onSignOut } = props;
  const mm = MODE_META[mode];
  const notes = dash?.notifications ?? [];
  const alerts = dash?.openAlerts ?? 0;
  const initials = (me?.name ?? me?.email ?? "?").split(/[\s@.]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");

  return (
    <div className="sticky top-0 z-20 flex h-[72px] items-center gap-3 px-3 sm:px-6 lg:px-8 [background:linear-gradient(to_bottom,color-mix(in_srgb,var(--fd-bg)_55%,transparent),transparent)] [backdrop-filter:blur(14px)] [-webkit-backdrop-filter:blur(14px)] [mask-image:linear-gradient(to_bottom,black_75%,transparent)]">
      <button onClick={() => onNavigate({ view: "overview" })} className="grid h-10 w-10 shrink-0 place-items-center md:hidden" aria-label="FAIDA Predict home">
        <Image src="/brand/logo_mark.png" alt="" width={30} height={30} className="object-contain" />
      </button>
      <button onClick={onOpenSearch} className="grid h-10 w-10 place-items-center rounded-xl text-[var(--fd-text-soft)] hover:bg-[color:var(--fd-ink)]/[0.05] sm:hidden" aria-label="Search">
        <Search size={19} />
      </button>
      <button
        onClick={onOpenSearch}
        className="hidden h-11 min-w-0 flex-1 items-center gap-3 rounded-full border border-[var(--fd-border)] bg-[var(--fd-bg2)] px-4 text-left text-[14.5px] text-[var(--fd-text3)] transition-colors hover:border-[var(--fd-border2)] sm:flex sm:max-w-[420px]"
        aria-label="Search markets, robots and pages"
      >
        <Search size={17} />
        <span className="flex-1 truncate">Search markets, robots, pages…</span>
        <kbd className="hidden rounded-md border border-[var(--fd-border2)] px-1.5 py-0.5 text-[12px] text-[var(--fd-text2)] sm:inline">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <span
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[13.5px] font-semibold ring-1 ring-inset"
          style={{ color: `color-mix(in srgb, ${mm.hex} 72%, var(--fd-strong))`, background: `color-mix(in srgb, ${mm.hex} 12%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${mm.hex} 35%, transparent)` }}
          title={mm.desc}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: mm.hex }} aria-hidden />
          <span className="hidden sm:inline">{mm.label}</span>
          <span className="sm:hidden">{mode === "PAPER" ? "Practice" : mode === "PAUSED" ? "Stopped" : mode === "LIVE" ? "Real" : "Live test"}</span>
        </span>

        <StatusChip dash={dash} onNavigate={onNavigate} className="hidden lg:inline-flex" />

        <Popover>
          <PopoverTrigger asChild>
            <button className="relative grid h-10 w-10 place-items-center rounded-xl text-[var(--fd-text-soft)] hover:bg-[color:var(--fd-ink)]/[0.05]" aria-label={`Notifications${alerts ? `, ${alerts} alerts` : ""}`}>
              <Bell size={19} />
              {alerts > 0 && (
                <span className="fd-num absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#FF5268] px-1 text-[11px] font-bold text-white">{alerts}</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="fd-glass-strong w-[360px] rounded-2xl border-[var(--fd-border2)] p-0 text-[var(--fd-text)]">
            <div className="border-b border-[var(--fd-border)] px-4 py-3 text-[15px] font-semibold">Notifications</div>
            <div className="fd-scroll max-h-[380px] overflow-y-auto">
              {notes.length === 0 ? (
                <div className="px-4 py-8 text-center text-[14px] text-[var(--fd-text2)]">You&apos;re all caught up.</div>
              ) : (
                notes.map((n) => (
                  <div key={n.id} className="border-b border-[var(--fd-line)] px-4 py-3 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${n.severity === "CRITICAL" ? "bg-[#FF5268]" : n.severity === "WARNING" ? "bg-[#FFB547]" : "bg-[#2583FF]"}`} aria-hidden />
                      <span className="flex-1 text-[14px] font-medium">{n.title}</span>
                      <span className="text-[12px] text-[var(--fd-text3)]">{ago(n.createdAt)}</span>
                    </div>
                    <p className="ml-4 mt-1 text-[13px] leading-snug text-[var(--fd-text2)]">{n.body}</p>
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <span className="hidden sm:block"><PersonalizeButton /></span>

        <SafetyButton dash={dash} onNavigate={onNavigate} />

        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-[color:var(--fd-ink)]/[0.05]" aria-label="Account menu">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#2583FF] to-[#9B7BFF] text-[13px] font-bold text-white">{initials || <CircleUser size={18} />}</span>
              <ChevronDown size={15} className="hidden text-[var(--fd-text3)] sm:block" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="fd-glass-strong w-[280px] rounded-2xl border-[var(--fd-border2)] p-0 text-[var(--fd-text)]">
            <div className="border-b border-[var(--fd-border)] px-4 py-3">
              <div className="truncate text-[14.5px] font-semibold">{me?.name ?? "Account"}</div>
              <div className="fd-num truncate text-[12.5px] text-[var(--fd-text2)]">{me?.email ?? "—"}</div>
              <div className="mt-2 flex gap-2">
                {me?.role && <Badge tone={me.role === "OPERATOR" ? "blue" : "green"}>{me.role.toLowerCase()}</Badge>}
                {me?.via === "FOUNDER_FALLBACK" && <Badge tone="amber">not signed in</Badge>}
              </div>
            </div>
            <div className="p-1.5">
              {dash?.wallet && (
                <div className="flex items-center gap-2.5 px-3 py-2 text-[13.5px] text-[var(--fd-text2)]">
                  <Wallet size={16} /> <span className="fd-num">{dash.wallet.address.slice(0, 6)}…{dash.wallet.address.slice(-4)}</span>
                </div>
              )}
              {me?.via === "FOUNDER_FALLBACK" && (
                <Link href="/login" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] hover:bg-[color:var(--fd-ink)]/[0.05]">
                  <CircleUser size={16} /> Sign in
                </Link>
              )}
              <button onClick={() => onNavigate({ view: "settings", tab: "general" })} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] hover:bg-[color:var(--fd-ink)]/[0.05]">
                <Settings size={16} /> Settings
              </button>
              <button onClick={() => onNavigate({ view: "settings", tab: "general" })} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] hover:bg-[color:var(--fd-ink)]/[0.05] sm:hidden">
                <Palette size={16} /> Theme & colours
              </button>
              <button onClick={() => onNavigate({ view: "help" })} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] hover:bg-[color:var(--fd-ink)]/[0.05]">
                <HelpCircle size={16} /> Help: where can I trade?
              </button>
              <button onClick={onSignOut} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] hover:bg-[color:var(--fd-ink)]/[0.05]">
                <LogOut size={16} /> Sign out
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

// mobile-only: the sidebar's Safety entry, as a shield with the status dot
function SafetyButton({ dash, onNavigate }: { dash: DashboardDTO | null; onNavigate: (n: Nav) => void }) {
  const st = systemStatus(dash);
  const dot = st.tone === "green" ? "#00D69A" : st.tone === "red" ? "#FF5268" : "#FFB547";
  return (
    <button onClick={() => onNavigate({ view: "risk", tab: "check" })} className="relative grid h-10 w-10 place-items-center rounded-xl text-[var(--fd-text-soft)] hover:bg-[color:var(--fd-ink)]/[0.05] md:hidden" aria-label={`Safety: ${st.label}`}>
      <ShieldCheck size={19} />
      <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--fd-bg)]" style={{ background: dot }} aria-hidden />
    </button>
  );
}

// ── Mobile bottom navigation ──────────────────────────────────────────────
export function MobileNav({ nav, onNavigate }: { nav: Nav; onNavigate: (n: Nav) => void }) {
  const g = groupOf(nav.view);
  return (
    <nav aria-label="Primary mobile navigation" className="fd-safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-2.5 pb-3 md:hidden">
      <div className="fd-glass-strong pointer-events-auto flex w-full max-w-[560px] rounded-[28px] border border-[var(--fd-border2)] px-1">
        {NAV.map((it) => {
          const lit = g === it.id;
          return (
            <button
              key={it.id}
              onClick={() => onNavigate(it.to)}
              aria-current={lit ? "page" : undefined}
              className={`relative flex min-h-[62px] min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${lit ? "text-[var(--fd-brand-text)]" : "text-[var(--fd-text2)]"}`}
            >
              {lit && <span className="absolute top-0 h-[3px] w-7 rounded-b-full bg-[var(--fd-brand-text)]" aria-hidden />}
              {it.icon(20)}
              <span className="max-w-full truncate px-0.5">{it.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

const SEARCH_SHORTCUTS: Array<{ label: string; to: Nav }> = [
  { label: "Create a new robot", to: { view: "studio" } },
  { label: "Help › Which markets can I use in my country?", to: { view: "help" } },
  { label: "Robots › Ready-made robots", to: { view: "robots", tab: "ready" } },
  { label: "Robots › Test & tune", to: { view: "robots", tab: "lab" } },
  { label: "Markets › Watchlist", to: { view: "markets", tab: "watchlist" } },
  { label: "Markets › Price gaps between venues", to: { view: "markets", tab: "gaps" } },
  { label: "Portfolio › Performance", to: { view: "trading", tab: "performance" } },
  { label: "Portfolio › Money history", to: { view: "trading", tab: "ledger" } },
  { label: "Portfolio › Orders that need attention", to: { view: "trading", tab: "execution" } },
  { label: "Insights › Track record & AI accuracy", to: { view: "intel", tab: "record" } },
  { label: "Ask FAIDA: what are the chances…?", to: { view: "intel", tab: "ask" } },
  { label: "Insights › Activity log", to: { view: "intel", tab: "decisions" } },
  { label: "Safety › System check", to: { view: "risk", tab: "check" } },
  { label: "Safety › Emergency stop", to: { view: "risk", tab: "stop" } },
  { label: "Safety › Change history", to: { view: "risk", tab: "audit" } },
  { label: "Settings › Alerts & notifications", to: { view: "settings", tab: "notifications" } },
  { label: "Settings › Wallet", to: { view: "settings", tab: "custody" } },
  { label: "Settings › AI providers", to: { view: "settings", tab: "ai" } },
];

// ── Global search (⌘K) ────────────────────────────────────────────────────
export function SearchPalette(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dash: DashboardDTO | null;
  markets: MarketDTO[];
  onNavigate: (n: Nav) => void;
  onOpenMarket: (id: string) => void;
  onOpenRobot: (id: string) => void;
  onOpenVenue: (id: string) => void;
}) {
  const { open, onOpenChange, dash, markets, onNavigate, onOpenMarket, onOpenRobot, onOpenVenue } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const pages = useMemo(
    () => [...NAV, ...NAV_FOOT.filter((g) => !g.operatorOnly)].map((g) => ({ label: g.label, to: g.to })).concat(SEARCH_SHORTCUTS),
    [],
  );
  const go = (fn: () => void) => { fn(); onOpenChange(false); };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Search markets, robots, venues, orders and pages">
      <CommandInput placeholder="Search markets, robots, venues, orders…" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>No results.</CommandEmpty>
        {(dash?.robots.length ?? 0) > 0 && (
          <CommandGroup heading="Robots">
            {dash!.robots.map((r) => (
              <CommandItem key={r.id} value={`robot ${r.name} ${r.venue} ${r.family}`} onSelect={() => go(() => onOpenRobot(r.id))}>
                <Bot size={16} /> <span className="flex-1">{r.name}</span>
                <span className="text-[12px] text-[var(--fd-text3)]">{VENUES.find((v) => v.id === r.venue)?.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {markets.length > 0 && (
          <CommandGroup heading="Markets">
            {markets.slice(0, 80).map((m) => (
              <CommandItem key={m.id} value={`market ${m.question} ${m.category} ${m.venue}`} onSelect={() => go(() => onOpenMarket(m.id))}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: venueColor(m.venue) }} aria-hidden />
                <span className="flex-1 truncate">{m.question}</span>
                <span className="fd-num text-[12px] text-[var(--fd-text2)]">{m.yesPriceCents ?? "—"}¢</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Venues">
          {VENUES.map((v) => (
            <CommandItem key={v.id} value={`venue ${v.label}`} onSelect={() => go(() => onOpenVenue(v.id))}>
              <span className="h-2 w-2 rounded-full" style={{ background: v.hex }} aria-hidden /> {v.label}
              <span className="ml-auto text-[12px] text-[var(--fd-text3)]">{v.adapter === "LIVE" ? "Live" : v.id === "DRIFT_BET" ? "Suspended" : "Coming soon"}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {(dash?.orders.length ?? 0) > 0 && (
          <CommandGroup heading="Recent orders">
            {dash!.orders.slice(0, 8).map((o) => (
              <CommandItem key={o.id} value={`order ${o.id} ${o.market?.question ?? ""} ${o.state}`} onSelect={() => go(() => onNavigate({ view: "trading", tab: "orders" }))}>
                <BarChart3 size={16} /> <span className="flex-1 truncate">{o.market?.question ?? o.marketId}</span>
                <span className="fd-num text-[12px] text-[var(--fd-text2)]">{money(o.sizeCents)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Pages">
          {pages.map((p) => (
            <CommandItem key={p.label} value={`page ${p.label}`} onSelect={() => go(() => onNavigate(p.to))}>
              <Gauge size={16} /> {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
