"use client";

// Theme preference (dark / light / system). Stored per browser — a viewer
// convenience, not account state. The <head> script in app/layout.tsx applies
// it before first paint; this hook keeps it in sync afterwards.
import { useCallback, useEffect, useState } from "react";

export type ThemePref = "dark" | "light" | "system";
export const THEME_KEY = "faida.theme";

// Colour themes: one backdrop + brand gradient each, in dark and light.
export type Palette = "aurora" | "ocean" | "nebula" | "sunset" | "forest" | "graphite";
export const PALETTE_KEY = "faida.palette";
export const PALETTES: Array<{ id: Palette; label: string; desc: string; swatch: [string, string, string] }> = [
  { id: "aurora", label: "Aurora", desc: "Teal into indigo. The FAIDA default.", swatch: ["#268C8C", "#3448BE", "#2583FF"] },
  { id: "ocean", label: "Ocean", desc: "Deep sea blues and cyan.", swatch: ["#1496D2", "#1E40C8", "#22D3EE"] },
  { id: "nebula", label: "Nebula", desc: "Violet and magenta, for night owls.", swatch: ["#7C3AED", "#DB2777", "#A78BFA"] },
  { id: "sunset", label: "Sunset", desc: "Warm amber into rose.", swatch: ["#EA6C28", "#BE185D", "#F59E0B"] },
  { id: "forest", label: "Forest", desc: "Calm emerald greens.", swatch: ["#10B981", "#0D6E64", "#34D399"] },
  { id: "graphite", label: "Graphite", desc: "Quiet greys, no colour.", swatch: ["#64748B", "#334155", "#CBD5E1"] },
];
const isPalette = (v: string | null): v is Palette => !!v && PALETTES.some((p) => p.id === v);

export function applyPalette(p: Palette) {
  document.documentElement.dataset.palette = p;
}

export function usePalette() {
  const [palette, setPaletteState] = useState<Palette>("aurora");
  useEffect(() => {
    let v: string | null = null;
    try { v = localStorage.getItem(PALETTE_KEY); } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from browser storage after mount
    if (isPalette(v)) setPaletteState(v);
  }, []);
  const setPalette = useCallback((p: Palette) => {
    try { localStorage.setItem(PALETTE_KEY, p); } catch { /* still apply for this session */ }
    applyPalette(p);
    setPaletteState(p);
  }, []);
  return { palette, setPalette };
}

function resolve(pref: ThemePref): "dark" | "light" {
  if (pref !== "system") return pref;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(pref: ThemePref) {
  const t = resolve(pref);
  const el = document.documentElement;
  el.dataset.theme = t;
  el.classList.toggle("dark", t === "dark");
}

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "system" || v === "dark" ? v : "dark";
  } catch {
    return "dark";
  }
}

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>("dark");
  const [resolved, setResolved] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const p = readPref();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from browser storage after mount
    setPrefState(p);
    setResolved(resolve(p));
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if (readPref() === "system") { applyTheme("system"); setResolved(resolve("system")); }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const setPref = useCallback((p: ThemePref) => {
    try { localStorage.setItem(THEME_KEY, p); } catch { /* storage unavailable: still apply for this session */ }
    applyTheme(p);
    setPrefState(p);
    setResolved(resolve(p));
  }, []);
  return { pref, resolved, setPref };
}

// inline, dependency-free version for the <head> (runs before React)
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}")||"dark";var t=p==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):(p==="light"?"light":"dark");var e=document.documentElement;e.dataset.theme=t;e.classList.toggle("dark",t==="dark");var c=localStorage.getItem("${PALETTE_KEY}");e.dataset.palette=/^(aurora|ocean|nebula|sunset|forest|graphite)$/.test(c||"")?c:"aurora";}catch(_){document.documentElement.dataset.theme="dark";document.documentElement.dataset.palette="aurora";document.documentElement.classList.add("dark");}})();`;
