import type { ReactNode } from "react";

import { AppShell } from "@/components/journal/app-shell";
import { StateBlock } from "@/components/journal/state-block";

/** Shared composition for the expected and unexpected journal-day boundaries. */
export function JournalDayBoundary({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <AppShell current="history">
      <div className="max-w-[72ch]">
        <StateBlock
          headingId="journal-day-boundary-heading"
          title={title}
          size="expressive"
          headingLevel={1}
          action={<div className="flex flex-wrap gap-2">{actions}</div>}
        >
          {children}
        </StateBlock>
      </div>
    </AppShell>
  );
}
