"use client";

// FAIDA Predict — Safety › System check. The first tab of the Safety page:
// every readiness check in plain words with a link to fix it, and the
// emergency stop (always confirmed, never one stray click away).

import { AlertTriangle, CheckCircle2, Zap } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { DashboardDTO } from "./types";
import type { Nav } from "./shell";
import { Badge, btn, Panel } from "./ds";
import { OUTBOX_BACKLOG, systemStatus } from "./status";

export function SystemCheck({ dash, busy, onNavigate, onStop, onResume }: {
  dash: DashboardDTO;
  busy: boolean;
  onNavigate: (n: Nav) => void;
  onStop: () => void;
  onResume: () => void;
}) {
  const st = systemStatus(dash);
  const paused = dash.control?.pause.paused ?? false;
  const marketsLoaded = dash.venues.reduce((a, v) => a + v.markets, 0);
  const stuck = dash.orders.filter((o) => o.state === "UNKNOWN" || o.state === "RECONCILING").length;
  const hurt = dash.robots.some((r) => r.status === "ERROR" || r.status === "PAUSED_BY_RISK");
  const auto = dash.control?.autopilot;

  const checks: Array<{ ok: boolean; text: string; fix?: { label: string; to: Nav } }> = [
    { ok: !paused, text: paused ? "Emergency stop is on. Robots won't open trades." : "Emergency stop is off." },
    { ok: marketsLoaded > 0, text: marketsLoaded > 0 ? `${marketsLoaded} markets loaded.` : "No markets loaded yet.", fix: { label: "Load markets", to: { view: "markets", tab: "trending" } } },
    { ok: st.running > 0, text: st.running > 0 ? `${st.running} robot${st.running === 1 ? "" : "s"} running.` : "No robot is running.", fix: { label: "Go to Robots", to: { view: "robots" } } },
    { ok: stuck === 0, text: stuck === 0 ? "No orders stuck waiting on a venue." : `${stuck} order${stuck === 1 ? "" : "s"} waiting for the venue to confirm.`, fix: { label: "Fix stuck orders", to: { view: "trading", tab: "execution" } } },
    { ok: !hurt, text: hurt ? "A robot was stopped by a safety limit or error." : "No robot stopped by a safety limit.", fix: { label: "Review robots", to: { view: "robots" } } },
    { ok: (dash.outboxPending ?? 0) < OUTBOX_BACKLOG, text: (dash.outboxPending ?? 0) === 0 ? "Background events delivered." : (dash.outboxPending ?? 0) < OUTBOX_BACKLOG ? `${dash.outboxPending} background event${dash.outboxPending === 1 ? "" : "s"} queued; delivered at the next market check.` : `${dash.outboxPending} background events are backing up.`, fix: { label: "System details", to: { view: "risk", tab: "health" } } },
    { ok: !!auto?.enabled, text: auto?.enabled ? `Autopilot on: robots check markets every ${auto.intervalSec}s.` : "Autopilot is off: robots only check markets when you ask.", fix: { label: "Turn on in Overview", to: { view: "overview" } } },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel title="System check" subtitle="Is everything ready to trade? Anything not ready says how to fix it." action={<Badge tone={st.tone} dot>{st.ok ? "All good" : `${st.issues.length} to fix`}</Badge>}>
        <ul className="flex flex-col gap-1">
          {checks.map((c) => (
            <li key={c.text} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-2 py-2.5 text-[14.5px]">
              {c.ok ? <CheckCircle2 size={18} className="shrink-0 text-[var(--fd-green-text)]" /> : <AlertTriangle size={18} className="shrink-0 text-[var(--fd-amber-text)]" />}
              <span className="min-w-0 flex-1 text-[var(--fd-text)]">{c.text}</span>
              {!c.ok && c.fix && (
                <button className="text-[13.5px] font-semibold text-[var(--fd-brand-text)] hover:underline" onClick={() => onNavigate(c.fix!.to)}>{c.fix.label} →</button>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Emergency stop" icon={<Zap size={18} />}>
        {paused ? (
          <>
            <p className="text-[14.5px] leading-relaxed text-[var(--fd-text-soft)]">Everything is stopped{dash.control?.pause.reason ? ` (${dash.control.pause.reason})` : ""}. Robots won&apos;t open new trades until you resume.</p>
            <button className={`${btn.primary} mt-4 w-full`} onClick={onResume} disabled={busy}>Resume trading</button>
          </>
        ) : (
          <>
            <p className="text-[14.5px] leading-relaxed text-[var(--fd-text-soft)]">For emergencies: stops every robot from opening trades and turns autopilot off. Open trades stay open. You&apos;ll be asked to confirm.</p>
            <button className={`${btn.danger} mt-4 w-full`} onClick={onStop} disabled={busy}><Zap size={16} /> Stop everything</button>
          </>
        )}
      </Panel>
    </div>
  );
}

export function EmergencyStopDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (v: boolean) => void; onConfirm: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="fd-glass-strong rounded-3xl border-[var(--fd-border2)] text-[var(--fd-text)]">
        <AlertDialogHeader>
          <AlertDialogTitle>Stop all robots?</AlertDialogTitle>
          <AlertDialogDescription className="text-[var(--fd-text2)]">
            Every robot stops opening new trades and autopilot stops. Trades already open stay open; you can close them from Portfolio. You can resume at any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={btn.secondary}>Cancel</AlertDialogCancel>
          <AlertDialogAction className={btn.danger} onClick={onConfirm}>Stop everything</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
