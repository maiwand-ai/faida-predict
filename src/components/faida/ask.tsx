"use client";

// Ask FAIDA — type any yes/no question about the future and see:
//   • what every venue's market says (price = the crowd's probability)
//   • FAIDA's own estimate: the AI when a provider is set up (with a short
//     explanation), otherwise the built-in estimator, clearly labeled as a
//     mechanical rule rather than an opinion
// Nothing is traded from here; it's a research tool anyone can use.

import { useState } from "react";
import { ArrowRight, Brain, Loader2, Sparkles } from "lucide-react";
import { VENUE_LABEL, venueColor } from "@/lib/venues";
import { Badge, btn } from "./ds";
import type { Nav } from "./shell";

type Match = { id: string; venue: string; question: string; yesPriceCents: number | null; noPriceCents: number | null; closeDate: string | null; match: number };
type AskResult = {
  question: string;
  matches: Match[];
  bestMarketId: string | null;
  estimate: null | { pct: number; kind: "AI" | "BUILT_IN"; basis: string; reasoning: string | null; provider: string | null; aboutMarket: boolean };
  aiAvailable: boolean;
};

const EXAMPLES = [
  "Will Trump be out as president before 2027?",
  "Will Bitcoin be above $150k by the end of 2026?",
  "Will the Fed cut rates at its next meeting?",
];

export function AskFaida({ onOpenMarket, onNavigate, compact = false }: { onOpenMarket: (id: string) => void; onNavigate: (n: Nav) => void; compact?: boolean }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AskResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setQ(text);
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: text }) });
      const j = (await r.json().catch(() => ({}))) as AskResult & { error?: string };
      if (!r.ok) { setErr(j.error ?? "Something went wrong. Try again."); setRes(null); }
      else setRes(j);
    } catch {
      setErr("Couldn't reach FAIDA. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const best = res?.matches.find((m) => m.id === res.bestMarketId) ?? null;
  const est = res?.estimate ?? null;
  const gap = est && est.kind === "AI" && best?.yesPriceCents != null ? est.pct - best.yesPriceCents : null;

  return (
    <section className="fd-glass relative overflow-hidden rounded-[28px] border border-[var(--fd-border)] bg-[var(--fd-surface)] p-5 sm:p-6">
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-25 blur-3xl" style={{ background: "var(--fd-brand-b)" }} />
      <div className="relative">
        <div className="flex items-center gap-2.5">
          <span className="fd-brand-bg grid h-9 w-9 place-items-center rounded-xl" aria-hidden><Sparkles size={18} /></span>
          <div>
            <h2 className="text-[18px] font-semibold text-[var(--fd-strong)]">Ask FAIDA</h2>
            {!compact && <p className="text-[13.5px] text-[var(--fd-text2)]">Ask any yes/no question about the future. See what every market says, and what FAIDA thinks.</p>}
          </div>
        </div>

        <form className="mt-4 flex flex-col gap-2.5 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Will Bitcoin be above $150k by the end of 2026?"
            aria-label="Your question"
            maxLength={300}
            className="h-12 min-w-0 flex-1 rounded-2xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] px-4 text-[15.5px] text-[var(--fd-strong)] placeholder:text-[var(--fd-text3)]"
          />
          <button type="submit" className={`${btn.primary} h-12 px-6`} disabled={busy || q.trim().length < 6}>
            {busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />} {busy ? "Thinking…" : "Ask"}
          </button>
        </form>
        {!res && !err && (
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => void ask(ex)} className="rounded-full border border-[var(--fd-border)] bg-[var(--fd-bg2)] px-3 py-1.5 text-[13px] text-[var(--fd-text-soft)] hover:border-[var(--fd-border2)]">{ex}</button>
            ))}
          </div>
        )}
        {err && <p className="mt-3 text-[14px] text-[var(--fd-red-text)]">{err}</p>}

        {res && (
          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            {/* FAIDA's view */}
            <div className="rounded-2xl bg-[var(--fd-bg2)] p-4">
              <div className="text-[13px] font-medium text-[var(--fd-text3)]">FAIDA&apos;s estimate</div>
              {est ? (
                <>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="font-[family-name:var(--font-space-grotesk)] text-[44px] font-bold leading-none text-[var(--fd-strong)]">{est.pct}%</span>
                    <span className="text-[14px] text-[var(--fd-text2)]">chance of YES</span>
                  </div>
                  <div className="mt-2">
                    {est.kind === "AI" ? <Badge tone="purple" dot>AI · {est.provider}</Badge> : <Badge tone="neutral">Built-in estimator</Badge>}
                  </div>
                  {est.kind === "BUILT_IN" && (
                    <p className="mt-2 text-[13px] leading-snug text-[var(--fd-text2)]">
                      This is a fixed rule (the market price nudged toward 50%), not an opinion. <button className="font-semibold text-[var(--fd-brand-text)] hover:underline" onClick={() => onNavigate({ view: "settings", tab: "ai" })}>Add an AI key</button> to get a real AI view with an explanation.
                    </p>
                  )}
                  {gap != null && Math.abs(gap) >= 3 && (
                    <p className="mt-2 text-[13.5px] font-medium text-[var(--fd-text)]">
                      {gap > 0 ? <>The AI thinks YES is <b className="text-[var(--fd-green-text)]">{gap} points more likely</b> than the market does.</> : <>The AI thinks YES is <b className="text-[var(--fd-red-text)]">{Math.abs(gap)} points less likely</b> than the market does.</>}
                    </p>
                  )}
                  {!est.aboutMarket && <p className="mt-2 text-[13px] text-[var(--fd-text2)]">No market FAIDA tracks asks exactly this, so there&apos;s no crowd price to compare with.</p>}
                </>
              ) : (
                <p className="mt-2 text-[14px] leading-snug text-[var(--fd-text-soft)]">
                  {res.matches.length === 0 ? "No market FAIDA tracks matches this question yet" : "No close enough market to estimate from"}
                  {res.aiAvailable ? ", and the AI couldn't answer right now. Try again shortly." : <>. <button className="font-semibold text-[var(--fd-brand-text)] hover:underline" onClick={() => onNavigate({ view: "settings", tab: "ai" })}>Add an AI key</button> to get an estimate for any question.</>}
                </p>
              )}
            </div>

            {/* reasoning + markets */}
            <div className="flex min-w-0 flex-col gap-3">
              {est?.reasoning && (
                <div className="rounded-2xl bg-[var(--fd-bg2)] p-4">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--fd-text3)]"><Brain size={14} /> Why</div>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-[var(--fd-text-soft)]">{est.reasoning}</p>
                  <p className="mt-2 text-[12px] text-[var(--fd-text3)]">From the AI&apos;s general knowledge. It doesn&apos;t read today&apos;s news, so check recent events yourself.</p>
                </div>
              )}
              <div className="rounded-2xl bg-[var(--fd-bg2)] p-4">
                <div className="text-[13px] font-medium text-[var(--fd-text3)]">What the markets say</div>
                {res.matches.length === 0 ? (
                  <p className="mt-1.5 text-[14px] text-[var(--fd-text2)]">No matching market on any venue FAIDA tracks. Refreshing markets may find new ones.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {res.matches.map((m) => (
                      <li key={m.id}>
                        <button onClick={() => onOpenMarket(m.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-[color:var(--fd-ink)]/[0.05]">
                          <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: venueColor(m.venue) }} aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium text-[var(--fd-strong)]">{m.question}</span>
                            <span className="block text-[12px] text-[var(--fd-text3)]">{VENUE_LABEL[m.venue] ?? m.venue}{m.closeDate ? ` · closes ${new Date(m.closeDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}{m.id === res.bestMarketId ? " · best match" : ""}</span>
                          </span>
                          <span className="fd-num rounded-lg bg-[#00D69A]/12 px-2 py-1 text-[13px] font-semibold text-[var(--fd-green-text)]">YES {m.yesPriceCents}¢</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="text-[12px] text-[var(--fd-text3)]">A price of 30¢ means the market thinks there&apos;s about a 30% chance. Estimates are not advice, and nothing is traded from here.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
