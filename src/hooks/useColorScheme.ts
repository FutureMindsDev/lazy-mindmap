import { useCallback, useEffect, useState } from "react";
import type { ColorSchemePreference } from "../types/mindmap";

const STORAGE_KEY = "color-scheme";

function readMetaScheme(): ColorSchemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  return "system";
}

function getSystemIsDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyMetaScheme(pref: ColorSchemePreference) {
  const meta = document.querySelector('meta[name="color-scheme"]');
  const value = pref === "system" ? "light dark" : pref;
  if (meta) {
    meta.setAttribute("content", value);
  }
  try {
    if (pref === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, pref);
    }
  } catch {}
}

/**
 * Implements the dark-mode-toggle specification:
 * - Supports System ("light dark"), explicit "light", and explicit "dark"
 * - Keeps <meta name="color-scheme"> synchronized and syncs across browser tabs via `storage`
 * - Never clears a pinned override when OS system preference changes to match
 */
export function useColorScheme() {
  const [preference, setPreference] = useState<ColorSchemePreference>(() => readMetaScheme());
  const [systemDark, setSystemDark] = useState<boolean>(() => getSystemIsDark());

  useEffect(() => {
    applyMetaScheme(preference);
  }, [preference]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMqChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onMqChange);

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setPreference(readMetaScheme());
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      mq.removeEventListener("change", onMqChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const isDark = preference === "dark" || (preference === "system" && systemDark);

  const toggleDarkLight = useCallback(() => {
    const target: "light" | "dark" = isDark ? "light" : "dark";
    const nextPref: ColorSchemePreference = target === (systemDark ? "dark" : "light") ? "system" : target;
    setPreference(nextPref);
    return target;
  }, [isDark, systemDark]);

  return {
    preference,
    setPreference,
    isDark,
    systemDark,
    toggleDarkLight,
  };
}
