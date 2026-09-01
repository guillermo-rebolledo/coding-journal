import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
} from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { JournalFrame } from "@/app/journal/journal-frame";
import { JournalExplorer } from "@/app/journal/journal-explorer";
import type { ActivityMetrics } from "@/lib/github-activity";
import { journalFinalizationRepository } from "@/lib/journal-finalization-repository";
import { getJournalSession } from "@/lib/session";

export const metadata: Metadata = { title: "Journal history" };
export const dynamic = "force-dynamic";

const metricLabels: Record<keyof ActivityMetrics, string> = {
  pushes: "Pushes",
  commits: "Commits",
  refs: "Ref changes",
  releases: "Releases",
  discussions: "Discussions",
  issues: "Issue updates",
  pullRequests: "Pull requests",
  reviews: "Reviews",
  merges: "Merges",
  comments: "Comments",
  workflows: "Workflow runs",
  deployments: "Deployments",
  packages: "Package updates",
  projects: "Project updates",
  gists: "Gist updates",
  social: "Social actions",
};

function displayDate(localDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${localDate}T00:00:00Z`));
}

function completenessLabel(value: string | null) {
  if (value === "complete") return "Complete coverage";
  if (value === "partial") return "Partial coverage";
  if (value === "error") return "Provider unavailable";
  return "Final coverage pending";
}

export default async function JournalHistoryDetailPage({
  params,
}: {
  params: Promise<{ localDate: string }>;
}) {
  const session = await getJournalSession(await headers());
  if (!session) redirect("/sign-in?next=%2Fjournal%2Fhistory");
  const { localDate } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) notFound();
  const journal = await journalFinalizationRepository.read(
    session.user.id,
    localDate,
  );
  if (!journal) notFound();

  const failed = journal.status === "recoverable-error";
  const corrected = journal.status === "corrected";
  const finalizing = journal.status === "finalizing";

  return (
    <JournalFrame current="history">
      <Link
        href="/journal/history"
        className="text-m3-label-lg-emphasized inline-flex min-h-11 items-center gap-2 text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" /> Back to history
      </Link>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="text-m3-label-lg-emphasized text-primary">
            FINAL RECORD
          </p>
          <h1 className="mt-2 text-m3-headline-lg text-balance">
            {displayDate(journal.localDate)}
          </h1>
          <p className="mt-3 flex items-center gap-2 text-m3-body-md text-muted-foreground">
            <CalendarDays aria-hidden className="size-5" />
            {journal.timeZone}
          </p>
        </div>
        <div
          role="status"
          className={`w-fit rounded-m3-lg px-4 py-3 ${
            failed
              ? "bg-m3-error-container text-m3-on-error-container"
              : finalizing
                ? "bg-secondary-container text-secondary-foreground"
                : corrected
                  ? "bg-m3-warning-container text-m3-on-warning-container"
                  : "bg-primary-container text-primary"
          }`}
        >
          <p className="text-m3-label-lg-emphasized flex items-center gap-2">
            {failed ? (
              <AlertTriangle aria-hidden className="size-4" />
            ) : finalizing ? (
              <Clock3 aria-hidden className="size-4" />
            ) : (
              <CheckCircle2 aria-hidden className="size-4" />
            )}
            {failed
              ? "Recoverable failure"
              : finalizing
                ? "Finalizing"
                : corrected
                  ? "Corrected"
                  : "Finalized"}
          </p>
          <p className="mt-1 text-m3-body-sm">
            {failed
              ? "Final processing can be retried without changing a completed record."
              : finalizing
                ? "Final reconciliation and narrative generation are in progress."
                : completenessLabel(journal.completeness)}
          </p>
        </div>
      </div>

      {journal.metrics ? (
        <section aria-labelledby="historical-metrics-heading" className="mt-10">
          <h2 id="historical-metrics-heading" className="text-m3-headline-sm">
            Final metrics
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {(
              Object.entries(journal.metrics) as Array<
                [keyof ActivityMetrics, number]
              >
            ).map(([key, value]) => (
              <article
                key={key}
                className="rounded-m3-xl bg-card p-4 shadow-m3-1 sm:p-5"
              >
                <p className="text-m3-headline-sm">{value}</p>
                <p className="mt-1 text-m3-body-sm text-muted-foreground">
                  {metricLabels[key]}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="historical-narrative-heading"
        className="mt-8 rounded-m3-2xl bg-card p-5 shadow-m3-1 sm:p-7"
      >
        <p className="text-m3-label-lg-emphasized text-primary">
          DAILY NARRATIVE
        </p>
        <h2
          id="historical-narrative-heading"
          className="mt-2 text-m3-headline-sm"
        >
          Frozen summary
        </h2>
        {journal.narrative ? (
          <div className="mt-4 grid gap-5">
            <p className="max-w-3xl text-m3-body-lg">
              {journal.narrative.overview}
            </p>
            {[
              ...journal.narrative.accomplishments,
              ...journal.narrative.collaboration,
              ...journal.narrative.inProgress,
            ].map((claim, index) => (
              <p
                key={`${claim.summary}-${index}`}
                className="rounded-m3-lg bg-m3-surface-container-low p-4 text-m3-body-md"
              >
                {claim.summary}
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-m3-body-md text-muted-foreground">
            {failed
              ? "No narrative was frozen because final processing did not complete."
              : finalizing
                ? "The final narrative will appear after processing completes."
                : "This day has no narrative, either because it had no eligible evidence or it was privacy-redacted."}
          </p>
        )}
      </section>

      {journal.evidence.length ? (
        <JournalExplorer
          activities={journal.evidence}
          timeZone={journal.timeZone}
          title="Final evidence"
          eyebrow="FROZEN TIMELINE"
          headingId="final-evidence-heading"
        />
      ) : null}

      {journal.corrections.length ? (
        <JournalExplorer
          activities={journal.corrections}
          timeZone={journal.timeZone}
          title="Late corrections"
          eyebrow="ADDED AFTER FINALIZATION"
          headingId="late-corrections-heading"
        />
      ) : null}
    </JournalFrame>
  );
}
