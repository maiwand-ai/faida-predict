"use client";

// FAIDA Predict — application shell: collapsible sidebar (grouped navigation,
// venue shortcuts, mode / robots / health / emergency pause), top bar (global
// search, mode, connection, notifications, profile), mobile bottom navigation
// with a "More" drawer, and the ⌘K search palette. The shell only navigates
// and displays state; every action still goes through the existing APIs.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Activity, BarChart3, Bell, Bot, Brain, ChevronDown, ChevronsLeft, ChevronsRight, CircleUser, Compass, Gauge, Home,
  LayoutDashboard, LineChart, LogOut, Menu, MoreHorizontal, PauseCircle, Search, Settings, ShieldCheck, Users, Wallet,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { DashboardDTO, MarketDTO } from "./types";
import { VENUES, venueColor } from "@/lib/venues";
import { ago, Badge, money } from "./ds";

export type View =
  | "overview" | "venue" | "markets" | "market" | "studio" | "robots" | "robot"
  | "trading" | "analytics" | "intel" | "risk" | "settings" | "beta";

export type Nav = { view: View; tab?: string };

export type OperatingMode = "PAPER" | "LIVE" | "RESTRICTED" | "PAUSED";

type NavChild = { label: string; to: Nav };
type NavGroup = { id: string; label: string; icon: ReactNode; to: Nav; children?: NavChild[]; operatorOnly?: boolean };

const ICON = 18;
export const NAV: NavGroup[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard size={ICON} />, to: { view: "overview" } },
  {
    id: "markets", label: "Markets", icon: <Compass size={ICON} />, to: { view: "markets", tab: "trending" },
    children: [
      { label: "Market Discovery", to: { view: "markets", tab: "trending" } },
      { label: "All Markets", to: { view: "markets", tab: "all" } },
      { label: "Watchlist", to: { view: "markets", tab: "watchlist" } },
      { label: "Categories", to: { view: "markets", tab: "categories" } },
    ],
  },
  {
    id: "studio", label: "Robot Studio", icon: <Bot size={ICON} />, to: { view: "studio" },
    children: [
      { label: "Create Robot", to: { view: "studio" } },
      { label: "My Robots", to: { view: "robots" } },
      { label: "Strategy Library", to: { view: "studio", tab: "library" } },
    ],
  },
  {
    id: "trading", label: "Trading", icon: <LineChart size={ICON} />, to: { view: "trading", tab: "positions" },
    children: [
      { label: "Positions", to: { view: "trading", tab: "positions" } },
      { label: "Orders", to: { view: "trading", tab: "orders" } },
      { label: "Order History", to: { view: "trading", tab: "history" } },
      { label: "Execution Monitor", to: { view: "trading", tab: "execution" } },
    ],
  },
  {
    id: "intel", label: "Intelligence", icon: <Brain size={ICON} />, to: { view: "intel", tab: "research" },
    children: [
      { label: "AI Research", to: { view: "intel", tab: "research" } },
      { label: "Market Intelligence", to: { view: "intel", tab: "markets" } },
      { label: "Decision Feed", to: { view: "intel", tab: "decisions" } },
      { label: "Analytics", to: { view: "analytics" } },
    ],
  },
  {
    id: "risk", label: "Risk & Operations", icon: <ShieldCheck size={ICON} />, to: { view: "risk", tab: "overview" },
    children: [
      { label: "Risk Center", to: { view: "risk", tab: "overview" } },
      { label: "Exposure Monitor", to: { view: "risk", tab: "exposure" } },
      { label: "System Health", to: { view: "risk", tab: "health" } },
      { label: "Audit Log", to: { view: "risk", tab: "audit" } },
    ],
  },
  { id: "beta", label: "Beta Ops", icon: <Users size={ICON} />, to: { view: "beta" }, operatorOnly: true },
  { id: "settings", label: "Settings", icon: <Settings size={ICON} />, to: { view: "settings", tab: "general" } },
];

// which top-level group a view belongs to (for highlighting)
export function groupOf(view: View): string {
  if (view === "venue") return "overview";
  if (view === "market") return "markets";
  if (view === "robot" || view === "robots") return "studio";
  if (view === "analytics") return "intel";
  return view;
}

export const MODE_META: Record<OperatingMode, { label: string; tone: string; hex: string; desc: string }> = {
  PAPER: { label: "Paper Mode", tone: "amber", hex: "#FFB547", desc: "Simulated orders only. No real money moves." },
  RESTRICTED: { label: "Restricted", tone: "purple", hex: "#9B7BFF", desc: "Live pilot enabled, sends stay dry-run until armed." },
  LIVE: { label: "Live Mode", tone: "red", hex: "#FF5268", desc: "Real orders are being sent within pilot ceilings." },
  PAUSED: { label: "Emergency Pause", tone: "red", hex: "#FF5268", desc: "All robot cycles and new orders are stopped." },
};

function venueStatus(id: string, adapter: string): string {
  if (adapter === "LIVE") return "Live";
  return id === "DRIFT_BET" ? "Suspended" : "Coming soon";
}

// ── Sidebar ───────────────────────────────────────────────────────────────
export function Sidebar(props: {
  nav: Nav;
  onNavigate: (n: Nav) => void;
  onOpenVenue: (venueId: string) => void;
  dash: DashboardDTO | null;
  mode: OperatingMode;
  isOperator: boolean;
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onPause: () => void;
  busy: boolean;
  inDrawer?: boolean;
}) {
  const { nav, onNavigate, onOpenVenue, dash, mode, isOperator, collapsed, onToggleCollapsed, onPause, busy, inDrawer } = props;
  const activeGroup = groupOf(nav.view);
  const [open, setOpen] = useState<Record<string, boolean>>({ [activeGroup]: true });
  const running = dash?.robots.filter((r) => r.status === "RUNNING" || r.status === "PAPER_ONLY").length ?? 0;
  const total = dash?.robots.length ?? 0;
  const paused = dash?.control?.pause.paused ?? false;
  const healthy = !!dash && !paused && (dash.outboxPending ?? 0) === 0;
  const mm = MODE_META[mode];

  const item = (g: NavGroup) => {
    const on = activeGroup === g.id;
    const expanded = open[g.id] ?? on;
    const btnCls = `group flex w-full items-center gap-3 rounded-xl text-left text-[15px] font-medium transition-colors ${
      collapsed ? "h-11 justify-center" : "h-11 px-3"
    } ${on ? "bg-[#2583FF]/14 text-white" : "text-[#9AA6B8] hover:bg-white/[0.04] hover:text-white"}`;
    const main = (
      <button
        className={btnCls}
        aria-current={on && !g.children ? "page" : undefined}
        aria-expanded={g.children && !collapsed ? expanded : undefined}
        onClick={() => {
          if (g.children && !collapsed) {
            setOpen((o) => ({ ...o, [g.id]: !expanded }));
            if (!on) onNavigate(g.to);
          } else onNavigate(g.to);
        }}
      >
        <span className={on ? "text-[#2583FF]" : "text-[#7C889B] group-hover:text-[#C9D2DE]"}>{g.icon}</span>
        {!collapsed && <span className="flex-1 truncate">{g.label}</span>}
        {!collapsed && g.children && <ChevronDown size={16} className={`text-[#7C889B] transition-transform ${expanded ? "rotate-180" : ""}`} />}
      </button>
    );
    return (
      <li key={g.id}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{main}</TooltipTrigger>
            <TooltipContent side="right">{g.label}</TooltipContent>
          </Tooltip>
        ) : (
          main
        )}
        {!collapsed && g.children && expanded && (
          <ul className="mb-1 ml-[22px] mt-1 flex flex-col gap-0.5 border-l border-[#1E2A3D] pl-3">
            {g.children.map((ch) => {
              const childOn = nav.view === ch.to.view && (ch.to.tab == null || nav.tab === ch.to.tab);
              return (
                <li key={ch.label}>
                  <button
                    onClick={() => onNavigate(ch.to)}
                    aria-current={childOn ? "page" : undefined}
                    className={`flex h-9 w-full items-center rounded-lg px-3 text-left text-[14px] transition-colors ${
                      childOn ? "bg-white/[0.06] font-semibold text-white" : "text-[#9AA6B8] hover:bg-white/[0.04] hover:text-white"
                    }`}
                  >
                    {ch.label}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className={`flex h-full flex-col ${collapsed ? "px-2.5" : "px-3.5"} py-4`}>
        <div className={`mb-5 flex items-center ${collapsed ? "justify-center" : "justify-between px-1.5"}`}>
          <button onClick={() => onNavigate({ view: "overview" })} className="flex items-center gap-2.5" aria-label="FAIDA Predict home">
            <Image src="/brand/logo_mark.png" alt="" width={34} height={34} className="object-contain" />
            {!collapsed && (
              <span className="leading-tight">
                <span className="block text-[17px] font-bold tracking-wide text-white">FAIDA</span>
                <span className="block text-[12px] font-bold tracking-[0.22em] text-[#2583FF]">PREDICT</span>
              </span>
            )}
          </button>
          {!collapsed && !inDrawer && onToggleCollapsed && (
            <button onClick={onToggleCollapsed} className="rounded-lg p-1.5 text-[#7C889B] hover:bg-white/[0.05] hover:text-white" aria-label="Collapse sidebar">
              <ChevronsLeft size={18} />
            </button>
          )}
        </div>

        <nav aria-label="Main" className="fd-scroll -mx-1 flex-1 overflow-y-auto px-1">
          <ul className="flex flex-col gap-1">{NAV.filter((g) => !g.operatorOnly || isOperator).map(item)}</ul>

          <div className="mt-6">
            {!collapsed && <div className="mb-2 px-3 text-[11.5px] font-bold uppercase tracking-[0.16em] text-[#7C889B]">Venues</div>}
            <ul className="flex flex-col gap-0.5">
              {VENUES.map((v) => {
                const live = v.adapter === "LIVE";
                const st = dash?.venues.find((s) => s.venue === v.id);
                const on = nav.view === "venue" && (nav.tab === v.id);
                const content = (
                  <button
                    onClick={() => onOpenVenue(v.id)}
                    aria-label={`${v.label} workspace, ${venueStatus(v.id, v.adapter)}`}
                    className={`flex w-full items-center gap-3 rounded-xl text-left transition-colors ${collapsed ? "h-10 justify-center" : "h-10 px-3"} ${
                      on ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <span className="relative grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold" style={{ background: `color-mix(in srgb, ${v.hex} ${live ? 22 : 10}%, transparent)`, color: live ? v.hex : `color-mix(in srgb, ${v.hex} 55%, #7C889B)` }}>
                      {v.label.slice(0, 1)}
                      <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-[#0D121C]" style={{ background: live ? "#00D69A" : v.id === "DRIFT_BET" ? "#FF5268" : "#FFB547" }} />
                    </span>
                    {!collapsed && (
                      <>
                        <span className={`flex-1 truncate text-[14.5px] ${live ? "text-[#E8EDF5]" : "text-[#7C889B]"}`}>{v.label}</span>
                        {live && (st?.markets ?? 0) > 0 ? (
                          <span className="fd-num text-[12px] text-[#7C889B]">{st?.markets}</span>
                        ) : (
                          <span className="text-[11.5px] text-[#7C889B]">{venueStatus(v.id, v.adapter)}</span>
                        )}
                      </>
                    )}
                  </button>
                );
                return (
                  <li key={v.id}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{content}</TooltipTrigger>
                        <TooltipContent side="right">{v.label} · {venueStatus(v.id, v.adapter)}</TooltipContent>
                      </Tooltip>
                    ) : content}
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>

        <div className="mt-4 flex flex-col gap-2.5">
          {collapsed ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="mx-auto h-3 w-3 rounded-full" style={{ background: mm.hex }} aria-label={mm.label} />
                </TooltipTrigger>
                <TooltipContent side="right">{mm.label}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={onPause} disabled={busy || paused} className="grid h-11 place-items-center rounded-xl border border-[#FF5268]/40 bg-[#FF5268]/10 text-[#FF7A8B] disabled:opacity-50" aria-label="Pause everything">
                    <PauseCircle size={18} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{paused ? "Everything is paused" : "Pause everything"}</TooltipContent>
              </Tooltip>
              {onToggleCollapsed && (
                <button onClick={onToggleCollapsed} className="grid h-9 place-items-center rounded-lg text-[#7C889B] hover:bg-white/[0.05] hover:text-white" aria-label="Expand sidebar">
                  <ChevronsRight size={18} />
                </button>
              )}
            </>
          ) : (
            <div className="rounded-2xl border border-[#1E2A3D] bg-[#111827] p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] text-[#7C889B]">Mode</span>
                <Badge tone={mm.tone} dot>{mm.label}</Badge>
              </div>
              <div className="mt-2.5 flex items-center justify-between text-[13.5px]">
                <span className="flex items-center gap-2 text-[#C9D2DE]"><Bot size={15} className="text-[#7C889B]" /> Robots active</span>
                <span className="fd-num font-semibold text-white">{running}/{total}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[13.5px]">
                <span className="flex items-center gap-2 text-[#C9D2DE]"><Activity size={15} className="text-[#7C889B]" /> System</span>
                <span className={`font-semibold ${healthy ? "text-[#3BE6B0]" : paused ? "text-[#FF7A8B]" : "text-[#FFC266]"}`}>
                  {!dash ? "Connecting…" : healthy ? "Healthy" : paused ? "Paused" : "Attention"}
                </span>
              </div>
              <button
                onClick={onPause}
                disabled={busy || paused}
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#FF5268]/45 bg-[#FF5268]/10 text-[14px] font-semibold text-[#FF7A8B] transition-colors hover:bg-[#FF5268]/18 disabled:opacity-50"
              >
                <PauseCircle size={17} /> {paused ? "Everything paused" : "Pause Everything"}
              </button>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

// ── Top bar ───────────────────────────────────────────────────────────────
export function TopBar(props: {
  dash: DashboardDTO | null;
  mode: OperatingMode;
  me: { email: string; role: string; name: string | null; via?: string } | null;
  onOpenSearch: () => void;
  onOpenMenu: () => void;
  onNavigate: (n: Nav) => void;
  onSignOut: () => void;
}) {
  const { dash, mode, me, onOpenSearch, onOpenMenu, onNavigate, onSignOut } = props;
  const mm = MODE_META[mode];
  const liveVenues = VENUES.filter((v) => v.adapter === "LIVE");
  const withData = liveVenues.filter((v) => (dash?.venues.find((s) => s.venue === v.id)?.markets ?? 0) > 0).length;
  const notes = dash?.notifications ?? [];
  const alerts = dash?.openAlerts ?? 0;
  const initials = (me?.name ?? me?.email ?? "?").split(/[\s@.]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");

  return (
    <div className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-[#1A2333] bg-[#0D121C]/95 px-3 backdrop-blur sm:px-6">
      <button onClick={onOpenMenu} className="grid h-10 w-10 place-items-center rounded-xl text-[#C9D2DE] hover:bg-white/[0.05] md:hidden" aria-label="Open menu">
        <Menu size={20} />
      </button>
      <button
        onClick={onOpenSearch}
        className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-xl border border-[#1E2A3D] bg-[#111827] px-3.5 text-left text-[14.5px] text-[#7C889B] transition-colors hover:border-[#253247] sm:max-w-[460px]"
        aria-label="Search markets, robots, strategies, orders"
      >
        <Search size={17} />
        <span className="flex-1 truncate">Search markets, robots, orders…</span>
        <kbd className="hidden rounded-md border border-[#253247] px-1.5 py-0.5 text-[12px] text-[#9AA6B8] sm:inline">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <span
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[13.5px] font-semibold ring-1 ring-inset"
          style={{ color: mm.hex, background: `color-mix(in srgb, ${mm.hex} 12%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${mm.hex} 35%, transparent)` }}
          title={mm.desc}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: mm.hex }} aria-hidden />
          <span className="hidden sm:inline">{mm.label}</span>
          <span className="sm:hidden">{mode === "PAPER" ? "Paper" : mode === "PAUSED" ? "Paused" : mm.label}</span>
        </span>

        <span className="hidden items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[13.5px] text-[#C9D2DE] lg:inline-flex" title="Venues with synced market data">
          <span className={`h-2 w-2 rounded-full ${withData > 0 ? "bg-[#00D69A]" : "bg-[#FFB547]"}`} aria-hidden />
          {withData}/{liveVenues.length} venues with data
        </span>

        <Popover>
          <PopoverTrigger asChild>
            <button className="relative grid h-10 w-10 place-items-center rounded-xl text-[#C9D2DE] hover:bg-white/[0.05]" aria-label={`Notifications${alerts ? `, ${alerts} alerts` : ""}`}>
              <Bell size={19} />
              {alerts > 0 && (
                <span className="fd-num absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#FF5268] px-1 text-[11px] font-bold text-white">{alerts}</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[360px] border-[#253247] bg-[#111827] p-0 text-[#E8EDF5]">
            <div className="border-b border-[#1E2A3D] px-4 py-3 text-[15px] font-semibold">Notifications</div>
            <div className="fd-scroll max-h-[380px] overflow-y-auto">
              {notes.length === 0 ? (
                <div className="px-4 py-8 text-center text-[14px] text-[#9AA6B8]">You&apos;re all caught up.</div>
              ) : (
                notes.map((n) => (
                  <div key={n.id} className="border-b border-[#1A2333] px-4 py-3 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${n.severity === "CRITICAL" ? "bg-[#FF5268]" : n.severity === "WARNING" ? "bg-[#FFB547]" : "bg-[#2583FF]"}`} aria-hidden />
                      <span className="flex-1 text-[14px] font-medium">{n.title}</span>
                      <span className="text-[12px] text-[#7C889B]">{ago(n.createdAt)}</span>
                    </div>
                    <p className="ml-4 mt-1 text-[13px] leading-snug text-[#9AA6B8]">{n.body}</p>
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <button onClick={() => onNavigate({ view: "settings", tab: "general" })} className="hidden h-10 w-10 place-items-center rounded-xl text-[#C9D2DE] hover:bg-white/[0.05] sm:grid" aria-label="Settings">
          <Settings size={19} />
        </button>

        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-white/[0.05]" aria-label="Account menu">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#2583FF] to-[#9B7BFF] text-[13px] font-bold text-white">{initials || <CircleUser size={18} />}</span>
              <ChevronDown size={15} className="hidden text-[#7C889B] sm:block" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[280px] border-[#253247] bg-[#111827] p-0 text-[#E8EDF5]">
            <div className="border-b border-[#1E2A3D] px-4 py-3">
              <div className="truncate text-[14.5px] font-semibold">{me?.name ?? "Account"}</div>
              <div className="fd-num truncate text-[12.5px] text-[#9AA6B8]">{me?.email ?? "—"}</div>
              <div className="mt-2 flex gap-2">
                {me?.role && <Badge tone={me.role === "OPERATOR" ? "blue" : "green"}>{me.role.toLowerCase()}</Badge>}
                {me?.via === "FOUNDER_FALLBACK" && <Badge tone="amber">not signed in</Badge>}
              </div>
            </div>
            <div className="p-1.5">
              {dash?.wallet && (
                <div className="flex items-center gap-2.5 px-3 py-2 text-[13.5px] text-[#9AA6B8]">
                  <Wallet size={16} /> <span className="fd-num">{dash.wallet.address.slice(0, 6)}…{dash.wallet.address.slice(-4)}</span>
                </div>
              )}
              {me?.via === "FOUNDER_FALLBACK" && (
                <Link href="/login" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] hover:bg-white/[0.05]">
                  <CircleUser size={16} /> Sign in
                </Link>
              )}
              <button onClick={onSignOut} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] hover:bg-white/[0.05]">
                <LogOut size={16} /> Sign out
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

// ── Mobile bottom navigation ──────────────────────────────────────────────
export function MobileNav({ nav, onNavigate, onMore }: { nav: Nav; onNavigate: (n: Nav) => void; onMore: () => void }) {
  const g = groupOf(nav.view);
  const items: Array<{ id: string; label: string; icon: ReactNode; to?: Nav }> = [
    { id: "overview", label: "Home", icon: <Home size={20} />, to: { view: "overview" } },
    { id: "markets", label: "Markets", icon: <Compass size={20} />, to: { view: "markets", tab: "trending" } },
    { id: "studio", label: "Robots", icon: <Bot size={20} />, to: { view: "robots" } },
    { id: "trading", label: "Trading", icon: <LineChart size={20} />, to: { view: "trading", tab: "positions" } },
    { id: "more", label: "More", icon: <MoreHorizontal size={20} /> },
  ];
  const moreActive = !["overview", "markets", "studio", "trading"].includes(g);
  return (
    <nav aria-label="Primary mobile navigation" className="fd-safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t border-[#1A2333] bg-[#0D121C]/97 backdrop-blur md:hidden">
      {items.map((it) => {
        const lit = it.id === "more" ? moreActive : g === it.id;
        return (
          <button
            key={it.id}
            onClick={() => (it.to ? onNavigate(it.to) : onMore())}
            aria-current={lit ? "page" : undefined}
            className={`flex min-h-[58px] flex-1 flex-col items-center justify-center gap-1 text-[12px] font-medium ${lit ? "text-white" : "text-[#7C889B]"}`}
          >
            <span className={lit ? "text-[#2583FF]" : ""}>{it.icon}</span>
            {it.label}
          </button>
        );
      })}
    </nav>
  );
}

export function NavDrawer({ open, onOpenChange, children }: { open: boolean; onOpenChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[300px] border-[#1A2333] bg-[#0D121C] p-0 text-[#E8EDF5]">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}

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
    () => NAV.flatMap((g) => [{ label: g.label, to: g.to }, ...(g.children ?? []).map((ch) => ({ label: `${g.label} › ${ch.label}`, to: ch.to }))]),
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
                <span className="text-[12px] text-[#7C889B]">{VENUES.find((v) => v.id === r.venue)?.label}</span>
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
                <span className="fd-num text-[12px] text-[#9AA6B8]">{m.yesPriceCents ?? "—"}¢</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Venues">
          {VENUES.map((v) => (
            <CommandItem key={v.id} value={`venue ${v.label}`} onSelect={() => go(() => onOpenVenue(v.id))}>
              <span className="h-2 w-2 rounded-full" style={{ background: v.hex }} aria-hidden /> {v.label}
              <span className="ml-auto text-[12px] text-[#7C889B]">{venueStatus(v.id, v.adapter)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {(dash?.orders.length ?? 0) > 0 && (
          <CommandGroup heading="Recent orders">
            {dash!.orders.slice(0, 8).map((o) => (
              <CommandItem key={o.id} value={`order ${o.id} ${o.market?.question ?? ""} ${o.state}`} onSelect={() => go(() => onNavigate({ view: "trading", tab: "orders" }))}>
                <BarChart3 size={16} /> <span className="flex-1 truncate">{o.market?.question ?? o.marketId}</span>
                <span className="fd-num text-[12px] text-[#9AA6B8]">{money(o.sizeCents)}</span>
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
