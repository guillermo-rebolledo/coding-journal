import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { JournalExplorer } from "@/app/journal/journal-explorer";
import {
  redactHistoricalNarrative,
  retryHistoricalJournal,
} from "@/app/journal/history/actions";
import { HistoryActionForm } from "@/app/journal/history/history-action-form";
import { AppShell } from "@/components/journal/app-shell";
import { MetricOverview } from "@/components/journal/metric-overview";
import { StateBlock } from "@/components/journal/state-block";
import { getE2EHistoricalJournal, isE2EJournalUser } from "@/lib/e2e-fixtures";
import type { JournalFinalizationRepository } from "@/lib/journal-finalization-repository";
import type { JournalSession } from "@/lib/session";

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

/**
 * A finalized day — frame 1i of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`).
 *
 * The day detail is Today's composition minus the actions: masthead,
 * completeness line, metric overview, immutable narrative, evidence list. A
 * correction is an appended, dated block *below* the narrative, never an edit
 * to it.
 */
/**
 * The boundaries this page reaches. They are parameters rather than module
 * imports so a test can supply real stand-ins and still render the page it is
 * describing.
 */
export type HistoryDetailPageDependencies = {
  requestHeaders: Headers;
  getSession: (requestHeaders: Headers) => Promise<JournalSession | null>;
  store: Pick<JournalFinalizationRepository, "read">;
  redirect: (destination: string) => never;
  notFound: () => never;
};

export async function renderJournalHistoryDetailPage(
  params: Promise<{ localDate: string }>,
  {
    requestHeaders,
    getSession,
    store,
    redirect,
    notFound,
  }: HistoryDetailPageDependencies,
) {
  const session = await getSession(requestHeaders);
  if (!session) return redirect("/sign-in?next=%2Fjournal%2Fhistory");
  const { localDate } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return notFound();
  const journal = isE2EJournalUser(session.user.id)
    ? getE2EHistoricalJournal(localDate)
    : await store.read(session.user.id, localDate);
  if (!journal) return notFound();

  const failed = journal.status === "recoverable-error";
  const corrected = journal.status === "corrected";
  const finalizing = journal.status === "finalizing";
  const lifecycle = failed
    ? "Recoverable failure"
    : finalizing
      ? "Finalizing"
      : corrected
        ? "Corrected"
        : "Finalized";
  const finalizedAt = journal.finalizedAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: journal.timeZone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(journal.finalizedAt)
    : null;
  const retryAction = retryHistoricalJournal.bind(null, localDate);
  const redactAction = redactHistoricalNarrative.bind(null, localDate);

  return (
    <AppShell current="history">
      <div className="max-w-[72ch]">
        <Link
          href="/journal/history"
          className="inline-flex min-h-11 items-center gap-2 text-m3-label-lg text-m3-primary underline-offset-4 hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back to history
        </Link>

        <p className="mt-6 text-m3-label-lg text-m3-on-surface-variant">
          {lifecycle === "Finalized" ? "Finalized day" : lifecycle}
        </p>
        <h1 className="mt-1 text-m3-headline-lg text-balance m3-expanded:text-m3-display-sm">
          <time dateTime={journal.localDate}>
            {displayDate(journal.localDate)}
          </time>
        </h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-m3-body-md text-m3-on-surface-variant">
          <span>Recorded in {journal.timeZone}</span>
          <span aria-hidden>·</span>
          <span className="text-m3-on-surface">
            {completenessLabel(journal.completeness)}
          </span>
          {finalizedAt ? (
            <>
              <span aria-hidden>·</span>
              <span>Finalized {finalizedAt}</span>
            </>
          ) : null}
        </p>

        {journal.metrics ? (
          <MetricOverview
            metrics={journal.metrics}
            eventCount={journal.evidence.length}
            headingId="historical-metrics-heading"
            className="mt-8"
          />
        ) : null}

        <section
          aria-labelledby="historical-narrative-heading"
          className={`mt-8 rounded-m3-xl p-6 sm:p-7 ${
            journal.narrative
              ? "bg-m3-tertiary-container text-m3-on-tertiary-container"
              : "bg-m3-surface-container-low text-m3-on-surface"
          }`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="historical-narrative-heading" className="text-m3-title-lg">
              Written for you
            </h2>
            <p className="text-m3-label-md">
              Immutable{finalizedAt ? ` · generated ${finalizedAt}` : null}
            </p>
          </div>
          {journal.narrative ? (
            <div className="mt-4 grid gap-4">
              <p className="max-w-[62ch] text-m3-body-lg">
                {journal.narrative.overview}
              </p>
              {[
                ...journal.narrative.accomplishments,
                ...journal.narrative.collaboration,
                ...journal.narrative.inProgress,
              ].map((claim, index) => (
                <p
                  key={`${claim.summary}-${index}`}
                  className="max-w-[62ch] text-m3-body-md"
                >
                  {claim.summary}
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-3 max-w-[62ch] text-m3-body-md text-m3-on-surface-variant">
              {failed
                ? "No narrative was frozen because final processing did not complete."
                : finalizing
                  ? "The final narrative will appear after processing completes."
                  : "This day has no narrative, either because it had no eligible evidence or it was privacy-redacted."}
            </p>
          )}
        </section>

        {corrected ? (
          <div className="mt-4 border-l-2 border-m3-primary pl-4">
            <p className="text-m3-label-lg text-m3-on-surface">
              Correction appended
            </p>
            <p className="mt-1 max-w-[62ch] text-m3-body-md text-m3-on-surface-variant">
              {journal.correctionCount} late{" "}
              {journal.correctionCount === 1 ? "event" : "events"} arrived after
              this day was finalized. They are listed below and are not
              reflected in the narrative above, which is never rewritten.
            </p>
          </div>
        ) : null}

        {failed ? (
          <StateBlock
            title="Retry finalization"
            tone="error"
            className="mt-6"
            action={
              <HistoryActionForm
                action={retryAction}
                label="Retry finalization"
              />
            }
          >
            Retry after GitHub or narrative generation has recovered. The job
            remains idempotent and cannot overwrite a completed record.
          </StateBlock>
        ) : journal.narrative ? (
          <StateBlock
            title="Privacy redaction"
            className="mt-6"
            action={
              <HistoryActionForm
                action={redactAction}
                label="Redact narrative"
              />
            }
          >
            Permanently remove the frozen narrative. Aggregate metrics and the
            correction record stay unchanged.
          </StateBlock>
        ) : null}

        {journal.evidence.length ? (
          <JournalExplorer
            activities={journal.evidence}
            timeZone={journal.timeZone}
            title="Final evidence"
            headingId="final-evidence-heading"
          />
        ) : null}

        {journal.corrections.length ? (
          <JournalExplorer
            activities={journal.corrections}
            timeZone={journal.timeZone}
            title="Late corrections"
            headingId="late-corrections-heading"
          />
        ) : null}
      </div>
    </AppShell>
  );
}
