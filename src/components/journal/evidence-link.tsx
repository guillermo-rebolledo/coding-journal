import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Evidence link — pattern 4 of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`, frame 1n).
 *
 * It always names what it proves, keeps a 44dp target, opens on GitHub, and
 * underlines on hover and focus rather than relying on colour alone.
 */
export function EvidenceLink({
  href,
  noun,
  className,
}: {
  href: string;
  noun: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex min-h-11 items-center gap-1 text-m3-label-lg text-m3-primary",
        "underline-offset-4 hover:underline focus-visible:underline",
        className,
      )}
    >
      View {noun} evidence
      <ArrowUpRight aria-hidden className="size-4" />
    </a>
  );
}
