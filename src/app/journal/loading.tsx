import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { ProgressSteps } from "@/components/journal/progress-steps";

/**
 * Journal loading — the reusable progress pattern from frame 1l of the
 * look-and-feel reference (`docs/design/Coding Journal look and feel.html`).
 *
 * A determinate bar plus a named step list rather than a full-page spinner
 * takeover. The step labels alone carry the state, so the global
 * reduced-motion block can stop the animation without losing information.
 */
export default function JournalLoading() {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex min-h-18 items-center border-b border-m3-outline-variant px-4 sm:px-6">
        <Link href="/journal" className="flex min-h-11 items-center gap-3">
          <BrandMark />
          <span className="text-m3-title-md text-m3-on-surface">
            Coding Journal
          </span>
        </Link>
      </header>
      <main className="mx-auto max-w-[72ch] px-4 py-8 sm:px-6 sm:py-12">
        <ProgressSteps
          headingId="journal-loading-heading"
          title="Building your journal"
          description="Checking the access you granted and reconciling today's activity."
          steps={[
            { label: "Access checked", state: "done" },
            { label: "Stored activity loaded", state: "done" },
            { label: "Reconciling with GitHub", state: "working" },
            { label: "Preparing today's page", state: "waiting" },
          ]}
        />
      </main>
    </div>
  );
}
