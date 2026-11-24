"use client";

// Markets › Price gaps — the same event priced differently on two venues.
// Read-only research. A "locked-in" combo is shown only as conditional:
// venues can word or settle the "same" event differently, so it is never
// presented as risk-free.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeftRight, RefreshCw } from "lucide-react";
import { VENUE_LABEL, venueColor } from "@/lib/venues";
import { Badge, btn, EmptyState, Panel } from "./ds";
import { availabilityFor, useAvailability } from "./help";

type Side = { id: string; venue: string; question: string; yesPriceCents: number; noPriceCents: number; closeDate: string | null };
type Gap = { key: string; a: Side; b: Side; match: number; gapPts: number; lockIn: { buyYesOn: string; buyNoOn: string; costCents: number; feesCents: number; profitCents: number } | null };

export function PriceGaps({ onOpenMarket, onSync, busy }: { onOpenMarket: (id: string) => void; onSync: () => void; busy: string | null }) {
  const [data, setData] = useState<{ gaps: Gap[]; scanned: number } | null>(null);
  const { data: avail } = useAvailability();
  const load = useCallback(() => fetch("/api/price-gaps").then((r) => (r.ok ? r.json() : null)).then((j) => j && setData(j)).catch(() => undefined), []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Price gaps between venues"
        icon={<ArrowLeftRight size={18} />}
        subtitle="The same event, priced differently on Polymarket, Kalshi and Limitless. Bigger gaps mean the venues disagree more."
        action={<button className={btn.small} onClick={() => { onSync(); setTimeout(() => void load(), 4000); }} disabled={busy === "sync"}><RefreshCw size={14} className={busy === "sync" ? "animate-spin" : ""} /> Refresh</button>}
      >
        {!data ? (
          <div className="h-24 animate-pulse rounded-2xl bg-[var(--fd-elevated)]" />
        ) : data.gaps.length === 0 ? (
          <EmptyState
            compact
            icon={<ArrowLeftRight size={22} />}
            title="No matching events across venues right now"
            body={`FAIDA compared ${data.scanned} open markets and found none listed on two venues at once. Right now each venue focuses on different events; gaps appear here as soon as the same question is listed on two of them.`}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {data.gaps.map((g) => {
              const realBoth = [g.a.venue, g.b.venue].every((v) => availabilityFor(avail, v)?.realMoney);
              return (
                <li key={g.key} className="rounded-2xl bg-[var(--fd-bg2)] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={g.gapPts >= 10 ? "amber" : "neutral"}>{g.gapPts} pt gap</Badge>
                    <span className="text-[12.5px] text-[var(--fd-text3)]">{g.match}% title match</span>
                    {g.lockIn && <Badge tone="green" dot>{g.lockIn.profitCents.toFixed(1)}¢ per $1 if both settle alike</Badge>}
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {[g.a, g.b].map((s) => (
                      <button key={s.id} onClick={() => onOpenMarket(s.id)} className="flex items-center gap-3 rounded-xl border border-[var(--fd-border)] px-3 py-2.5 text-left hover:border-[var(--fd-border2)]">
                        <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: venueColor(s.venue) }} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-semibold" style={{ color: venueColor(s.venue) }}>{VENUE_LABEL[s.venue] ?? s.venue}</span>
                          <span className="block truncate text-[14px] text-[var(--fd-strong)]">{s.question}</span>
                        </span>
                        <span className="fd-num text-right text-[13px]"><span className="block text-[var(--fd-green-text)]">YES {s.yesPriceCents}¢</span><span className="block text-[var(--fd-red-text)]">NO {s.noPriceCents}¢</span></span>
                      </button>
                    ))}
                  </div>
                  {g.lockIn && (
                    <p className="mt-2.5 text-[13px] leading-snug text-[var(--fd-text2)]">
                      Buying YES on {VENUE_LABEL[g.lockIn.buyYesOn]} and NO on {VENUE_LABEL[g.lockIn.buyNoOn]} costs {g.lockIn.costCents}¢ plus about {g.lockIn.feesCents.toFixed(1)}¢ in fees for a $1 payout, <b>only if both venues settle the question the same way</b>.
                      {!realBoth && " Real money isn't available on both venues in your country."}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <div className="flex items-start gap-2.5 rounded-2xl border border-[#FFB547]/30 bg-[#FFB547]/[0.06] p-4 text-[13.5px] leading-relaxed text-[var(--fd-text-soft)]">
        <AlertTriangle size={17} className="mt-0.5 shrink-0 text-[var(--fd-amber-text)]" />
        <span>Two venues can describe the &quot;same&quot; event with different wording, deadlines or settlement sources, so a gap is never a guaranteed profit. Read both markets&apos; rules before acting on one. Prices are from the last refresh and move quickly.</span>
      </div>
    </div>
  );
}
