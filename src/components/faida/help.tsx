"use client";

// FAIDA Predict — Help: "where, what and how".
//   1. Which markets can I use?  — pick a country, see each venue's status
//      (defaults to the signed-in user's country)
//   2. Venue guides              — what each venue is, its money, how to
//      connect, fees, official terms, when the rules were last checked
//   3. Common questions
//   4. Operator-only: confirm or change a venue's status for a country when
//      a venue changes its rules (stored as an override, audited by who/when)
// Guidance, not legal advice: every row links the venue's own terms.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ExternalLink, Globe2, HelpCircle, ShieldCheck } from "lucide-react";
import {
  COUNTRIES, countryName, LAST_CHECKED, STATUS_LABEL, VENUE_GUIDES, venueAvailability,
  type Availability, type AvailabilityOverrides, type AvailabilityStatus,
} from "@/lib/venue/availability";
import { VENUES } from "@/lib/venues";
import { Badge, btn, PageHeader, Panel } from "./ds";

export const STATUS_TONE: Record<AvailabilityStatus, string> = { OPEN: "green", CHECK: "amber", CLOSE_ONLY: "amber", BLOCKED: "red" };

type AvailabilityPayload = { country: string; venues: Availability[]; overrides: AvailabilityOverrides };

/** The signed-in user's country + per-venue availability (operator overrides applied). */
export function useAvailability() {
  const [data, setData] = useState<AvailabilityPayload | null>(null);
  const load = useCallback(() => fetch("/api/availability").then((r) => (r.ok ? r.json() : null)).then((j: AvailabilityPayload | null) => j && setData(j)).catch(() => undefined), []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);
  return { data, reload: load };
}

export function availabilityFor(data: AvailabilityPayload | null, venue: string): Availability | null {
  return data?.venues.find((v) => v.venue === venue) ?? null;
}

export function HelpView({ isOperator, onToast }: { isOperator: boolean; onToast: (t: { title: string; description?: string; variant?: "destructive" }) => void }) {
  const { data, reload } = useAvailability();
  const [picked, setPicked] = useState<string | null>(null);
  const country = picked ?? data?.country ?? "";
  const overrides = data?.overrides ?? {};
  const rows = VENUE_GUIDES.map((g) => ({ g, a: venueAvailability(g.venue, country, overrides), def: VENUES.find((v) => v.id === g.venue) }));
  const mine = !picked || picked === data?.country;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={<HelpCircle size={24} />} title="Help" subtitle="Where you can trade, what each market is, and how to get started." />

      {/* 1. checker */}
      <Panel
        title="Which markets can I use?"
        icon={<Globe2 size={18} />}
        subtitle={mine ? `Showing your country: ${countryName(country)}. Pick another to compare.` : `Showing ${countryName(country)}. Your account country is ${countryName(data?.country ?? "")}.`}
        action={
          <select aria-label="Country" value={country} onChange={(e) => setPicked(e.target.value)} className="h-10 rounded-xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] px-3 text-[14px] text-[var(--fd-text)]">
            {!COUNTRIES.some(([c]) => c === country) && country && <option value={country}>{country}</option>}
            {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rows.map(({ g, a, def }) => (
            <div key={g.venue} className="rounded-2xl bg-[var(--fd-bg2)] p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[15px] font-bold text-[#071018]" style={{ background: def?.hex ?? "#7C889B" }} aria-hidden>{(def?.label ?? g.venue).slice(0, 1)}</span>
                <span className="min-w-0 flex-1 text-[16px] font-semibold text-[var(--fd-strong)]">{def?.label ?? g.venue}</span>
                <Badge tone={STATUS_TONE[a.status]} dot>{STATUS_LABEL[a.status]}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
                <Pill ok={a.practice}>Practice money</Pill>
                {g.realMoney ? <Pill ok={a.realMoney}>Real money</Pill> : <span className="rounded-full bg-[color:var(--fd-ink)]/[0.06] px-2.5 py-1 text-[var(--fd-text2)]">Play money only</span>}
              </div>
              <p className="mt-2.5 text-[13.5px] leading-snug text-[var(--fd-text2)]">{a.note}{a.overridden ? " (confirmed by the FAIDA team)" : ""}</p>
              <a href={g.officialTerms} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--fd-brand-text)] hover:underline">
                {def?.label}&apos;s own terms <ExternalLink size={13} />
              </a>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-2xl border border-[var(--fd-border)] p-3.5 text-[13px] leading-relaxed text-[var(--fd-text2)]">
          <b className="text-[var(--fd-text)]">How to read this.</b> <b>Available</b>: you can use real money. <b>Check first</b>: sources disagree or the venue leaves it to you, so practice is open and real money stays locked until confirmed. <b>Close only</b>: you can exit positions but not open new ones. <b>Not available</b>: the venue doesn&apos;t serve this country.
          Rules last checked {LAST_CHECKED}. Venues change their lists without notice, so always confirm in the venue&apos;s own terms. This is guidance, not legal advice.
        </div>
      </Panel>

      {/* 2. guides */}
      <section>
        <h2 className="mb-3 px-1 text-[20px] font-semibold text-[var(--fd-strong)]">Market guides</h2>
        <div className="flex flex-col gap-3">
          {VENUE_GUIDES.map((g) => {
            const def = VENUES.find((v) => v.id === g.venue);
            return (
              <Accordion key={g.venue} title={def?.label ?? g.venue} hex={def?.hex} sub={g.realMoney ? "Real-money market" : "Play-money market"}>
                <Field k="What it is">{g.what}</Field>
                <Field k="Money">{g.money}</Field>
                <Field k="How to get started">
                  <ol className="ml-4 list-decimal space-y-1">{g.connect.map((s) => <li key={s}>{s}</li>)}</ol>
                </Field>
                <Field k="Fees">{g.fees}</Field>
                <Field k="Where">{g.defaultNote}</Field>
                <Field k="Official links">
                  <span className="flex flex-wrap gap-x-4 gap-y-1">
                    <a className="inline-flex items-center gap-1 font-semibold text-[var(--fd-brand-text)] hover:underline" href={g.officialTerms} target="_blank" rel="noreferrer">Terms <ExternalLink size={13} /></a>
                    <a className="inline-flex items-center gap-1 font-semibold text-[var(--fd-brand-text)] hover:underline" href={g.helpUrl} target="_blank" rel="noreferrer">Help & docs <ExternalLink size={13} /></a>
                  </span>
                </Field>
                <Field k="Last checked">{g.lastChecked} · {g.sources.length} source{g.sources.length === 1 ? "" : "s"}</Field>
              </Accordion>
            );
          })}
        </div>
      </section>

      {/* 3. FAQ */}
      <section>
        <h2 className="mb-3 px-1 text-[20px] font-semibold text-[var(--fd-strong)]">Common questions</h2>
        <div className="flex flex-col gap-3">
          {FAQ.map(([q, a]) => <Accordion key={q} title={q}><p className="text-[14.5px] leading-relaxed text-[var(--fd-text-soft)]">{a}</p></Accordion>)}
        </div>
      </section>

      {isOperator && <OperatorAvailability overrides={overrides} onSaved={() => { void reload(); }} onToast={onToast} />}
    </div>
  );
}

const FAQ: Array<[string, string]> = [
  ["What's the difference between practice money and real money?", "Practice money is simulated: robots trade real markets at real prices, but no money moves. Every robot starts in practice. Real money is only possible on a venue that's available in your country, after you connect your own account, record your consent and every safety check passes."],
  ["How does a robot decide to bet?", "Each robot estimates the chance an event happens and compares it with the market price. It only bets when the gap is big enough after fees, and every bet must pass the safety checks (fresh prices, enough liquidity, your loss limits). Every decision is saved with its reason in the Activity log."],
  ["Who holds my money?", "FAIDA never holds your money or your keys. On Polymarket and Limitless your funds stay in your own wallet; on Kalshi they stay in your Kalshi account. FAIDA only places orders you've authorised, within the limits you set."],
  ["What happens if something goes wrong?", "Use Safety › Emergency stop: every robot stops opening trades at once. Robots also stop by themselves when they hit your daily loss limit or drawdown limit."],
  ["Why is a venue 'Check first' for my country?", "Because public sources disagree about it, or the venue leaves it to you to check your local rules. You can practice there freely; real money stays locked until the FAIDA team confirms your country with the venue's own terms."],
  ["How do I get alerts on my phone?", "Connect Telegram in Settings › Notifications. You choose what you hear about: trades opening and closing, problems (like an emergency stop or a stuck order), and markets you hold that close within 24 hours."],
  ["Is this legal where I live?", "That depends on your country and changes over time. FAIDA follows each venue's published restrictions and blocks sanctioned countries everywhere, but it can't give legal advice. Check the venue's terms, and your local rules, before using real money."],
];

function Pill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`rounded-full px-2.5 py-1 font-medium ${ok ? "bg-[#00D69A]/14 text-[var(--fd-green-text)]" : "bg-[#FF5268]/12 text-[var(--fd-red-text)]"}`}>
      {ok ? "✓" : "✕"} {children}
    </span>
  );
}

function Field({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-t border-[var(--fd-line)] py-3 first:border-t-0 sm:grid-cols-[180px_minmax(0,1fr)]">
      <div className="text-[13.5px] font-medium text-[var(--fd-text3)]">{k}</div>
      <div className="text-[14.5px] leading-relaxed text-[var(--fd-text-soft)]">{children}</div>
    </div>
  );
}

function Accordion({ title, sub, hex, children }: { title: string; sub?: string; hex?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fd-glass overflow-hidden rounded-3xl border border-[var(--fd-border)] bg-[var(--fd-surface)]">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[color:var(--fd-ink)]/[0.03]">
        {hex && <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: hex }} aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold text-[var(--fd-strong)]">{title}</span>
          {sub && <span className="block text-[13px] text-[var(--fd-text2)]">{sub}</span>}
        </span>
        <ChevronDown size={18} className={`shrink-0 text-[var(--fd-text3)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
}

function OperatorAvailability({ overrides, onSaved, onToast }: { overrides: AvailabilityOverrides; onSaved: () => void; onToast: (t: { title: string; description?: string; variant?: "destructive" }) => void }) {
  const [venue, setVenue] = useState(VENUE_GUIDES[0].venue);
  const [country, setCountry] = useState("DE");
  const [status, setStatus] = useState<AvailabilityStatus | "">("OPEN");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const current = venueAvailability(venue, country, overrides);
  const sel = "h-10 rounded-xl border border-[var(--fd-border)] bg-[var(--fd-bg2)] px-3 text-[14px] text-[var(--fd-text)]";
  const save = async (clear = false) => {
    setBusy(true);
    try {
      const res = await fetch("/api/availability", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ venue, country, status: clear ? null : status, note }) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && j.ok) { onToast({ title: clear ? "Back to the researched default" : "Availability updated", description: `${venue} · ${countryName(country)}` }); onSaved(); setNote(""); }
      else onToast({ title: "Refused", description: j.error ?? "try again", variant: "destructive" });
    } finally { setBusy(false); }
  };
  const list = Object.entries(overrides).flatMap(([v, m]) => Object.entries(m).map(([c, o]) => ({ v, c, ...o })));
  return (
    <Panel title="Operators: confirm availability" icon={<ShieldCheck size={18} />} subtitle="When a venue changes its country rules, record it here. Real money follows this immediately. Sanctioned countries can't be changed.">
      <div className="flex flex-wrap items-end gap-2.5">
        <select aria-label="Venue" className={sel} value={venue} onChange={(e) => setVenue(e.target.value)}>{VENUE_GUIDES.map((g) => <option key={g.venue} value={g.venue}>{VENUES.find((v) => v.id === g.venue)?.label ?? g.venue}</option>)}</select>
        <select aria-label="Country" className={sel} value={country} onChange={(e) => setCountry(e.target.value)}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
        <select aria-label="Status" className={sel} value={status} onChange={(e) => setStatus(e.target.value as AvailabilityStatus)}>
          {(["OPEN", "CHECK", "CLOSE_ONLY", "BLOCKED"] as AvailabilityStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <input aria-label="Note" className={`${sel} min-w-[220px] flex-1`} placeholder="Why (e.g. confirmed in Kalshi member agreement, 2026-12-01)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className={btn.primary} disabled={busy} onClick={() => save(false)}>Save</button>
        {current.overridden && <button className={btn.secondary} disabled={busy} onClick={() => save(true)}>Reset</button>}
      </div>
      <p className="mt-2 text-[13px] text-[var(--fd-text2)]">Now: <Badge tone={STATUS_TONE[current.status]} dot>{STATUS_LABEL[current.status]}</Badge> {current.overridden ? "(override)" : "(researched default)"}</p>
      {list.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5 text-[13.5px]">
          {list.map((o) => (
            <li key={`${o.v}${o.c}`} className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--fd-bg2)] px-3 py-2">
              <b className="text-[var(--fd-strong)]">{VENUES.find((v) => v.id === o.v)?.label ?? o.v} · {countryName(o.c)}</b>
              <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
              <span className="min-w-0 flex-1 truncate text-[var(--fd-text2)]">{o.note}</span>
              <span className="text-[12px] text-[var(--fd-text3)]">{o.by} · {o.at?.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
