"use client";

import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme, type Theme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const modes: ReadonlyArray<{
  value: Theme;
  label: string;
  icon: typeof Sun;
}> = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/**
 * Appearance mode — frame 1k of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`). A segmented choice rather
 * than a menu, because Settings is where the decision is made rather than
 * where it is toggled in passing.
 */
export function ThemeModePicker() {
  const { theme, setTheme } = useTheme();

  return (
    <fieldset>
      <legend className="sr-only">Mode</legend>
      <div className="flex flex-wrap gap-2">
        {modes.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-2 rounded-m3-full border px-4",
              "border-m3-outline-variant text-m3-label-lg text-m3-on-surface-variant",
              "has-checked:border-m3-primary has-checked:bg-m3-secondary-container has-checked:text-m3-on-secondary-container",
              "has-focus-visible:outline-3 has-focus-visible:outline-offset-3 has-focus-visible:outline-ring",
            )}
          >
            <input
              type="radio"
              name="appearance-mode"
              value={value}
              checked={theme === value}
              onChange={() => setTheme(value)}
              className="sr-only"
            />
            <Icon aria-hidden className="size-4" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
