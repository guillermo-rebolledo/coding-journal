import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Status and coverage chip — pattern 3 of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`, frame 1n).
 *
 * The 4dp radius is deliberate: chips must never read as buttons. Only two
 * tones exist, because a chip either states a fact about coverage (neutral) or
 * says the record is incomplete (warning). The word carries the meaning; the
 * tone only reinforces it, so nothing depends on colour.
 */
export function StatusChip({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "warning";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-m3-xs px-2 py-0.5",
        "text-m3-label-sm wrap-anywhere",
        tone === "warning"
          ? "bg-m3-warning-container text-m3-on-warning-container"
          : "border border-m3-outline-variant text-m3-on-surface-variant",
        className,
      )}
    >
      {children}
    </span>
  );
}
