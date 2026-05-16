"use client";
/**
 * Theme context + 10 core color tokens.
 *
 * App-wide colors are inline-styled across many files. To avoid touching
 * every line, we expose a `useTheme()` hook that returns a `c` object;
 * components use `c.bg`, `c.card`, `c.text`, etc. instead of raw hex.
 *
 * Status/accent colors (green/red/amber/indigo for ROAS pills, intent
 * chips, etc.) are NOT in the theme — they're tuned to read on both
 * dark and light backgrounds already.
 */
import { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from "react";

export type Theme = "dark" | "light";

export interface ThemeColors {
  /** Page background */
  bg: string;
  /** Card / panel background (one level above bg) */
  card: string;
  /** Inset / input / chip-on-card background (one level above card) */
  inset: string;
  /** Hover background for rows / interactive surfaces */
  hover: string;
  /** Standard border between elements */
  border: string;
  /** Stronger border / focus ring */
  borderStrong: string;

  /** Primary body text */
  text: string;
  /** Secondary / label text */
  textMuted: string;
  /** Disabled / placeholder text */
  textFaint: string;

  /** Accent color for links + active states (same on both themes for brand consistency) */
  accent: string;
}

const DARK: ThemeColors = {
  bg:          "#0d1117",
  card:        "#161b27",
  inset:       "#1c2333",
  hover:       "#1c2333",
  border:      "#2a3245",
  borderStrong:"#3a4560",
  text:        "#e2e8f0",
  textMuted:   "#8892a4",
  textFaint:   "#555f6e",
  accent:      "#6366f1",
};

const LIGHT: ThemeColors = {
  bg:          "#f5f7fa",
  card:        "#ffffff",
  inset:       "#eef1f6",
  hover:       "#eef1f6",
  border:      "#dfe4ec",
  borderStrong:"#b6bfcf",
  text:        "#1a202c",
  textMuted:   "#525f7f",
  textFaint:   "#94a3b8",
  accent:      "#6366f1",
};

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
  c: ThemeColors;
}

const Ctx = createContext<ThemeContextValue>({
  theme: "dark",
  setTheme: () => {},
  toggle: () => {},
  c: DARK,
});

const STORAGE_KEY = "amazon-ads:theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Default to dark for SSR + first paint; rehydrate to user's choice on mount.
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (saved === "light" || saved === "dark") setThemeState(saved);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    // Stamp the root element so global CSS (e.g. scrollbars) can react via [data-theme].
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.style.colorScheme = theme;
    }
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ }
  };
  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");

  const value = useMemo<ThemeContextValue>(() => ({
    theme, setTheme, toggle,
    c: theme === "dark" ? DARK : LIGHT,
  }), [theme]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(Ctx);
}
