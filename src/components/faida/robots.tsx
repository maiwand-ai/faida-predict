"use client";

// FAIDA Predict — My Robots: every robot with its venue, strategy, status,
// capital and open positions, plus the allowed status actions. Pause /
// resume go through PATCH /api/robots, which enforces the transition table.

import { Bot, Pause, Play, Plus, RotateCw } from "lucide-react";
import type { DashboardDTO } from "./types";
import { FAMILY_LABEL } from "./types";
import { venueColor } from "@/lib/venues";
import { ago, Badge, btn, EmptyState, Metric, money, PageHeader, PageSkeleton, Panel, robotStatusBadge, TableWrap, td, th, toneOf, toneText, trow, VenueTag } from "./ds";

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
}) {
  const { dash, busy, onOpenRobot, onCreate, onOpenVenue, onRobotStatus, onCycleRobot } = props;
  if (!dash) return <PageSkeleton />;
  const robots = dash.robots;
  const running = robots.filter((r) => r.status === "RUNNING" || r.status === "PAPER_ONLY").length;
  const paused = robots.filter((r) => r.status.startsWith("PAUSED")).length;
  const stats = new Map<string, { open: number; pnl: number | null; exposure: number }>();
  for (const p of dash.positions) {
    const name = p.robot?.name ?? "";
    const s = stats.get(name) ?? { open: 0, pnl: null, exposure: 0 };
    s.open += 1;
    s.exposure += p.sizeCents;
    if (p.unrealizedCents != null) s.pnl = (s.pnl ?? 0) + p.unrealizedCents;
    stats.set(name, s);
  }
  const lastTrace = new Map<string, string>();
  for (const t of dash.traces) if (t.robot?.name && !lastTrace.has(t.robot.name)) lastTrace.set(t.robot.name, t.createdAt);
  const totalOpenPnl = [...stats.values()].reduce((a, s) => a + (s.pnl ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<Bot size={24} />}
        title="My Robots"
        subtitle="Monitor and manage your automated trading robots"
        actions={<button className={btn.primary} onClick={onCreate}><Plus size={17} /> Create robot</button>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Total robots" value={robots.length} icon={<Bot size={17} />} />
        <Metric label="Running" value={running} hex="#00D69A" icon={<Play size={17} />} sub="Running or paper" />
        <Metric label="Paused" value={paused} hex="#FFB547" icon={<Pause size={17} />} />
        <Metric label="Open P&L" value={money(totalOpenPnl, { sign: true })} tone={toneOf(totalOpenPnl)} hex="#08D9E8" sub={`${money(dash.allocatedCents)} allocated`} />
      </div>

      <Panel pad={false}>
        {robots.length === 0 ? (
          <EmptyState icon={<Bot size={22} />} title="No robots yet" body="Create your first robot in Robot Studio. It starts in paper mode." action={<button className={btn.primary} onClick={onCreate}>Create robot</button>} />
        ) : (
          <TableWrap minWidth={1040}>
            <thead>
              <tr>
                <th className={th}>Robot</th>
                <th className={th}>Venue</th>
                <th className={th}>Strategy</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Allocation</th>
                <th className={`${th} text-right`}>Open positions</th>
                <th className={`${th} text-right`}>Open P&L</th>
                <th className={th}>Last decision</th>
                <th className={`${th} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {robots.map((r) => {
                const s = stats.get(r.name);
                const hex = venueColor(r.venue);
                return (
                  <tr key={r.id} className={`${trow} cursor-pointer`} onClick={() => onOpenRobot(r.id)}>
                    <td className={td}>
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[14px] font-bold" style={{ background: `color-mix(in srgb, ${hex} 18%, transparent)`, color: hex }} aria-hidden>
                          {r.name.slice(0, 1)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{r.name}</div>
                          <div className="text-[12.5px] text-[var(--fd-text3)]">v{r.activeVersion}{r.statusReason ? ` · ${r.statusReason}` : ""}</div>
                        </div>
                      </div>
                    </td>
                    <td className={td}>
                      <button onClick={(e) => { e.stopPropagation(); onOpenVenue(r.venue); }}><VenueTag venue={r.venue} /></button>
                    </td>
                    <td className={`${td} text-[var(--fd-text-soft)]`}>{FAMILY_LABEL[r.family] ?? r.family}</td>
                    <td className={td}>{robotStatusBadge(r.status)}</td>
                    <td className={`${td} fd-num text-right`}>{money(r.allocatedCents)}</td>
                    <td className={`${td} fd-num text-right`}>{s?.open ?? 0}<span className="text-[var(--fd-text3)]">/{r.maxOpenPositions}</span></td>
                    <td className={`${td} fd-num text-right font-semibold ${toneText[toneOf(s?.pnl)]}`}>{s?.pnl != null ? money(s.pnl, { sign: true }) : "—"}</td>
                    <td className={`${td} text-[var(--fd-text-soft)]`}>{lastTrace.has(r.name) ? ago(lastTrace.get(r.name)) : <span className="text-[var(--fd-text3)]">None yet</span>}</td>
                    <td className={`${td} text-right`}>
                      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button className={btn.small} onClick={() => onCycleRobot(r.id, r.name)} disabled={busy !== null || !CAN_PAUSE.includes(r.status)} title="Run one decision cycle now" aria-label={`Run a cycle for ${r.name}`}>
                          <RotateCw size={14} />
                        </button>
                        {CAN_PAUSE.includes(r.status) && (
                          <button className={btn.small} onClick={() => onRobotStatus(r.id, "PAUSED_BY_USER", r.name)} disabled={busy !== null} aria-label={`Pause ${r.name}`}>
                            <Pause size={14} /> Pause
                          </button>
                        )}
                        {CAN_RESUME.includes(r.status) && (
                          <button className={btn.small} onClick={() => onRobotStatus(r.id, "PAPER_ONLY", r.name)} disabled={busy !== null} aria-label={`Resume ${r.name} in paper mode`}>
                            <Play size={14} /> Resume
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Panel>
      {robots.some((r) => r.status === "PAUSED_BY_RISK") && (
        <Panel>
          <div className="flex items-center gap-3 text-[14px] text-[var(--fd-text-soft)]"><Badge tone="red">Risk pause</Badge> A robot was paused by the risk engine. Review it before resuming.</div>
        </Panel>
      )}
    </div>
  );
}
