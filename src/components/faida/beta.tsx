"use client";

// Phase 10 — Beta Ops view (operator) + member feedback/status panel.
// The instrument set for the closed beta rounds (BETA_PHASE75 §2):
//   operator — cohort table, defect ladder (S0–S3), feedback inbox,
//              R-0 round snapshot, measurable exit bar
//   member   — own session count (exit-bar item 8), feedback form + own items
// Every number is measured from the tables; founder-host obligations render
// as honest FOUNDER_HOST rows (D-03 — never faked PASS).
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { c, card, mono } from "./ui";

// ── tolerant parse (same posture as the app shell, D-07) ────────────────────
async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface CohortMember {
  id: string;
  email: string;
  track: string;
  round: number;
  active: boolean;
  registered: boolean;
  notes: string | null;
}
interface CohortDTO {
  members: CohortMember[];
  mix: { total: number; paperOnly: number; livePilot: number; freeChoice: number; registered: number };
}
interface DefectDTO {
  id: string;
  round: number;
  severity: string;
  status: string;
  title: string;
  detail: string | null;
  owner: string | null;
  fixPhase: string | null;
  createdAt: string;
}
interface DefectsDTO {
  defects: DefectDTO[];
  openBySeverity: Record<string, number>;
  ladder: Record<string, { definition: string; response: string }>;
}
interface FeedbackDTO {
  items: Array<{ id: string; round: number; category: string; body: string; status: string; from: string | null; createdAt: string }>;
  openCount: number;
  scope: string;
}
interface SnapshotDTO {
  round: number;
  platform: {
    outbox: { pending: number; dispatchLagP95Ms: number | null };
    notifications24h: { delivered: number; suppressed: number };
    orders24h: { total: number; byState: Record<string, number> };
    marketFreshness: Array<{ venue: string; label: string; lastSyncMinAgo: number | null }>;
  };
  defects: { openTotal: number; openBySeverity: Record<string, number> };
  cohort: { activeMembers: number; registered: number; trackMix: Record<string, number> };
  signal: { membersQualifying: number; membersLinked: number; pct: number; bar: string };
  smoke: { lastInvariantSmokePass: string | null; lastRunbookDrill: string | null };
}
interface ExitBarDTO {
  items: Array<{ id: number; item: string; status: string; measured: Record<string, unknown>; source: string }>;
  summary: { pass: number; total: number; verdict: string };
}

const SEV_TONE: Record<string, string> = { S0: c.loss, S1: c.warn, S2: c.accent, S3: c.text3 };
const STATUS_TONE: Record<string, string> = { PASS: c.gain, HOLD: c.warn, STALE: c.warn, UNKNOWN: c.text3, FOUNDER_HOST: c.paper };

export function BetaView({ me, onToast }: { me: { id: string; email: string; role: string; name: string | null } | null; onToast: (t: { title: string; description?: string; variant?: "destructive" }) => void }) {
  const isOperator = me?.role === "OPERATOR";
  return (
    <div className="space-y-4">
      <div className={`rounded-xl border ${c.border} ${c.surface} px-4 py-3`}>
        <div className={`text-[13px] font-bold tracking-[0.15em] ${c.text3}`}>CLOSED BETA — PHASE 10 BETA OPS (R-02 PROGRAM)</div>
        <div className={`mt-1 text-[14px] ${c.text2}`}>
          Signed in as <span className={mono}>{me?.email ?? "unknown"}</span> · role <span className={mono}>{me?.role ?? "?"}</span>.
          {isOperator
            ? " Operator instruments: cohort, defect ladder, feedback, R-0 snapshot, exit bar. Program definition: docs/BETA_PHASE75.md."
            : " Submit what confused you, what broke, what you want — every item lands in the round ledger."}
        </div>
      </div>
      {isOperator ? <OperatorBeta onToast={onToast} /> : <MemberBeta me={me} onToast={onToast} />}
    </div>
  );
}

// ── operator instruments ─────────────────────────────────────────────────────

function OperatorBeta({ onToast }: { onToast: (t: { title: string; description?: string; variant?: "destructive" }) => void }) {
  const [cohort, setCohort] = useState<CohortDTO | null>(null);
  const [defects, setDefects] = useState<DefectsDTO | null>(null);
  const [feedback, setFeedback] = useState<FeedbackDTO | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotDTO | null>(null);
  const [exitBar, setExitBar] = useState<ExitBarDTO | null>(null);
  const [enrollEmail, setEnrollEmail] = useState("");
  const [enrollTrack, setEnrollTrack] = useState("FREE_CHOICE");
  const [defectForm, setDefectForm] = useState({ severity: "S2", title: "", detail: "", fixPhase: "" });

  const refresh = useCallback(async () => {
    try {
      const resC = await fetch("/api/beta/cohort");
      if (resC.ok) setCohort(await safeJson<CohortDTO>(resC));
      const resD = await fetch("/api/beta/defects");
      if (resD.ok) setDefects(await safeJson<DefectsDTO>(resD));
      const resF = await fetch("/api/beta/feedback");
      if (resF.ok) setFeedback(await safeJson<FeedbackDTO>(resF));
      const resS = await fetch("/api/beta/round-snapshot");
      if (resS.ok) setSnapshot(await safeJson<SnapshotDTO>(resS));
      const resX = await fetch("/api/beta/exit-bar");
      if (resX.ok) setExitBar(await safeJson<ExitBarDTO>(resX));
    } catch { /* transient — next poll/action recovers */ }
  }, []);
  useEffect(() => {
    // Every fetch below is awaited before setState — never a synchronous
    // cascading render; the lint rule cannot see through the awaited chain.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const post = async (url: string, body: unknown, okMsg: string, method = "POST") => {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await safeJson<Record<string, unknown>>(res);
    if (res.ok) { onToast({ title: okMsg }); refresh(); }
    else onToast({ title: "Refused", description: String(json?.error ?? "empty response"), variant: "destructive" });
  };

  return (
    <div className="space-y-4">
      {/* R-0 snapshot */}
      <div className={card}>
        <div className={`px-4 pt-3 text-[13px] font-bold tracking-[0.15em] ${c.text3}`}>R-0 ROUND SNAPSHOT {snapshot ? `· ROUND ${snapshot.round}` : ""}</div>
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
          <Stat label="Open defects" value={snapshot ? String(snapshot.defects.openTotal) : "—"} tone={snapshot && snapshot.defects.openBySeverity.S0 > 0 ? c.loss : undefined} />
          <Stat label="Cohort (registered/active)" value={snapshot ? `${snapshot.cohort.registered}/${snapshot.cohort.activeMembers}` : "—"} />
          <Stat label="Member signal (item 8)" value={snapshot ? `${snapshot.signal.pct}%` : "—"} tone={snapshot && snapshot.signal.pct >= 60 ? c.gain : c.warn} />
          <Stat label="Outbox pending" value={snapshot ? String(snapshot.platform.outbox.pending) : "—"} />
          <Stat label="Notifications 24h (delivered/suppressed)" value={snapshot ? `${snapshot.platform.notifications24h.delivered}/${snapshot.platform.notifications24h.suppressed}` : "—"} />
          <Stat label="Orders 24h" value={snapshot ? String(snapshot.platform.orders24h.total) : "—"} />
          <Stat label="Invariant smoke last PASS" value={snapshot?.smoke.lastInvariantSmokePass ? snapshot.smoke.lastInvariantSmokePass.slice(0, 10) : "never recorded"} tone={c.text3} />
          <Stat label="Runbook drill last PASS" value={snapshot?.smoke.lastRunbookDrill ? snapshot.smoke.lastRunbookDrill.slice(0, 10) : "never recorded"} tone={c.text3} />
        </div>
      </div>

      {/* Exit bar */}
      <div className={card}>
        <div className={`px-4 pt-3 text-[13px] font-bold tracking-[0.15em] ${c.text3}`}>
          EXIT BAR (BETA_PHASE75 §4) {exitBar ? `· ${exitBar.summary.pass}/${exitBar.summary.total} PASS · ${exitBar.summary.verdict}` : ""}
        </div>
        <div className="divide-y" style={{ borderColor: "var(--fd-border)" }}>
          {exitBar?.items.map((i) => (
            <div key={i.id} className="flex items-start gap-3 px-4 py-2.5">
              <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[12px] font-bold ${STATUS_TONE[i.status] ?? c.text3}`}>{i.status}</span>
              <div className="min-w-0 flex-1">
                <div className={`text-[14.5px] ${c.text}`}>{i.item}</div>
                <div className={`mt-0.5 text-[13px] ${c.text3}`} style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(i.measured, null, 0).slice(0, 220)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Defect ladder */}
      <div className={card}>
        <div className={`px-4 pt-3 text-[13px] font-bold tracking-[0.15em] ${c.text3}`}>
          DEFECT LADDER {defects ? `· open S0 ${defects.openBySeverity.S0} · S1 ${defects.openBySeverity.S1} · S2 ${defects.openBySeverity.S2} · S3 ${defects.openBySeverity.S3}` : ""}
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <div className="space-y-2">
            {defects?.defects.map((d) => (
              <div key={d.id} className={`rounded-lg border px-3 py-2 ${c.border} ${d.status === "OPEN" ? c.elevated : c.surface}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-[13px] font-bold ${SEV_TONE[d.severity] ?? c.text3}`}>{d.severity}</span>
                  <span className={`text-[14px] ${c.text}`}>{d.title}</span>
                  <span className={`ml-auto text-[12px] ${c.text3}`}>R{d.round} · {d.status}</span>
                </div>
                <div className={`mt-1 text-[13px] ${c.text3}`}>
                  {d.fixPhase ? `fix: ${d.fixPhase} · ` : ""}{d.owner ? `owner: ${d.owner} · ` : ""}{d.createdAt.slice(0, 10)}
                </div>
                {d.status === "OPEN" && (
                  <div className="mt-1.5 flex gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-[13px]" onClick={() => post("/api/beta/defects", { id: d.id, status: "FIXED" }, `Defect ${d.severity} closed`)}>Mark FIXED</Button>
                  </div>
                )}
              </div>
            ))}
            {defects && defects.defects.length === 0 && <div className={`text-[14px] ${c.text3}`}>No defects recorded yet — round triage (R-2) records them here.</div>}
          </div>
          <div className="space-y-2">
            <div className={`rounded-lg border px-3 py-2 ${c.border} ${c.elevated}`}>
              <div className={`text-[14px] font-bold ${c.text2}`}>Record a defect (R-2 triage)</div>
              <div className="mt-2 flex gap-2">
                <select value={defectForm.severity} onChange={(e) => setDefectForm({ ...defectForm, severity: e.target.value })} className={`h-8 rounded-md border bg-transparent px-2 text-[14px] ${c.border} ${c.text}`} aria-label="Severity">
                  {["S0", "S1", "S2", "S3"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <Input className="h-8 flex-1 text-[14px]" placeholder="title" value={defectForm.title} onChange={(e) => setDefectForm({ ...defectForm, title: e.target.value })} />
              </div>
              <Input className="mt-2 h-8 text-[14px]" placeholder="detail (what happened, where)" value={defectForm.detail} onChange={(e) => setDefectForm({ ...defectForm, detail: e.target.value })} />
              <div className="mt-2 flex gap-2">
                <Input className="h-8 flex-1 text-[14px]" placeholder="fix phase (e.g. Phase 11)" value={defectForm.fixPhase} onChange={(e) => setDefectForm({ ...defectForm, fixPhase: e.target.value })} />
                <Button size="sm" className="h-8 text-[13px]" disabled={!defectForm.title.trim()} onClick={() => post("/api/beta/defects", { ...defectForm, source: "OPERATOR" }, defectForm.severity === "S0" ? "S0 recorded — STOP THE ROUND (C19 pause + CRITICAL notification fired)" : "Defect recorded")}>Record</Button>
              </div>
              <div className={`mt-2 text-[12.5px] ${c.text3}`}>S0 = money risk → STOP the round, global pause; an S0 fires an uncapped CRITICAL notification (P-04).</div>
            </div>
          </div>
        </div>
      </div>

      {/* Cohort */}
      <div className={card}>
        <div className={`px-4 pt-3 text-[13px] font-bold tracking-[0.15em] ${c.text3}`}>
          COHORT {cohort ? `· ${cohort.mix.registered}/${cohort.mix.total} registered · paper ${cohort.mix.paperOnly} · live ${cohort.mix.livePilot} · free ${cohort.mix.freeChoice}` : ""}
        </div>
        <div className="p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <Input className="h-8 w-56 text-[14px]" placeholder="email to enroll" value={enrollEmail} onChange={(e) => setEnrollEmail(e.target.value)} />
            <select value={enrollTrack} onChange={(e) => setEnrollTrack(e.target.value)} className={`h-8 rounded-md border bg-transparent px-2 text-[14px] ${c.border} ${c.text}`} aria-label="Track">
              {["FREE_CHOICE", "PAPER_ONLY", "LIVE_PILOT"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Button size="sm" className="h-8 text-[13px]" disabled={!enrollEmail.includes("@")} onClick={() => post("/api/beta/cohort", { email: enrollEmail, track: enrollTrack }, "Enrolled — registration consumes the row")}>Enroll</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead><tr className={`${c.text3}`}>
                <th className="py-1 pr-3 font-medium">Email</th><th className="py-1 pr-3 font-medium">Track</th><th className="py-1 pr-3 font-medium">Round</th><th className="py-1 pr-3 font-medium">Status</th><th className="py-1 font-medium"></th>
              </tr></thead>
              <tbody>
                {cohort?.members.map((m) => (
                  <tr key={m.id} className="border-t" style={{ borderColor: "var(--fd-border)" }}>
                    <td className={`py-1.5 pr-3 ${c.text}`}>{m.email}</td>
                    <td className={`py-1.5 pr-3 ${c.text2}`}>{m.track}</td>
                    <td className={`py-1.5 pr-3 ${c.text3}`}>R{m.round}</td>
                    <td className={`py-1.5 pr-3 ${m.active ? c.gain : c.text3}`}>{m.active ? (m.registered ? "ACTIVE · registered" : "ACTIVE · invited") : "DEACTIVATED"}</td>
                    <td className="py-1.5">
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[12px]" onClick={() => post("/api/beta/cohort", { id: m.id, active: !m.active }, m.active ? "Enrollment deactivated" : "Enrollment re-activated", "PATCH")}>
                        {m.active ? "Deactivate" : "Activate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cohort && cohort.members.length === 0 && <div className={`text-[14px] ${c.text3}`}>No enrollments yet — enroll the first cohort emails (10 to start, BETA_PHASE75 §1).</div>}
          </div>
        </div>
      </div>

      {/* Feedback inbox */}
      <div className={card}>
        <div className={`px-4 pt-3 text-[13px] font-bold tracking-[0.15em] ${c.text3}`}>FEEDBACK INBOX {feedback ? `· ${feedback.openCount} open · scope ${feedback.scope}` : ""}</div>
        <div className="space-y-2 p-4">
          {feedback?.items.map((f) => (
            <div key={f.id} className={`rounded-lg border px-3 py-2 ${c.border} ${c.elevated}`}>
              <div className="flex items-center gap-2 text-[13px]">
                <span className={c.accent}>{f.category}</span>
                <span className={c.text3}>R{f.round} · {f.from ?? "member"} · {f.createdAt.slice(0, 10)}</span>
                <span className={`ml-auto font-bold ${f.status === "NEW" ? c.warn : f.status === "DONE" ? c.gain : c.text2}`}>{f.status}</span>
              </div>
              <div className={`mt-1 text-[14.5px] ${c.text}`}>{f.body}</div>
              {f.status !== "DONE" && (
                <div className="mt-1.5 flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-[13px]" onClick={() => post("/api/beta/feedback", { id: f.id, status: f.status === "NEW" ? "TRIAGED" : "DONE" }, "Feedback triaged", "PATCH")}>
                    {f.status === "NEW" ? "Triage" : "Done"}
                  </Button>
                </div>
              )}
            </div>
          ))}
          {feedback && feedback.items.length === 0 && <div className={`text-[14px] ${c.text3}`}>No feedback yet — R-1 cohort sessions append here.</div>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${c.border} ${c.elevated}`}>
      <div className={`text-[12px] tracking-wide ${c.text3}`}>{label}</div>
      <div className={`mt-0.5 text-[16px] font-bold ${tone ?? c.text}`}>{value}</div>
    </div>
  );
}

// ── member panel ─────────────────────────────────────────────────────────────

function MemberBeta({ me, onToast }: { me: { id: string; email: string; role: string; name: string | null } | null; onToast: (t: { title: string; description?: string; variant?: "destructive" }) => void }) {
  const [mine, setMine] = useState<FeedbackDTO | null>(null);
  const [category, setCategory] = useState("OTHER");
  const [body, setBody] = useState("");
  const [sessionCount, setSessionCount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/beta/feedback");
      if (res.ok) setMine(await safeJson<FeedbackDTO>(res));
    } catch { /* transient */ }
  }, []);
  useEffect(() => {
    // Every fetch below is awaited before setState — never a synchronous
    // cascading render; the lint rule cannot see through the awaited chain.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    // own robot-session count — the closest member-visible proxy; the operator
    // snapshot measures the real exit-bar number from RobotSession.
    (async () => {
      try {
        const res = await fetch("/api/dashboard");
        const d = res.ok ? await safeJson<{ robots?: Array<{ id: string }> }>(res) : null;
        if (d) setSessionCount(d.robots?.length ?? 0);
      } catch { setSessionCount(null); }
    })();
  }, []);

  const submit = async () => {
    const res = await fetch("/api/beta/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category, body }) });
    const json = await safeJson<Record<string, unknown>>(res);
    if (res.ok) { onToast({ title: "Feedback recorded — it lands in the round ledger" }); setBody(""); refresh(); }
    else onToast({ title: "Refused", description: String(json?.error ?? "empty response"), variant: "destructive" });
  };

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className={`px-4 pt-3 text-[13px] font-bold tracking-[0.15em] ${c.text3}`}>YOUR PROGRESS (exit-bar item 8: ≥3 sessions, ≥1 feedback item)</div>
        <div className="flex gap-3 p-4">
          <div className={`rounded-lg border px-4 py-3 ${c.border} ${c.elevated}`}>
            <div className={`text-[12px] ${c.text3}`}>Robots created</div>
            <div className={`text-[24px] font-bold ${mono} ${(sessionCount ?? 0) >= 3 ? c.gain : c.warn}`}>{sessionCount ?? "—"}</div>
          </div>
          <div className={`rounded-lg border px-4 py-3 ${c.border} ${c.elevated}`}>
            <div className={`text-[12px] ${c.text3}`}>Feedback items</div>
            <div className={`text-[24px] font-bold ${mono} ${(mine?.items.length ?? 0) >= 1 ? c.gain : c.warn}`}>{mine?.items.length ?? 0}</div>
          </div>
        </div>
      </div>

      <div className={card}>
        <div className={`px-4 pt-3 text-[13px] font-bold tracking-[0.15em] ${c.text3}`}>SUBMIT FEEDBACK (R-1)</div>
        <div className="space-y-2 p-4">
          <div className="flex gap-2">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={`h-8 rounded-md border bg-transparent px-2 text-[14px] ${c.border} ${c.text}`} aria-label="Category">
              {["BUG", "CONFUSION", "FEATURE", "OTHER"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Label className="sr-only" htmlFor="beta-feedback">Feedback</Label>
            <Input id="beta-feedback" className="h-8 flex-1 text-[14px]" placeholder="what confused you / what broke / what you want" value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <Button size="sm" className="h-8 text-[13px]" disabled={!body.trim()} onClick={submit}>Submit</Button>
        </div>
      </div>

      <div className={card}>
        <div className={`px-4 pt-3 text-[13px] font-bold tracking-[0.15em] ${c.text3}`}>YOUR ITEMS</div>
        <div className="space-y-2 p-4">
          {mine?.items.map((f) => (
            <div key={f.id} className={`rounded-lg border px-3 py-2 ${c.border} ${c.elevated}`}>
              <div className="flex items-center gap-2 text-[13px]">
                <span className={c.accent}>{f.category}</span>
                <span className={`ml-auto font-bold ${f.status === "DONE" ? c.gain : f.status === "TRIAGED" ? c.text2 : c.warn}`}>{f.status}</span>
              </div>
              <div className={`mt-1 text-[14.5px] ${c.text}`}>{f.body}</div>
            </div>
          ))}
          {mine && mine.items.length === 0 && <div className={`text-[14px] ${c.text3}`}>Nothing submitted yet.</div>}
        </div>
      </div>
    </div>
  );
}
