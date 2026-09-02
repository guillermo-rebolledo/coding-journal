"use client";

import { Check } from "lucide-react";

import { useTheme, type Palette } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const themes: ReadonlyArray<{
  value: Palette;
  label: string;
  description: string;
}> = [
  {
    value: "default",
    label: "Lavender",
    description: "The original violet accent on cool neutrals.",
  },
  {
    value: "warm-ink",
    label: "Warm ink",
    description: "Sienna ink on warm paper, with sage and plum companions.",
  },
  {
    value: "tide",
    label: "Tide",
    description: "A green-leaning teal on paper-cool neutrals.",
  },
  {
    value: "moss",
    label: "Moss & clay",
    description: "Moss green over oat paper, against fired clay.",
  },
];

function ThemeSwatches({ palette }: { palette: Palette }) {
  return (
    <span
      aria-hidden
      data-palette={palette === "default" ? undefined : palette}
      className="flex shrink-0 items-center gap-1 rounded-m3-full border border-m3-outline-variant bg-m3-surface p-1.5"
    >
      <span className="size-4 rounded-m3-full bg-m3-primary" />
      <span className="size-4 rounded-m3-full bg-m3-secondary-container" />
      <span className="size-4 rounded-m3-full bg-m3-tertiary-container" />
    </span>
  );
}

/**
 * Palette choice — frame 1k of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`).
 *
 * The swatches preview primary, secondary container and tertiary container in
 * the current mode: the three roles a user actually notices. Selection is
 * marked by surface, border *and* a check, never by colour alone.
 */
export function PalettePicker() {
  const { palette, setPalette } = useTheme();

  return (
    <fieldset>
      <legend className="sr-only">Palette</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {themes.map(({ value, label, description }) => (
          <label
            key={value}
            className={cn(
              "flex min-h-14 cursor-pointer items-center gap-3 rounded-m3-xs border p-3",
              "border-m3-outline-variant",
              "has-checked:border-m3-primary has-checked:bg-m3-surface-container",
              "has-focus-visible:outline-3 has-focus-visible:outline-offset-3 has-focus-visible:outline-ring",
            )}
          >
            <input
              type="radio"
              name="appearance-theme"
              value={value}
              checked={palette === value}
              onChange={() => setPalette(value)}
              className="peer sr-only"
            />
            <ThemeSwatches palette={value} />
            <span className="min-w-0">
              <span className="block text-m3-label-lg text-m3-on-surface">
                {label}
              </span>
              <span className="block text-m3-body-sm text-m3-on-surface-variant">
                {description}
              </span>
            </span>
            <Check
              aria-hidden
              className="ml-auto size-5 shrink-0 text-m3-primary opacity-0 peer-checked:opacity-100"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
