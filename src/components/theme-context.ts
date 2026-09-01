"use client";

import { createContext, use } from "react";

export type Theme = "light" | "dark" | "system";

export type Palette = "default" | "warm-ink" | "tide" | "moss";

export const palettes: readonly Palette[] = [
  "default",
  "warm-ink",
  "tide",
  "moss",
];

export function isPalette(value: unknown): value is Palette {
  return palettes.includes(value as Palette);
}

export type ThemeContextValue = {
  /** What was asked for — may be "system". */
  theme: Theme;
  /** What is actually on screen right now. Never "system". */
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  /** The color palette in effect; "default" is the built-in lavender. */
  palette: Palette;
  setPalette: (palette: Palette) => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const context = use(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  }
  return context;
}
