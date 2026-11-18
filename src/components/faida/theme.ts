"use client";

// Theme preference (dark / light / system). Stored per browser — a viewer
// convenience, not account state. The <head> script in app/layout.tsx applies
// it before first paint; this hook keeps it in sync afterwards.
import { useCallback, useEffect, useState } from "react";

export type ThemePref = "dark" | "light" | "system";
export const THEME_KEY = "faida.theme";

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
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}")||"dark";var t=p==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):(p==="light"?"light":"dark");var e=document.documentElement;e.dataset.theme=t;e.classList.toggle("dark",t==="dark");}catch(_){document.documentElement.dataset.theme="dark";document.documentElement.classList.add("dark");}})();`;
