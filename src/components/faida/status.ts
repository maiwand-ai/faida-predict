// One plain-language answer to "is everything OK?" — shared by the status
// chip in the top bar, the Overview header and Safety › System check.
// Every issue says what is wrong and where to fix it.
import type { DashboardDTO } from "./types";
import type { Nav } from "./shell";
import { VENUES } from "@/lib/venues";

export type StatusIssue = { id: string; tone: "red" | "amber"; text: string; fix: string; to: Nav };

export type SystemStatus = {
  ok: boolean;
  tone: "green" | "amber" | "red";
  label: string;
  running: number;
  issues: StatusIssue[];
};

export const RUNNING_STATES = ["RUNNING", "PAPER_ONLY"];
export const OUTBOX_BACKLOG = 10;

export function systemStatus(dash: DashboardDTO | null): SystemStatus {
  if (!dash) return { ok: false, tone: "amber", label: "Connecting…", running: 0, issues: [] };
  const issues: StatusIssue[] = [];
  const running = dash.robots.filter((r) => RUNNING_STATES.includes(r.status)).length;

  if (dash.control?.pause.paused) {
    issues.push({ id: "paused", tone: "red", text: "Emergency stop is on: robots won't open trades.", fix: "Resume in Safety", to: { view: "risk", tab: "check" } });
  }
  const stuck = dash.orders.filter((o) => o.state === "UNKNOWN" || o.state === "RECONCILING").length;
  if (stuck > 0) {
    issues.push({ id: "stuck", tone: "amber", text: `${stuck} order${stuck === 1 ? "" : "s"} waiting for the venue to confirm.`, fix: "Fix stuck orders", to: { view: "trading", tab: "execution" } });
  }
  const errored = dash.robots.filter((r) => r.status === "ERROR" || r.status === "PAUSED_BY_RISK");
  if (errored.length > 0) {
    issues.push({ id: "robots", tone: "amber", text: `${errored.length} robot${errored.length === 1 ? " was" : "s were"} stopped by a safety limit or error.`, fix: "Review in Robots", to: { view: "robots" } });
  }
  const live = VENUES.filter((v) => v.adapter === "LIVE");
  const withData = live.filter((v) => (dash.venues.find((s) => s.venue === v.id)?.markets ?? 0) > 0).length;
  if (withData === 0) {
    issues.push({ id: "markets", tone: "amber", text: "No markets loaded yet, so robots have nothing to check.", fix: "Refresh markets", to: { view: "markets", tab: "trending" } });
  }
  // a few pending events are normal (they're delivered on the next market
  // check); only a growing backlog is worth the user's attention
  if ((dash.outboxPending ?? 0) >= OUTBOX_BACKLOG) {
    issues.push({ id: "outbox", tone: "amber", text: `${dash.outboxPending} background event${dash.outboxPending === 1 ? "" : "s"} still being delivered.`, fix: "See system details", to: { view: "risk", tab: "health" } });
  }

  const red = issues.some((i) => i.tone === "red");
  const robotsTxt = `${running} robot${running === 1 ? "" : "s"} running`;
  return {
    ok: issues.length === 0,
    tone: red ? "red" : issues.length ? "amber" : "green",
    label: issues.length === 0 ? `All systems OK · ${robotsTxt}` : `${issues.length} thing${issues.length === 1 ? "" : "s"} need${issues.length === 1 ? "s" : ""} attention`,
    running,
    issues,
  };
}

// plain-language one-liner for what a robot is doing right now
export function robotStateLine(status: string, reason: string | null, open: number): string {
  if (status === "PAUSED_BY_USER") return "Paused by you. It won't open new trades.";
  if (status === "PAUSED_BY_RISK") return `Stopped by a safety limit${reason ? `: ${reason}` : ""}. Review before resuming.`;
  if (status === "PAUSED_BY_AI_BUDGET") return "Paused: this month's AI budget is used up.";
  if (status === "ERROR") return `Stopped by an error${reason ? `: ${reason}` : ""}.`;
  if (status === "STOPPED") return "Stopped.";
  if (open > 0) return `In ${open} trade${open === 1 ? "" : "s"}, watching for the exit.`;
  return "Waiting for a good price to enter.";
}

// trace decision → plain words for the activity line
export function decisionWords(decision: string): string {
  const d = decision.toUpperCase();
  if (d.includes("NO_TRADE") || d.includes("SKIP") || d.includes("HOLD")) return "Skipped";
  if (d.includes("EXIT") || d.includes("CLOSE")) return "Closed a trade";
  if (d.includes("REFUSE") || d.includes("BLOCK")) return "Blocked by a safety check";
  return "Opened a trade";
}
