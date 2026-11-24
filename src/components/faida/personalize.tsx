"use client";

// Personalisation: light / dark / system plus six colour themes. Saved in
// this browser and applied before first paint (theme.ts boot script).

import { Check, Monitor, Moon, Palette as PaletteIcon, Sun } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PALETTES, useTheme, usePalette, type ThemePref } from "./theme";

const MODES: Array<{ id: ThemePref; label: string; icon: React.ReactNode }> = [
  { id: "dark", label: "Dark", icon: <Moon size={15} /> },
  { id: "light", label: "Light", icon: <Sun size={15} /> },
  { id: "system", label: "Auto", icon: <Monitor size={15} /> },
];

export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  const { palette, setPalette } = usePalette();
  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Brightness" className="grid grid-cols-3 gap-1 rounded-full bg-[var(--fd-bg2)] p-1 ring-1 ring-inset ring-[var(--fd-border)]">
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={theme.pref === m.id} onClick={() => theme.setPref(m.id)}
            className={`flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${theme.pref === m.id ? "bg-[color:var(--fd-ink)]/[0.10] text-[var(--fd-strong)]" : "text-[var(--fd-text2)] hover:text-[var(--fd-strong)]"}`}>
            {m.icon} {m.label}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="Colour theme" className={`grid gap-2.5 ${compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3"}`}>
        {PALETTES.map((p) => {
          const on = palette === p.id;
          return (
            <button key={p.id} role="radio" aria-checked={on} onClick={() => setPalette(p.id)} title={p.desc}
              className={`group relative overflow-hidden rounded-2xl border text-left transition-all ${on ? "border-[var(--fd-brand-text)] ring-2 ring-[color:var(--fd-brand-text)]/30" : "border-[var(--fd-border)] hover:border-[var(--fd-border2)]"}`}>
              <span className={`relative block ${compact ? "h-12" : "h-20"}`} style={{ background: `radial-gradient(120% 120% at 0% 0%, ${p.swatch[0]}, transparent 70%), radial-gradient(120% 120% at 100% 100%, ${p.swatch[1]}, transparent 70%), #0B1220` }} aria-hidden>
                <span className="absolute bottom-2 right-2 h-3 w-8 rounded-full" style={{ background: `linear-gradient(90deg, ${p.swatch[2]}, ${p.swatch[1]})` }} />
                {on && <span className="absolute left-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-white text-[#0B1220]"><Check size={13} strokeWidth={3} /></span>}
              </span>
              <span className={`block bg-[var(--fd-bg2)] px-2.5 ${compact ? "py-1.5 text-[12.5px]" : "py-2 text-[14px]"} font-semibold text-[var(--fd-strong)]`}>
                {p.label}
                {!compact && <span className="block text-[12px] font-normal text-[var(--fd-text2)]">{p.desc}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PersonalizeButton() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="grid h-10 w-10 place-items-center rounded-xl text-[var(--fd-text-soft)] hover:bg-[color:var(--fd-ink)]/[0.05]" aria-label="Personalise: theme and colours" title="Personalise">
          <PaletteIcon size={19} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="fd-glass-strong w-[340px] rounded-3xl border-[var(--fd-border2)] p-4 text-[var(--fd-text)]">
        <div className="mb-3">
          <div className="text-[15px] font-semibold text-[var(--fd-strong)]">Make it yours</div>
          <div className="text-[12.5px] text-[var(--fd-text2)]">Saved on this device.</div>
        </div>
        <ThemePicker compact />
      </PopoverContent>
    </Popover>
  );
}
