import Link from "next/link";

import { trustDocuments } from "@/content/trust";
import type { TrustDocument } from "@/content/trust/types";
import { cn } from "@/lib/utils";

/**
 * The one list of trust pages, rendered wherever a person can reach them
 * before authorizing: the landing footer, sign-in, and the trust shell itself.
 * Adding a fourth document should light it up in every one of those places
 * without touching any of them.
 */
export function TrustNav({
  className,
  current,
  underline = false,
}: {
  className?: string;
  /** Marks the page being read, when the nav sits on a trust page. */
  current?: TrustDocument["slug"];
  underline?: boolean;
}) {
  return (
    <nav
      aria-label="Trust pages"
      className={cn("flex flex-wrap items-center gap-x-6", className)}
    >
      {trustDocuments.map((document) => (
        <Link
          key={document.slug}
          href={`/${document.slug}`}
          aria-current={document.slug === current ? "page" : undefined}
          className={cn(
            "flex min-h-11 items-center rounded-m3-xs",
            underline
              ? "underline underline-offset-2"
              : "hover:underline focus-visible:underline",
          )}
        >
          {document.navLabel}
        </Link>
      ))}
    </nav>
  );
}
