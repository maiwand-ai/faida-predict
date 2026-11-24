"use client";

// FAIDA Predict — Robots › Ready-made robots. Each is a fixed strategy on
// one venue: pick one, choose how much money, start. The robot then appears
// under My robots; the ready-made one stays here for next time.

import { useEffect, useState } from "react";
import { ArrowRight, Wrench } from "lucide-react";
import type { DashboardDTO, TemplateDTO } from "./types";
import { FAMILY_LABEL } from "./types";
import { Badge, btn, EmptyState, money, Panel, Segmented, VenueTag } from "./ds";

export const RISK_WORD: Record<string, { label: string; tone: string }> = {
  CONSERVATIVE: { label: "Careful", tone: "green" },
  BALANCED: { label: "Balanced", tone: "blue" },
  AGGRESSIVE: { label: "Bold", tone: "red" },
};

export function useTemplates() {
  const [templates, setTemplates] = useState<TemplateDTO[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/robot-templates")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { templates?: TemplateDTO[] } | null) => { if (alive) setTemplates(j?.templates ?? []); })
      .catch(() => { if (alive) setTemplates([]); });
    return () => { alive = false; };
  }, []);
  return templates;
}

export function ReadyMadeRobots({ dash, onUse, onBuildOwn }: {
  dash: DashboardDTO | null;
  onUse: (templateId: string) => void;
  onBuildOwn: () => void;
}) {
  const templates = useTemplates();
  const [risk, setRisk] = useState<"ALL" | "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE">("ALL");
  const shown = (templates ?? []).filter((t) => risk === "ALL" || t.riskProfile === risk);
  const inUse = new Set((dash?.robots ?? []).map((r) => `${r.venue}:${r.family}`));

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[14.5px] text-[var(--fd-text2)]">Each one is a fixed strategy on one venue. Pick one, choose how much money it may use, and it starts right away.</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Risk level"
          value={risk}
          onChange={setRisk}
          options={[{ id: "ALL", label: "All" }, { id: "CONSERVATIVE", label: "Careful" }, { id: "BALANCED", label: "Balanced" }, { id: "AGGRESSIVE", label: "Bold" }]}
        />
        <button className={btn.secondary} onClick={onBuildOwn}><Wrench size={16} /> Build my own</button>
      </div>

      {templates == null ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-56 animate-pulse rounded-3xl bg-[var(--fd-elevated)]" />)}</div>
      ) : shown.length === 0 ? (
        <Panel><EmptyState title="Nothing at this risk level" body="Try another risk level, or build your own robot." action={<button className={btn.primary} onClick={onBuildOwn}>Build my own</button>} /></Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((t) => {
            const rw = RISK_WORD[t.riskProfile] ?? RISK_WORD.BALANCED;
            return (
              <article key={t.id} className={`fd-glass flex flex-col rounded-3xl border border-[var(--fd-border)] bg-[var(--fd-surface)] p-5 ${t.venueLive ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-[17px] font-semibold text-[var(--fd-strong)]">{t.label}</h2>
                  <Badge tone={rw.tone}>{rw.label}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <VenueTag venue={t.venue} />
                  <span className="text-[13px] text-[var(--fd-text3)]">{FAMILY_LABEL[t.family] ?? t.family}</span>
                  {inUse.has(`${t.venue}:${t.family}`) && <Badge tone="neutral">You have one like this</Badge>}
                </div>
                <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--fd-text-soft)]">{t.thesis}</p>
                <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--fd-text2)]">{t.behavior}</p>
                <div className="mt-auto pt-5">
                  <div className="mb-3 text-[13px] text-[var(--fd-text3)]">Suggested money <span className="fd-num font-semibold text-[var(--fd-text-soft)]">{money(t.capital.allocatedCents)}</span> · up to <span className="fd-num">{money(t.capital.maxPositionCents)}</span> per trade</div>
                  {t.venueLive ? (
                    <button className={`${btn.primary} w-full`} onClick={() => onUse(t.id)}>Start with this one <ArrowRight size={16} /></button>
                  ) : (
                    <div className="rounded-xl bg-[var(--fd-bg2)] px-3 py-2.5 text-center text-[13.5px] text-[var(--fd-text2)]">Not available yet: {t.venueWhy}</div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="-mt-2 text-[13px] text-[var(--fd-text3)]">Ready-made robots are starting points, not promises of profit. Every robot starts with practice money and builds its own track record.</p>

    </div>
  );
}
