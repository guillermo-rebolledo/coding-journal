"use client";

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
      className="flex shrink-0 items-center gap-1 rounded-m3-full border border-border bg-m3-surface p-1.5"
    >
      <span className="size-4 rounded-m3-full bg-m3-primary" />
      <span className="size-4 rounded-m3-full bg-m3-secondary-container" />
      <span className="size-4 rounded-m3-full bg-m3-tertiary-container" />
    </span>
  );
}

export function PalettePicker() {
  const { palette, setPalette } = useTheme();

  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {themes.map(({ value, label, description }) => (
          <label
            key={value}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-m3-lg border border-border bg-m3-surface-container-lowest p-4",
              "has-checked:border-primary has-checked:bg-m3-surface-container-low",
              "has-focus-visible:outline-3 has-focus-visible:outline-offset-3 has-focus-visible:outline-ring",
            )}
          >
            <input
              type="radio"
              name="appearance-theme"
              value={value}
              checked={palette === value}
              onChange={() => setPalette(value)}
              className="sr-only"
            />
            <ThemeSwatches palette={value} />
            <span>
              <span className="text-m3-label-lg-emphasized block">{label}</span>
              <span className="mt-0.5 block text-m3-body-sm text-muted-foreground">
                {description}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
