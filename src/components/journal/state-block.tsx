import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Empty, limit and service-health states — patterns 10 and 11 of the
 * look-and-feel reference (`docs/design/Coding Journal look and feel.html`,
 * frames 1n and 1o).
 *
 * One sentence pattern for all of them: what happened · what still works ·
 * when it returns. `size="expressive"` spends the 28dp shape step and generous
 * padding, and is reserved for genuinely empty or unrecoverable moments;
 * `size="band"` is the 12dp tonal band used for limits and health notices.
 */
export function StateBlock({
  headingId,
  title,
  children,
  action,
  tone = "neutral",
  size = "band",
  headingLevel,
  role,
  className,
}: {
  headingId?: string;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "warning" | "error";
  size?: "band" | "expressive";
  /** Route-level expressive states spend the page's single h1 here. */
  headingLevel?: 1 | 2;
  role?: "status" | "alert";
  className?: string;
}) {
  const expressive = size === "expressive";
  const Heading =
    headingLevel === 1 ? "h1" : expressive || headingLevel === 2 ? "h2" : "p";

  return (
    <section
      role={role}
      aria-labelledby={headingId}
      className={cn(
        tone === "warning"
          ? "bg-m3-warning-container text-m3-on-warning-container"
          : tone === "error"
            ? "bg-m3-error-container text-m3-on-error-container"
            : "bg-m3-surface-container-low text-m3-on-surface",
        expressive
          ? "rounded-m3-xl px-6 py-10 sm:px-10 sm:py-14"
          : "rounded-m3-md px-4 py-4 sm:px-5",
        className,
      )}
    >
      <Heading
        id={headingId}
        className={cn(
          expressive
            ? "max-w-[46ch] text-m3-headline-sm text-balance"
            : "text-m3-title-sm",
        )}
      >
        {title}
      </Heading>
      {children ? (
        <div
          className={cn(
            "max-w-[62ch]",
            expressive ? "mt-3 text-m3-body-lg" : "mt-1 text-m3-body-md",
            tone === "neutral" ? "text-m3-on-surface-variant" : undefined,
          )}
        >
          {children}
        </div>
      ) : null}
      {action ? (
        <div className={expressive ? "mt-7" : "mt-3"}>{action}</div>
      ) : null}
    </section>
  );
}
