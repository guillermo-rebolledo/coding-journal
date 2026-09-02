import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { JournalExplorer } from "@/app/journal/journal-explorer";
import {
  redactHistoricalNarrative,
  retryHistoricalJournal,
} from "@/app/journal/history/actions";
import { HistoryActionForm } from "@/app/journal/history/history-action-form";
import { AppShell } from "@/components/journal/app-shell";
import { DestructiveConfirmation } from "@/components/journal/destructive-confirmation";
import { JournalNarrative } from "@/components/journal/journal-narrative";
import { MetricOverview } from "@/components/journal/metric-overview";
import { StateBlock } from "@/components/journal/state-block";
import {
  validHistoricalLocalDate,
  type JournalHistoryStore,
} from "@/lib/journal-history";
import type { JournalSession } from "@/lib/session";
import { describeJournalStatus } from "@/lib/today-journal";

function displayDate(localDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${localDate}T00:00:00Z`));
}

function completenessLabel(value: string | null) {
  return describeJournalStatus({
    status:
      value === "complete" || value === "partial" || value === "error"
        ? value
        : "loading",
  }).completeness;
}

/**
 * The boundaries this page reaches. They are parameters rather than module
 * imports so a test can supply real stand-ins and still render the page it is
 * describing.
 */
export type HistoryDetailPageDependencies = {
  requestHeaders: Headers;
  getSession: (requestHeaders: Headers) => Promise<JournalSession | null>;
  store: Pick<JournalHistoryStore, "read">;
  redirect: (destination: string) => never;
  notFound: () => never;
};

/**
 * A finalized day — frame 1i of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`).
 *
 * The day detail is Today's composition minus the actions: masthead,
 * completeness line, metric overview, immutable narrative, evidence list. A
 * correction is an appended, dated block *below* the narrative, never an edit
 * to it.
 */
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
  if (!validHistoricalLocalDate(localDate)) return notFound();
  const journal = await store.read(session.user.id, localDate);
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

        <JournalNarrative
          narrative={journal.narrative}
          evidence={journal.evidence}
          generatedAt={finalizedAt}
          immutable
          headingId="historical-narrative-heading"
          emptyMessage={
            failed
              ? "No narrative was frozen because final processing did not complete."
              : finalizing
                ? "The final narrative will appear after processing completes."
                : "This day has no narrative, either because it had no eligible evidence or it was privacy-redacted."
          }
        />

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
            tone="error"
            className="mt-6"
            action={
              <DestructiveConfirmation
                action={redactAction}
                literal="REDACT"
                fieldLabel="Type REDACT to confirm"
                submitLabel="Redact narrative"
                triggerLabel="Redact narrative"
                cancelLabel="Keep narrative"
                description="Permanently remove the frozen narrative. Recorded facts, aggregate metrics, evidence, and corrections remain unchanged."
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
