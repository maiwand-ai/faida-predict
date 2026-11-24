"use client";

// FAIDA Predict — My robots. One card per robot: what it's doing right now
// in plain words, its last decision and why, its numbers, and exactly one
// obvious action (Pause or Resume). Everything else sits in the ⋯ menu.
// Pause / resume go through PATCH /api/robots, which enforces the
// transition table.

import { useState, type ReactNode } from "react";
import { Bot, ExternalLink, MoreHorizontal, Pause, Play, Plus, RotateCw, Store } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { DashboardDTO } from "./types";
import { FAMILY_LABEL } from "./types";
import { VENUE_LABEL, venueColor } from "@/lib/venues";
import { ago, Badge, btn, EmptyState, Metric, money, PageHeader, PageSkeleton, Panel, robotStatusBadge, Segmented, Tabs, toneOf, toneText } from "./ds";
import { decisionWords, robotStateLine } from "./status";

export const CAN_PAUSE = ["RUNNING", "PAPER_ONLY"];
export const CAN_RESUME = ["PAUSED_BY_USER", "PAUSED_BY_RISK", "ERROR"];

export function RobotsView(props: {
  dash: DashboardDTO | null;
  busy: string | null;
  onOpenRobot: (id: string) => void;
  onCreate: () => void;
  onOpenVenue: (id: string) => void;
  onRobotStatus: (id: string, status: string, name: string) => void;
  onCycleRobot: (id: string, name: string) => void;
  tab: string;
  onTab: (t: string) => void;
  readyMade: ReactNode;
  lab: ReactNode;
}) {
  const { dash, busy, onOpenRobot, onCreate, onOpenVenue, onRobotStatus, onCycleRobot, tab, onTab, readyMade, lab } = props;
  const [filter, setFilter] = useState<"running" | "stopped" | "all">("all");
  if (!dash) return <PageSkeleton />;
  const robots = dash.robots;
  const isRunning = (s: string) => CAN_PAUSE.includes(s);
  const running = robots.filter((r) => isRunning(r.status)).length;
  const stopped = robots.length - running;
  const stats = new Map<string, { open: number; pnl: number | null }>();
  for (const p of dash.positions) {
    const name = p.robot?.name ?? "";
    const s = stats.get(name) ?? { open: 0, pnl: null };
    s.open += 1;
    if (p.unrealizedCents != null) s.pnl = (s.pnl ?? 0) + p.unrealizedCents;
    stats.set(name, s);
  }
  const lastTrace = new Map<string, (typeof dash.traces)[number]>();
  for (const t of dash.traces) if (t.robot?.name && !lastTrace.has(t.robot.name)) lastTrace.set(t.robot.name, t);
  const totalOpenPnl = [...stats.values()].reduce((a, s) => a + (s.pnl ?? 0), 0);
  const shown = robots.filter((r) => filter === "all" || (filter === "running" ? isRunning(r.status) : !isRunning(r.status)));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<Bot size={24} />}
        title="Robots"
        subtitle="Each robot follows one strategy on one venue and bets for you. Tap one to see every decision it made."
        actions={<button className={btn.primary} onClick={onCreate}><Plus size={17} /> New robot</button>}
      />
      <Tabs label="Robot sections" value={tab} onChange={onTab} tabs={[
        { id: "mine", label: "My robots", count: robots.length },
        { id: "ready", label: "Ready-made robots" },
        { id: "lab", label: "Test & tune" },
      ]} />
      {tab === "ready" && readyMade}
      {tab === "lab" && lab}
      {tab === "mine" && <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Running" value={running} hex="#00D69A" icon={<Play size={17} />} sub={`of ${robots.length} robot${robots.length === 1 ? "" : "s"}`} />
        <Metric label="Stopped or paused" value={stopped} hex="#FFB547" icon={<Pause size={17} />} />
        <Metric label="Open profit / loss" value={money(totalOpenPnl, { sign: true })} tone={toneOf(totalOpenPnl)} hex="#08D9E8" sub="If every trade closed now" />
        <Metric label="Money given to robots" value={money(dash.allocatedCents)} icon={<Bot size={17} />} sub="Practice money" />
      </div>

      {robots.length === 0 ? (
        <Panel>
          <EmptyState icon={<Bot size={22} />} title="No robots yet" body="Pick a ready-made template, choose how much money it may use, and it starts right away with practice money." action={<button className={btn.primary} onClick={onCreate}>Create your first robot</button>} />
        </Panel>
      ) : (
        <>
          <div><Segmented
            label="Show robots"
            value={filter}
            onChange={setFilter}
            options={[{ id: "all", label: `All (${robots.length})` }, { id: "running", label: `Running (${running})` }, { id: "stopped", label: `Stopped (${stopped})` }]}
          /></div>
          {shown.length === 0 ? (
            <Panel><EmptyState compact title={filter === "running" ? "No robot is running" : "No stopped robots"} /></Panel>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {shown.map((r) => {
                const s = stats.get(r.name);
                const hex = venueColor(r.venue);
                const t = lastTrace.get(r.name);
                const canPause = CAN_PAUSE.includes(r.status);
                const canResume = CAN_RESUME.includes(r.status);
                return (
                  <article key={r.id} className="fd-glass flex flex-col rounded-3xl border border-[var(--fd-border)] bg-[var(--fd-surface)] p-5">
                    <div className="flex items-start gap-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-[16px] font-bold" style={{ background: `color-mix(in srgb, ${hex} 20%, transparent)`, color: hex }} aria-hidden>
                        {r.name.slice(0, 1).toUpperCase()}
                      </span>
                      <button className="min-w-0 flex-1 text-left" onClick={() => onOpenRobot(r.id)}>
                        <span className="block truncate text-[17px] font-semibold text-[var(--fd-strong)] hover:underline">{r.name}</span>
                        <span className="block truncate text-[13.5px] text-[var(--fd-text2)]">{FAMILY_LABEL[r.family] ?? r.family} · {VENUE_LABEL[r.venue] ?? r.venue}</span>
                      </button>
                      {robotStatusBadge(r.status)}
                    </div>

                    <div className="mt-4 rounded-2xl bg-[var(--fd-bg2)] px-4 py-3 text-[14.5px] text-[var(--fd-text)]">
                      {robotStateLine(r.status, r.statusReason, s?.open ?? 0)}
                    </div>

                    <div className="mt-3 min-h-[44px] text-[13.5px] leading-snug text-[var(--fd-text2)]">
                      {t ? (
                        <>
                          <span className="font-semibold text-[var(--fd-text-soft)]">{decisionWords(t.decision)}</span> · {ago(t.createdAt)}
                          <span className="mt-0.5 line-clamp-2 block">{t.reason}</span>
                        </>
                      ) : (
                        <span>No decisions yet. It makes its first one at the next market check.</span>
                      )}
                    </div>

                    <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--fd-line)] pt-4">
                      <div><dt className="text-[12.5px] text-[var(--fd-text3)]">Money</dt><dd className="fd-num text-[15px] font-semibold text-[var(--fd-strong)]">{money(r.allocatedCents, { compact: true })}</dd></div>
                      <div><dt className="text-[12.5px] text-[var(--fd-text3)]">Open trades</dt><dd className="fd-num text-[15px] font-semibold text-[var(--fd-strong)]">{s?.open ?? 0}<span className="text-[var(--fd-text3)]">/{r.maxOpenPositions}</span></dd></div>
                      <div><dt className="text-[12.5px] text-[var(--fd-text3)]">Open P&L</dt><dd className={`fd-num text-[15px] font-semibold ${toneText[toneOf(s?.pnl)]}`}>{s?.pnl != null ? money(s.pnl, { sign: true }) : "—"}</dd></div>
                    </dl>

                    <div className="mt-4 flex items-center gap-2">
                      {canPause ? (
                        <button className={`${btn.secondary} flex-1`} onClick={() => onRobotStatus(r.id, "PAUSED_BY_USER", r.name)} disabled={busy !== null}><Pause size={16} /> Pause</button>
                      ) : canResume ? (
                        <button className={`${btn.primary} flex-1`} onClick={() => onRobotStatus(r.id, "PAPER_ONLY", r.name)} disabled={busy !== null}><Play size={16} /> Resume</button>
                      ) : (
                        <button className={`${btn.secondary} flex-1`} onClick={() => onOpenRobot(r.id)}>Open details</button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="grid h-11 w-11 place-items-center rounded-xl border border-[var(--fd-border2)] bg-[var(--fd-elevated)] text-[var(--fd-text-soft)] hover:bg-[var(--fd-hover)]" aria-label={`More actions for ${r.name}`}>
                            <MoreHorizontal size={18} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="fd-glass-strong w-56 rounded-2xl border-[var(--fd-border2)] p-1.5 text-[var(--fd-text)]">
                          <DropdownMenuItem disabled={busy !== null || !canPause} onSelect={() => onCycleRobot(r.id, r.name)} className="rounded-xl px-3 py-2.5 text-[14px]">
                            <RotateCw size={15} /> Check markets now
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => onOpenRobot(r.id)} className="rounded-xl px-3 py-2.5 text-[14px]">
                            <ExternalLink size={15} /> Details & decisions
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => onOpenVenue(r.venue)} className="rounded-xl px-3 py-2.5 text-[14px]">
                            <Store size={15} /> Open {VENUE_LABEL[r.venue] ?? "venue"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
      {robots.some((r) => r.status === "PAUSED_BY_RISK") && (
        <Panel>
          <div className="flex items-center gap-3 text-[14px] text-[var(--fd-text-soft)]"><Badge tone="red">Safety stop</Badge> A robot was stopped by a safety limit. Open it to see why before resuming.</div>
        </Panel>
      )}
      </>}
    </div>
  );
}
