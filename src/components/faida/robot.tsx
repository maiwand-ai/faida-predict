"use client";

// FAIDA Predict — Robot detail (Phase 11 redesign ratification).
// The third IA level the artifact proposed: Overview → Venue workspace →
// Robot detail. Every number is real: allocation + caps from the Robot row,
// open marks from the shared risk-engine formula, "today" from the P-02
// ledger, the P&L curve from per-day realized cash flow (FILL/FEE/SETTLEMENT
// entries attributed to this robot's orders), and "Path to live trading"
// straight from the B10 edge gate report. The chart carries y-axis labels —
// one of the seven artifact defects fixed in implementation.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { type RobotDetailDTO, FAMILY_LABEL } from "./types";
import { c, card, mono, fmtCents, Pill, VenueBadge, venueScopeStyle } from "./ui";
import { VENUE_LABEL } from "@/lib/venues";

function pnlClass(v: number | null): string {
  if (v == null || v === 0) return c.text3;
  return v > 0 ? c.gain : c.loss;
}
function pnlText(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${fmtCents(v)}`;
}

// compact y-axis money — input is CENTS: $1,240 → "$1.2k", $250 → "$250"
// so the gutter never crowds the plot (values verified against fmtCents math)
function moneyShort(v: number): string {
  const d = v / 100; // cents → dollars
  const abs = Math.abs(d);
  const sign = d < 0 ? "-" : "";
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  if (abs >= 1) return `${sign}$${abs.toFixed(0)}`;
  return `${sign}$${abs.toFixed(2)}`;
}

// ── realized paper P&L chart (SVG, y-axis labeled — artifact fix #6) ─────────
function FlowChart({ flow, range }: { flow: RobotDetailDTO["flow"]; range: 7 | 14 | 30 }) {
  const pts = useMemo(() => flow.slice(-range), [flow, range]);
  const W = 560;
  const H = 190;
  const PAD = { l: 46, r: 10, t: 10, b: 22 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;

  if (pts.length === 0) {
    return (
      <div className={`px-4 py-10 text-center text-[12px] ${c.text3}`}>
        No ledger window — run a robot cycle or place a paper ticket to start the curve.
      </div>
    );
  }
  const values = pts.map((p) => p.cumCents);
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (lo === hi) { lo = -100; hi = 100; }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  const x = (i: number) => PAD.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.cumCents).toFixed(1)}`).join(" ");
  const area = `${path} L${x(pts.length - 1).toFixed(1)},${y(Math.max(lo, Math.min(hi, 0))).toFixed(1)} L${x(0).toFixed(1)},${y(Math.max(lo, Math.min(hi, 0))).toFixed(1)} Z`;

  // gridlines at NICE money steps (1/2/2.5/5 × 10^k) — raw domain fractions
  // produce labels like −$30.1k that nobody can read (artifact fix #6)
  const rawStep = (hi - lo) / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 1))));
  const niceStep = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rawStep) ?? pow * 10;
  const firstTick = Math.ceil(lo / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let k = 0; k <= 6; k++) {
    const t = Math.round((firstTick + k * niceStep) * 100) / 100;
    if (t > hi) break;
    if (t >= lo) ticks.push(t);
  }
  const dayLabel = (d: string) => {
    const dt = new Date(d + "T00:00:00Z");
    return dt.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
  };
  const xticks = pts.length > 1 ? [0, Math.floor((pts.length - 1) / 2), pts.length - 1] : [0];

  return (
    <div role="img" aria-label={`Realized paper P&L over the last ${range} days, ${pnlText(pts[pts.length - 1].cumCents)} cumulative`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#1E2533" strokeWidth="1" />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#6B7A94" fontFamily="var(--font-jetbrains), monospace">
              {moneyShort(t)}
            </text>
          </g>
        ))}
        {lo < 0 && hi > 0 && (
          <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="#2C3648" strokeWidth="1" strokeDasharray="3 3" />
        )}
        <path d={area} fill="url(#flowFill)" opacity="0.35" />
        <path d={path} fill="none" stroke="#3E9BF0" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        <defs>
          <linearGradient id="flowFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3E9BF0" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#3E9BF0" stopOpacity="0" />
          </linearGradient>
        </defs>
        {xticks.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"} fontSize="9" fill="#6B7A94">
            {dayLabel(pts[i].day)}
          </text>
        ))}
      </svg>
    </div>
  );
}

// gate check names → human labels (B10 edge gate report)
const GATE_LABEL: Record<string, string> = {
  MODEL_CALIBRATED: "Edge evidence",
  PROVENANCE_COMPLETENESS: "Provenance completeness",
  EVIDENCE_CLEAN: "Evidence cleanliness",
  BACKTEST_EVIDENCE: "Backtest evidence",
  PAPER_SESSION: "Paper session",
  RECORDED_CONSENT_C25: "Recorded consent",
};

export function RobotDetail(props: {
  robotId: string;
  busy: string | null;
  onBack: () => void;
  onBackLabel: string;
  onOpenVenue: (venueId: string) => void;
  onCycleRobot: (robotId: string, name: string) => void;
  onRobotStatus: (robotId: string, status: string, name: string) => void;
}) {
  const { robotId, busy, onBack, onBackLabel, onOpenVenue, onCycleRobot, onRobotStatus } = props;
  const [data, setData] = useState<RobotDetailDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState<7 | 14 | 30>(14);
  const [openTrace, setOpenTrace] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // state resets happen by REMOUNT — app.tsx keys this component by robotId,
    // so a different robot starts from a clean (null) slate; this effect only
    // ever runs the one fetch for its own id.
    (async () => {
      try {
        const res = await fetch(`/api/robots/${robotId}/detail`);
        const json = (await res.json().catch(() => null)) as RobotDetailDTO | { error: string } | null;
        if (!alive) return;
        if (!res.ok || !json || "error" in json) {
          setErr("error" in (json ?? {}) ? String((json as { error: string }).error) : "detail unavailable");
          return;
        }
        setData(json);
      } catch {
        if (alive) setErr("detail fetch failed — transient, retry from the venue workspace");
      }
    })();
    return () => { alive = false; };
  }, [robotId]);

  if (err) {
    return (
      <div className="flex flex-col items-start gap-3 py-6">
        <Button variant="outline" size="sm" className={`${c.borderStrong} ${c.elevated} ${c.text} hover:bg-[#1A2432]`} onClick={onBack}>← {onBackLabel}</Button>
        <div className={`${card} px-4 py-6 text-[12.5px] ${c.warn}`}>{err}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-4 py-6">
        <div className={`h-8 w-64 animate-pulse rounded ${c.elevated}`} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className={`h-24 animate-pulse rounded-xl ${c.elevated}`} />)}
        </div>
        <div className={`h-64 animate-pulse rounded-xl ${c.elevated}`} />
      </div>
    );
  }

  const { robot, positions, orders, traces, gate, flow, todayNetCents, unrealizedCents, balanceCents } = data;
  const allocPct = balanceCents > 0 ? (robot.allocatedCents / balanceCents) * 100 : 0;
  const todayOnAlloc = robot.allocatedCents > 0 ? (todayNetCents / robot.allocatedCents) * 100 : 0;
  // realized drawdown: peak-to-trough of the cumulative curve (honest — no
  // synthetic marks smeared into history; open marks are reported separately)
  let peak = 0;
  let dd = 0;
  for (const f of flow) {
    peak = Math.max(peak, f.cumCents);
    dd = Math.max(dd, peak - f.cumCents);
  }
  const openTrades = traces.filter((t) => t.decision === "TRADE").length;
  const status = robot.status.replace("_", " ");
  const canPause = robot.status === "RUNNING" || robot.status === "PAPER_ONLY";
  const canResume = robot.status === "PAUSED_BY_USER";

  return (
    <div className="vc-scope flex flex-col gap-4" style={venueScopeStyle(robot.venue)}>
      {/* breadcrumb */}
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Button variant="outline" size="sm" className={`${c.borderStrong} ${c.elevated} ${c.text} hover:bg-[#1A2432]`} onClick={onBack}>
          ← {onBackLabel}
        </Button>
        <span className={c.text3}>
          <button className="hover:underline" onClick={() => onOpenVenue(robot.venue)}>{VENUE_LABEL[robot.venue] ?? robot.venue}</button>
          <span className={c.text3}> / {robot.name}</span>
        </span>
      </div>

      {/* robot header */}
      <div className={`${card} flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:p-5`}>
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <span
            aria-hidden
            className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-[20px] font-bold"
            style={{ background: "var(--vc)", color: "#071018" }}
          >
            {robot.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-[22px] font-bold tracking-tight text-[#E6EAF2]">{robot.name}</h1>
              <VenueBadge venue={robot.venue} />
              <Pill status={robot.status} />
              <span className={`rounded px-2 py-0.5 text-[10px] font-bold tracking-wide ${c.paper} bg-[#D9B25C]/10`}>{robot.paperMode ? "PAPER" : robot.mode}</span>
            </div>
            <div className={`mt-1 text-[11.5px] ${c.text2}`}>
              {FAMILY_LABEL[robot.family] ?? robot.family} · strategy v{robot.activeVersion} · every decision recorded with its inputs and risk checks (A-08)
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="outline" size="sm"
            className={`${c.borderStrong} ${c.elevated} ${c.text} hover:bg-[#1A2432]`}
            onClick={() => onCycleRobot(robot.id, robot.name)}
            disabled={busy !== null || robot.status === "STOPPED"}
            title={robot.status === "STOPPED" ? "Stopped robots do not cycle" : `Evaluate ${robot.name} once now`}
          >
            Run cycle
          </Button>
          {canPause && (
            <Button
              variant="outline" size="sm"
              className="border-[#E3A63B]/50 bg-transparent text-[#E3A63B] hover:bg-[#E3A63B]/10"
              onClick={() => onRobotStatus(robot.id, "PAUSED_BY_USER", robot.name)}
              disabled={busy !== null}
            >
              Pause robot
            </Button>
          )}
          {canResume && (
            <Button
              variant="outline" size="sm"
              className={`${c.borderStrong} ${c.elevated} ${c.text} hover:bg-[#1A2432]`}
              onClick={() => onRobotStatus(robot.id, "PAPER_ONLY", robot.name)}
              disabled={busy !== null}
            >
              Resume robot
            </Button>
          )}
        </div>
      </div>

      {/* KPI band — four tiles with meter bars (allocated / positions / today / stops) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={`${card} p-4`}>
          <div className={`text-[10px] font-semibold tracking-wider ${c.text3}`}>ALLOCATED</div>
          <div className={`mt-1.5 text-[20px] font-semibold ${mono}`}>{fmtCents(robot.allocatedCents)}</div>
          <div className={`mt-2 h-1.5 overflow-hidden rounded ${c.elevated}`}>
            <div className="h-full rounded bg-[#3E9BF0]" style={{ width: `${Math.min(100, Math.max(2, allocPct))}%` }} />
          </div>
          <div className={`mt-1.5 text-[10px] ${c.text3}`}>{allocPct.toFixed(0)}% of paper balance</div>
        </div>
        <div className={`${card} p-4`}>
          <div className={`text-[10px] font-semibold tracking-wider ${c.text3}`}>OPEN POSITIONS</div>
          <div className={`mt-1.5 text-[20px] font-semibold ${mono}`}>{positions.length} / {robot.maxOpenPositions}</div>
          <div className={`mt-2 h-1.5 overflow-hidden rounded ${c.elevated}`}>
            <div
              className="h-full rounded bg-[#3E9BF0]"
              style={{ width: `${Math.min(100, Math.max(2, (positions.length / Math.max(1, robot.maxOpenPositions)) * 100))}%` }}
            />
          </div>
          <div className={`mt-1.5 text-[10px] ${c.text3}`}>Max {fmtCents(robot.maxPositionCents)} per position</div>
        </div>
        <div className={`${card} p-4`}>
          <div className={`text-[10px] font-semibold tracking-wider ${c.text3}`}>TODAY</div>
          <div className={`mt-1.5 text-[20px] font-semibold ${mono} ${pnlClass(todayNetCents)}`}>{pnlText(todayNetCents)}</div>
          <div className={`mt-2 h-1.5 overflow-hidden rounded ${c.elevated}`}>
            <div
              className={`h-full rounded ${todayNetCents < 0 ? "bg-[#F0525F]" : "bg-[#2FC08E]"}`}
              style={{ width: `${Math.min(100, Math.max(2, Math.min(100, Math.abs(todayOnAlloc))))}%` }}
            />
          </div>
          <div className={`mt-1.5 text-[10px] ${c.text3}`}>
            {todayOnAlloc >= 0 ? "+" : ""}{todayOnAlloc.toFixed(2)}% on allocation · open mark {pnlText(unrealizedCents)}
          </div>
        </div>
        <div className={`${card} p-4`}>
          <div className={`text-[10px] font-semibold tracking-wider ${c.text3}`}>REALIZED DRAWDOWN</div>
          <div className={`mt-1.5 text-[20px] font-semibold ${mono} ${dd > 0 ? c.warn : c.text}`}>{dd > 0 ? fmtCents(dd) : "none"}</div>
          <div className={`mt-2 h-1.5 overflow-hidden rounded ${c.elevated}`}>
            <div
              className={`h-full rounded ${robot.drawdownStopPct > 0 && robot.allocatedCents > 0 && (dd / robot.allocatedCents) * 100 >= 50 ? "bg-[#F0525F]" : "bg-[#E3A63B]"}`}
              style={{
                width: `${robot.allocatedCents > 0 ? Math.min(100, Math.max(2, (dd / robot.allocatedCents) * 100)) : 2}%`,
              }}
            />
          </div>
          <div className={`mt-1.5 text-[10px] ${c.text3}`}>Stops at {robot.drawdownStopPct}% · daily stop {robot.dailyLossStopPct}%</div>
        </div>
      </div>

      {/* chart + path to live */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={`${card} p-4 lg:col-span-2`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className={`text-[13px] font-semibold`}>Realized paper P&L</span>
              <span className={`ml-2 text-[11px] ${c.text3}`}>cumulative ledger net — entries, fees, settlements</span>
            </div>
            <div className="flex gap-1.5">
              {([7, 14, 30] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`rounded-full border px-2.5 py-1 text-[10.5px] font-semibold transition-colors ${
                    range === r ? "border-[var(--vc)] text-[var(--vc)]" : `${c.borderStrong} ${c.text3} hover:${c.text2}`
                  }`}
                >
                  {r === 30 ? "30d" : `${r}d`}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3">
            <FlowChart flow={flow} range={range} />
          </div>
          <div className={`mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] ${c.text3}`}>
            <span>last {range} days (UTC)</span>
            <span>open mark-to-market <b className={c.text2}>{pnlText(unrealizedCents)}</b> is reported separately, never folded into history</span>
            {openTrades > 0 && <span>{openTrades} trade decision{openTrades === 1 ? "" : "s"} in the recent trace window</span>}
          </div>
        </div>

        {/* path to live trading — the real B10 edge gate checks */}
        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between">
            <span className={`text-[13px] font-semibold`}>Path to live trading</span>
            <span className={`text-[11px] ${mono} ${c.text3}`}>{gate ? `${gate.checks.filter((ck) => ck.passed).length} / ${gate.checks.length}` : "—"}</span>
          </div>
          <div className="mt-3 flex flex-col">
            {(gate?.checks ?? []).map((ck) => (
              <div key={ck.check} className={`border-b py-2 last:border-0 ${c.border}`}>
                <div className="flex items-center gap-2">
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold ${
                      ck.passed ? "bg-[#2FC08E]/15 text-[#2FC08E]" : "bg-[#121722] text-[#6B7A94]"
                    }`}
                    title={ck.passed ? "gate satisfied" : "not satisfied yet"}
                  >
                    {ck.passed ? "✓" : "·"}
                  </span>
                  <span className={`text-[12px] font-semibold ${c.text}`}>{GATE_LABEL[ck.check] ?? ck.check}</span>
                </div>
                <div className={`mt-0.5 ml-6 text-[10.5px] leading-snug ${c.text3}`}>{ck.detail}</div>
              </div>
            ))}
            {!gate && (
              <div className={`py-4 text-center text-[12px] ${c.text3}`}>Edge gate report unavailable — check the probability registry in Settings.</div>
            )}
          </div>
          <Button variant="outline" size="sm" className={`mt-3 w-full ${c.borderStrong} ${c.elevated} ${c.text3}`} disabled title="Live activation is refused until every gate passes + the Phase 7 execution gates (B10)">
            {gate?.ready ? "Go live: gates pass — execution gates still apply" : "Go live: locked"}
          </Button>
        </div>
      </div>

      {/* positions on this robot */}
      {positions.length > 0 && (
        <div className={`${card} overflow-hidden`}>
          <div className="px-4 pt-3 pb-2 text-[13px] font-semibold">Open positions</div>
          <div className="fd-scroll max-h-[260px] overflow-y-auto">
            <table className="w-full">
              <thead className={`sticky top-0 ${c.surface}`}>
                <tr className={`border-b text-left text-[10px] tracking-wider ${c.border} ${c.text3}`}>
                  <th className="px-4 py-2.5 font-semibold">MARKET</th>
                  <th className="px-3 py-2.5 font-semibold">SIDE</th>
                  <th className="px-3 py-2.5 font-semibold">SIZE</th>
                  <th className="px-3 py-2.5 font-semibold">ENTRY → MARK</th>
                  <th className="px-4 py-2.5 font-semibold">P/L</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const mark = p.side === "YES" ? p.market?.yesPriceCents : p.market?.noPriceCents;
                  return (
                    <tr key={p.id} className={`border-b text-[12px] last:border-0 ${c.border}`}>
                      <td className={`max-w-[340px] truncate px-4 py-2.5 ${c.text}`}>{p.market?.question}</td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold ${p.side === "YES" ? `${c.gain} bg-[#2FC08E]/10` : `${c.warn} bg-[#E3A63B]/10`}`}>{p.side}</span>
                      </td>
                      <td className={`px-3 py-2.5 whitespace-nowrap ${mono} ${c.text}`}>{fmtCents(p.sizeCents)}</td>
                      <td className={`px-3 py-2.5 whitespace-nowrap ${mono} ${c.text2}`}>{p.avgPriceCents}¢ → {mark != null ? `${mark}¢` : "—"}</td>
                      <td className={`px-4 py-2.5 whitespace-nowrap ${mono} font-semibold ${pnlClass(p.unrealizedCents)}`}>{pnlText(p.unrealizedCents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* decision trace — the artifact's evidence band, fed by A-08 traces */}
      <div className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2">
          <span className={`text-[13px] font-semibold`}>Decision trace</span>
          <span className={`text-[10.5px] ${c.text3}`}>every decision is recorded with its inputs and risk checks (A-08)</span>
        </div>
        <div className="fd-scroll max-h-[520px] overflow-y-auto">
          {traces.length === 0 && (
            <div className={`px-4 py-7 text-center text-[12px] ${c.text3}`}>
              No decisions recorded yet — run a cycle on this robot, or let autopilot tick it.
            </div>
          )}
          {traces.map((t) => {
            const open = openTrace === t.id;
            const checks = parseRiskChecks(t.riskChecks);
            return (
              <div key={t.id} className={`border-b last:border-0 ${c.border}`}>
                <button onClick={() => setOpenTrace(open ? null : t.id)} className="flex w-full flex-wrap items-center gap-2.5 px-4 py-3 text-left hover:bg-[#161D2B]" aria-expanded={open}>
                  <span className={`shrink-0 text-[11px] ${mono} ${c.text3}`}>{new Date(t.createdAt).toLocaleTimeString("en-US", { hour12: false })}</span>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold tracking-wide ${t.decision === "TRADE" ? `${c.bright} bg-[#00B0F0]/10` : `${c.text3} bg-[#121722]`}`}>
                    {t.decision === "TRADE" ? "TRADE" : "NO TRADE"}
                  </span>
                  <span className={`min-w-0 flex-1 truncate text-[12.5px] font-semibold ${c.text}`}>{t.market?.question ?? "—"}</span>
                  <span className={`shrink-0 text-[11px] ${c.text3}`}>{t.reason.length > 46 ? t.reason.slice(0, 46) + "…" : t.reason}</span>
                  <span className={`shrink-0 text-[10px] ${open ? c.bright : c.text3}`}>{open ? "▾" : "▸"}</span>
                </button>
                {open && (
                  <div className="px-4 pb-3">
                    {/* stat band — model vs market vs net edge (real trace fields) */}
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      {[
                        { k: "Model estimate", v: t.modelEstimatePct != null ? `${t.modelEstimatePct}%` : "—", hot: false },
                        { k: "Market price", v: t.marketPriceCents != null ? `${t.marketPriceCents}¢` : "—", hot: false },
                        { k: "Net edge after fees", v: t.edgeNetPct != null ? `${t.edgeNetPct > 0 ? "+" : ""}${t.edgeNetPct} pts` : "—", hot: (t.edgeNetPct ?? 0) > 0 },
                        { k: "Trigger", v: t.trigger ?? "—", hot: false },
                      ].map((s) => (
                        <div key={s.k} className={`rounded-lg border px-3 py-2.5 ${c.border} ${c.elevated}`}>
                          <div className={`text-[9.5px] tracking-wide ${c.text3}`}>{s.k}</div>
                          <div className={`mt-0.5 whitespace-nowrap text-[15px] font-semibold ${mono} ${s.hot ? "text-[var(--vc)]" : c.text}`}>{s.v}</div>
                        </div>
                      ))}
                    </div>
                    {/* risk check pills — pass verdicts glanceable, details below */}
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {checks.length === 0 && <span className={`text-[11px] ${c.text3}`}>no risk checks recorded on this trace</span>}
                      {checks.map((ck, i) => (
                        <span
                          key={i}
                          title={ck.detail}
                          className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold whitespace-nowrap ${
                            ck.passed ? "text-[#2FC08E] bg-[#2FC08E]/10" : "text-[#F0525F] bg-[#F0525F]/10"
                          }`}
                        >
                          {ck.passed ? "✓" : "✗"} {ck.check.replace(/_/g, " ").toLowerCase()}
                        </span>
                      ))}
                    </div>
                    {/* provenance envelope (A-02) + footer */}
                    <div className={`mt-2.5 rounded-lg border px-3 py-2 text-[10.5px] ${c.border} bg-[#10151F] ${c.text3}`}>
                      <span>model <b className={c.text2}>{t.modelKey ?? "—"}</b></span>
                      <span className="ml-3">trigger <b className={c.text2}>{t.trigger ?? "—"}</b></span>
                      <span className="ml-3">strategy <b className={c.text2}>{t.strategyVersionId ? t.strategyVersionId.slice(0, 10) + "…" : "—"}</b> (C5)</span>
                      <span className="ml-3">trace <b className={c.text2}>{t.id.slice(0, 10)}…</b></span>
                    </div>
                    <div className={`mt-2 text-[11.5px] ${c.text2}`}>{t.reason}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* recent orders */}
      <div className={`${card} overflow-hidden`}>
        <div className="px-4 pt-3 pb-2 text-[13px] font-semibold">Recent orders</div>
        <div className="fd-scroll max-h-[240px] overflow-y-auto">
          {orders.length === 0 ? (
            <div className={`px-4 py-6 text-center text-[12px] ${c.text3}`}>No orders yet — this robot has not traded.</div>
          ) : (
            <table className="w-full">
              <thead className={`sticky top-0 ${c.surface}`}>
                <tr className={`border-b text-left text-[10px] tracking-wider ${c.border} ${c.text3}`}>
                  <th className="px-4 py-2 font-semibold">MARKET</th>
                  <th className="px-3 py-2 font-semibold">SIDE</th>
                  <th className="px-3 py-2 font-semibold">SIZE</th>
                  <th className="px-3 py-2 font-semibold">PRICE</th>
                  <th className="px-4 py-2 font-semibold">STATE</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className={`border-b text-[12px] last:border-0 ${c.border}`}>
                    <td className={`max-w-[260px] truncate px-4 py-2 ${c.text}`}>{o.market?.question}</td>
                    <td className={`px-3 py-2 whitespace-nowrap ${c.text2}`}>{o.side.replace("BUY_", "BUY ")}</td>
                    <td className={`px-3 py-2 whitespace-nowrap ${mono} ${c.text2}`}>{fmtCents(o.sizeCents)}</td>
                    <td className={`px-3 py-2 whitespace-nowrap ${mono} ${c.text2}`}>{o.priceCents}¢</td>
                    <td className="px-4 py-2"><StateChipInline state={o.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {robot.statusReason && (
        <div className={`flex flex-wrap items-center gap-3 rounded-lg border border-[#E3A63B]/40 bg-[#E3A63B]/10 px-4 py-3`}>
          <span className={`rounded bg-[#E3A63B]/20 px-2 py-1 text-[10px] font-bold tracking-wide ${c.warn}`}>STATUS NOTE</span>
          <span className={`text-[11.5px] ${c.text2}`}>{robot.statusReason}</span>
        </div>
      )}
      <div className={`text-center text-[10px] ${c.text3}`}>
        {status} · created {new Date(robot.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
      </div>
    </div>
  );
}

// local state chip (same palette as ui.StateChip — kept local so this file
// stays self-contained without widening ui.tsx's public surface)
function StateChipInline({ state }: { state: string }) {
  const map: Record<string, string> = {
    FILLED: `${c.gain} bg-[#2FC08E]/10`,
    OPEN: `${c.bright} bg-[#00B0F0]/10`,
    PARTIALLY_FILLED: `${c.bright} bg-[#00B0F0]/10`,
    SUBMITTED: `${c.accent} bg-[#3E9BF0]/10`,
    VALIDATED: `${c.accent} bg-[#3E9BF0]/10`,
    CREATED: c.text3 + " bg-[#121722]",
    CANCELLED: c.text3 + " bg-[#121722]",
    REJECTED: `${c.loss} bg-[#F0525F]/10`,
    EXPIRED: c.text3 + " bg-[#121722]",
    RECONCILING: `${c.warn} bg-[#E3A63B]/10`,
    UNKNOWN: `${c.warn} bg-[#E3A63B]/10`,
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap ${map[state] ?? c.text2}`}>
      {state === "UNKNOWN" || state === "RECONCILING" ? "⚠ " : ""}
      {state.replace("_", " ")}
    </span>
  );
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
