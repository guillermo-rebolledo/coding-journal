import { LoaderCircle } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";

export default function JournalLoading() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex min-h-20 max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <BrandMark />
          <div>
            <p className="text-m3-title-md-emphasized">Coding Journal</p>
            <p className="text-m3-body-sm text-muted-foreground">
              Your private journal
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
        <div
          role="status"
          aria-live="polite"
          className="rounded-m3-2xl bg-m3-surface-container-low px-6 py-16 text-center sm:px-10"
        >
          <span className="bg-primary-container mx-auto grid size-16 place-items-center rounded-m3-xl text-primary">
            <LoaderCircle aria-hidden className="size-8 animate-spin" />
          </span>
          <h1 className="mt-6 text-m3-headline-sm">
            Reconciling today&apos;s activity
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-m3-body-md text-muted-foreground">
            Checking the GitHub access you granted and building a deduplicated
            local-day journal.
          </p>
        </div>
      </main>
    </div>
  );
}
