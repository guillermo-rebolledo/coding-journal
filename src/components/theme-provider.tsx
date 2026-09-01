"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  isPalette,
  ThemeContext,
  type Palette,
  type Theme,
} from "./theme-context";

// localStorage can be missing or throw (private browsing, test environments).
function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preference still applies for this visit; it just won't persist.
  }
}

function systemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  defaultPalette = "default",
  storageKey = "materialcn-theme",
  paletteStorageKey = "materialcn-palette",
}: {
  children: React.ReactNode;
  defaultTheme?: Theme;
  defaultPalette?: Palette;
  /** Set to null to opt out of persistence. */
  storageKey?: string | null;
  /** Set to null to opt out of persistence. */
  paletteStorageKey?: string | null;
}) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined" || !storageKey) return defaultTheme;
    const stored = readStorage(storageKey);
    return stored === "light" || stored === "dark" || stored === "system"
      ? stored
      : defaultTheme;
  });

  // Unlike `theme`, the palette drives radio inputs that hydrate against
  // server HTML, so it must render server-consistent first and adopt the
  // stored value only after mount — a lazy `useState` initializer would leave
  // React's idea of `checked` out of sync with the DOM until the first
  // interaction. `useSyncExternalStore` makes that handoff (and cross-tab
  // storage events) explicit; the stored value wins whenever one exists, and
  // plain state covers persistence being off or localStorage rejecting writes.
  const [memoryPalette, setMemoryPalette] = useState(defaultPalette);

  const subscribeToPalette = useCallback(
    (listener: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === paletteStorageKey) listener();
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
    [paletteStorageKey],
  );

  const readStoredPalette = useCallback((): Palette | null => {
    if (!paletteStorageKey) return null;
    const stored = readStorage(paletteStorageKey);
    return isPalette(stored) ? stored : null;
  }, [paletteStorageKey]);

  const storedPalette = useSyncExternalStore(
    subscribeToPalette,
    readStoredPalette,
    () => null,
  );

  const palette = storedPalette ?? memoryPalette;

  const [system, setSystem] = useState<"light" | "dark">(systemTheme);

  // Track the OS preference so `resolvedTheme` stays correct while on "system".
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(query.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = theme === "system" ? system : theme;

  useEffect(() => {
    const target = document.documentElement;
    target.classList.remove("light", "dark");

    // On "system" we deliberately add no class: tokens/color.css already falls
    // back to `prefers-color-scheme`, so leaving both classes off is what lets
    // an unstyled server render match the client.
    if (theme !== "system") target.classList.add(theme);

    return () => target.classList.remove("light", "dark");
  }, [theme]);

  useEffect(() => {
    const target = document.documentElement;

    // "default" removes the attribute so the base :root tokens apply, keeping
    // the server render (which never carries the attribute) the baseline.
    if (palette === "default") {
      delete target.dataset.palette;
    } else {
      target.dataset.palette = palette;
    }

    return () => {
      delete target.dataset.palette;
    };
  }, [palette]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      if (storageKey) writeStorage(storageKey, next);
    },
    [storageKey],
  );

  const setPalette = useCallback(
    (next: Palette) => {
      setMemoryPalette(next);
      if (paletteStorageKey) writeStorage(paletteStorageKey, next);
    },
    [paletteStorageKey],
  );

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, palette, setPalette }),
    [theme, resolvedTheme, setTheme, palette, setPalette],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export { useTheme, type Palette, type Theme } from "./theme-context";
