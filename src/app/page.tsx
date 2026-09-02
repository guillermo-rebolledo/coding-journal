import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { DeletedAccountNotice } from "@/components/deleted-account-notice";
import { SiteHeader } from "@/components/site-header";
import { trustDocuments } from "@/content/trust";

/**
 * Landing — frame 1j of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`).
 *
 * No benefit-card grid: the three claims are a divided definition list, which
 * is denser and more legible than three shadowed tiles. The product's own
 * texture does the selling — a real day, rendered in the real row component.
 * Display-lg is spent once, on the promise.
 */
const claims = [
  {
    title: "See the work, not the noise",
    copy: "Commits, pull requests and reviews become one chronological account of the day, deduplicated across GitHub's webhook and events sources.",
  },
  {
    title: "Honest about what it can't see",
    copy: "Every day states which repositories it covered and which sources were delayed or unavailable. A partial record says so.",
  },
  {
    title: "Private by construction",
    copy: "Read-only scopes, tokens encrypted server-side, 30-day retention, and deletion that actually deletes. No sharing, no profiles, no teams.",
  },
] as const;

const sampleDay = [
  {
    time: "16:52",
    action: "Merged pull request #482",
    subject: "Reconcile ref lifecycle across sources",
    repository: "acme/checkout-service",
  },
  {
    time: "14:07",
    action: "Ran workflow",
    subject: "release-please · Failed",
    repository: "acme/observability-toolkit",
  },
  {
    time: "10:03",
    action: "Commit",
    subject: "Move completeness labels into the domain",
    repository: "acme/coding-journal",
  },
] as const;

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main>
        <Suspense fallback={null}>
          <DeletedAccountNotice />
        </Suspense>
        <section className="mx-auto grid max-w-[76rem] gap-12 px-4 py-16 m3-expanded:grid-cols-[1.05fr_0.95fr] m3-expanded:items-start sm:px-6 sm:py-24">
          <div className="min-w-0">
            <p className="text-m3-label-lg text-balance text-m3-on-surface-variant">
              A private daily record for people who make software
            </p>
            <h1 className="mt-3 text-m3-display-md text-balance m3-expanded:text-m3-display-lg">
              Your GitHub day, distilled.
            </h1>
            <p className="mt-5 max-w-[52ch] text-m3-body-lg text-m3-on-surface-variant">
              Coding Journal records what your day actually contained — commits,
              reviews, merges, the workflow that failed — and keeps it as a
              dated page you can return to. Nothing is scored. Nothing is
              shared.
            </p>
            <div className="mt-8">
              <Link href="/sign-in" className={buttonVariants({ size: "lg" })}>
                Start your journal
              </Link>
              <p className="mt-3 text-m3-body-sm text-m3-on-surface-variant">
                Read-only access. You choose the repositories. Read{" "}
                <Link
                  href="/data-access"
                  className="rounded-m3-xs underline underline-offset-2"
                >
                  what access is used for
                </Link>{" "}
                before you authorize anything.
              </p>
            </div>
          </div>

          <section
            aria-labelledby="sample-day-heading"
            className="min-w-0 rounded-m3-xl bg-m3-surface-container-low p-5 sm:p-6"
          >
            <h2
              id="sample-day-heading"
              className="text-m3-title-sm text-m3-on-surface"
            >
              A day in the journal
            </h2>
            <ol className="mt-3 divide-y divide-m3-outline-variant">
              {sampleDay.map((entry) => (
                <li
                  key={entry.time}
                  className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 py-3"
                >
                  <p className="text-m3-label-lg text-m3-on-surface-variant tabular-nums">
                    {entry.time}
                  </p>
                  <div className="min-w-0">
                    <p className="text-m3-body-md wrap-anywhere">
                      <span className="text-m3-title-sm text-m3-on-surface">
                        {entry.action}
                      </span>
                      <span className="text-m3-on-surface-variant">
                        {" — "}
                        {entry.subject}
                      </span>
                    </p>
                    <p className="mt-0.5 text-m3-body-sm wrap-anywhere text-m3-on-surface-variant">
                      {entry.repository}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </section>

        <section
          aria-labelledby="why-heading"
          className="border-t border-m3-outline-variant"
        >
          <div className="mx-auto max-w-[76rem] px-4 py-16 sm:px-6 sm:py-20">
            <h2 id="why-heading" className="sr-only">
              What Coding Journal does
            </h2>
            <dl className="divide-y divide-m3-outline-variant border-y border-m3-outline-variant">
              {claims.map(({ title, copy }) => (
                <div
                  key={title}
                  className="grid gap-x-10 gap-y-1 py-6 m3-expanded:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]"
                >
                  <dt className="text-m3-title-lg text-balance text-m3-on-surface">
                    {title}
                  </dt>
                  <dd className="max-w-[62ch] text-m3-body-lg text-m3-on-surface-variant">
                    {copy}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>
      <footer className="border-t border-m3-outline-variant px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-[76rem] flex-col gap-3 text-m3-body-sm text-m3-on-surface-variant m3-expanded:flex-row m3-expanded:items-center m3-expanded:justify-between">
          <p>Coding Journal is open source and made for thoughtful work.</p>
          <nav
            aria-label="Trust pages"
            className="flex flex-wrap items-center gap-x-6"
          >
            {trustDocuments.map((trustDocument) => (
              <Link
                key={trustDocument.slug}
                href={`/${trustDocument.slug}`}
                className="flex min-h-11 items-center rounded-m3-xs hover:underline focus-visible:underline"
              >
                {trustDocument.navLabel}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
