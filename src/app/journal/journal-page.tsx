import Link from "next/link";

import { skipGitHubAppInstallation } from "@/app/journal/actions";
import { JournalExplorer } from "@/app/journal/journal-explorer";
import { JournalRefresh } from "@/app/journal/journal-refresh";
import type { RefreshActionResult } from "@/app/journal/refresh-action";
import { TimeZoneStep } from "@/app/journal/time-zone-step";
import { AppShell } from "@/components/journal/app-shell";
import { JournalNarrative } from "@/components/journal/journal-narrative";
import { MetricOverview } from "@/components/journal/metric-overview";
import { StateBlock } from "@/components/journal/state-block";
import { StatusChip } from "@/components/journal/status-chip";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import type { StoredGitHubInstallation } from "@/lib/github-installation";
import { getGitHubJournalCompleteness } from "@/lib/github-completeness";
import type { JournalOnboarding } from "@/lib/journal";
import type { TodayJournal } from "@/lib/github-reconciliation";
import type { JournalSession } from "@/lib/session";
import { describeJournalStatus } from "@/lib/today-journal";
import { type JournalSummary } from "@/lib/journal-summary";
import { cn } from "@/lib/utils";

function formatTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

/**
 * Onboarding step 2 — frame 1l of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`).
 *
 * This is the one place the reference sanctions two differentiated choice
 * surfaces: a real fork with real consequences. Shape and tone carry the
 * recommendation; the fallback stays a genuine, unpunished choice.
 */
function RepositoryAccessStep({
  canReturn,
  installations,
}: {
  canReturn: boolean;
  installations: StoredGitHubInstallation[];
}) {
  const approvalPending = installations.some(
    (installation) => installation.status === "pending",
  );

  return (
    <section
      aria-labelledby="repository-access-heading"
      className="mx-auto max-w-[72ch]"
    >
      <p className="text-m3-label-lg text-m3-on-surface-variant">Step 2 of 2</p>
      <h1
        id="repository-access-heading"
        className="mt-2 text-m3-headline-lg text-balance"
      >
        Choose what your journal can see
      </h1>
      <p className="mt-3 text-m3-body-lg text-m3-on-surface-variant">
        GitHub sign-in proves who you are. Installing the GitHub App is a
        separate choice that lets Coding Journal read activity from only the
        repositories you select.
      </p>
      <p className="mt-3 text-m3-body-md text-m3-on-surface-variant">
        <Link
          href="/data-access"
          className="rounded-m3-xs underline underline-offset-2"
        >
          What each permission is used for
        </Link>{" "}
        — read-only, scoped to what you pick, and revocable on GitHub at any
        time.
      </p>

      <div className="mt-8 grid gap-4">
        <article className="rounded-m3-xl bg-m3-primary-container p-6 text-m3-on-primary-container sm:p-7">
          <h2 className="text-m3-title-lg">Install the GitHub App</h2>
          <p className="mt-2 text-m3-body-md">
            Read-only, near-real-time coverage of the repositories you pick —
            selected or all. Recommended.
          </p>
          {approvalPending ? (
            <p role="status" className="mt-4 text-m3-body-md">
              <span className="text-m3-label-lg">Pending approval.</span> An
              organization owner must approve your request. You can continue in
              best-effort mode while you wait.
            </p>
          ) : null}
          <Link
            href="/api/github/install?from=onboarding"
            className={cn(
              buttonVariants({ size: "lg" }),
              "mt-6 w-full sm:w-auto",
            )}
          >
            Install GitHub App
          </Link>
        </article>

        <article className="rounded-m3-md border border-m3-outline-variant p-6 sm:p-7">
          <h2 className="text-m3-title-md">Continue without installing</h2>
          <p className="mt-2 text-m3-body-md text-m3-on-surface-variant">
            Open Today now. Coverage is limited to what GitHub exposes without
            installation, and every day stays labelled best-effort.
          </p>
          <form action={skipGitHubAppInstallation} className="mt-5">
            <Button
              type="submit"
              variant="outline"
              size="lg"
              className="w-full sm:w-auto"
            >
              Continue in best-effort mode
            </Button>
          </form>
        </article>
      </div>

      {canReturn ? (
        <Link
          href="/journal"
          className={cn(buttonVariants({ variant: "ghost" }), "mt-6 -ml-4")}
        >
          Back to Today
        </Link>
      ) : null}
    </section>
  );
}

/**
 * Today — frames 1g (expanded) and 1h (compact) of the look-and-feel reference.
 *
 * One display-scale date, one honest completeness sentence, one primary
 * action. Below it a compact metric strip, the tertiary narrative surface, and
 * the activity list — all on level 0, structured by dividers rather than by a
 * container per datum. Freshness and coverage move into a supporting pane at
 * expanded widths and fall to the end of the reading order on compact, which
 * is where the reference's focus order puts them.
 */
function Today({
  timeZone,
  installations,
  journal,
  summary,
  nextSyncAt,
  refresh,
}: {
  timeZone: string;
  installations: StoredGitHubInstallation[];
  journal: TodayJournal;
  summary: JournalSummary | null;
  nextSyncAt: Date | null;
  refresh: () => Promise<RefreshActionResult>;
}) {
  const localDate = {
    iso: journal.localDate,
    long: new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date(`${journal.localDate}T00:00:00Z`)),
  };
  const disconnected = installations.some(
    (installation) => installation.status === "disconnected",
  );
  const pending = installations.some(
    (installation) => installation.status === "pending",
  );
  const activeCompleteness = getGitHubJournalCompleteness(installations);
  const completeness = activeCompleteness
    ? activeCompleteness
    : pending
      ? { label: "Pending approval", detail: "Organization access not granted" }
      : disconnected
        ? { label: "Disconnected", detail: "Repository access unavailable" }
        : {
            label: "Best-effort journal",
            detail: "Repository access not connected",
          };

  return (
    <div className="m3-expanded:grid m3-expanded:grid-cols-[minmax(0,1fr)_20rem] m3-expanded:items-start m3-expanded:gap-10">
      <div className="min-w-0 m3-large:max-w-[72ch]">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <p className="text-m3-label-lg text-m3-on-surface-variant">Today</p>
            <h1 className="mt-1 text-m3-headline-lg text-balance m3-expanded:text-m3-display-sm">
              <time dateTime={localDate.iso}>{localDate.long}</time>
            </h1>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-m3-body-md text-m3-on-surface-variant">
              <span>{timeZone}</span>
              <span aria-hidden>·</span>
              <span className="text-m3-on-surface">{completeness.label}</span>
              <span aria-hidden>·</span>
              <span className="wrap-anywhere">{completeness.detail}</span>
            </p>
          </div>
          <JournalRefresh
            refresh={refresh}
            nextSyncAt={nextSyncAt?.toISOString() ?? null}
            timeZone={timeZone}
          />
        </div>

        <MetricOverview
          metrics={journal.metrics}
          eventCount={journal.activities.length}
          headingId="today-metrics-heading"
          className="mt-8"
        />

        <JournalNarrative
          narrative={summary?.output ?? null}
          evidence={journal.activities}
          generatedAt={
            summary?.createdAt ? formatTime(summary.createdAt, timeZone) : null
          }
          emptyMessage="No narrative yet. A summary appears after a successful refresh when generation and allowance are available. The recorded journal below is unaffected."
        />

        {journal.activities.length === 0 ? (
          <TodayEmptyState journal={journal} />
        ) : (
          <JournalExplorer
            activities={journal.activities}
            timeZone={timeZone}
          />
        )}
      </div>

      <JournalStatusPane
        journal={journal}
        timeZone={timeZone}
        localDate={localDate.iso}
      />
    </div>
  );
}

function TodayEmptyState({ journal }: { journal: TodayJournal }) {
  const description = describeJournalStatus({
    status: journal.status,
    awaitingReconciliation: journal.awaitingReconciliation,
  });

  return (
    <StateBlock
      headingId="empty-today-heading"
      title={description.emptyTitle}
      size="expressive"
      className="mt-8"
      action={
        <Link
          href="/journal?setup=repositories"
          className={buttonVariants({ size: "lg" })}
        >
          Review repository access
        </Link>
      }
    >
      {description.emptyDetail}
    </StateBlock>
  );
}

/**
 * Supporting pane — freshness, reconciliation and secondary-source coverage.
 * Sticky beside the reading column at expanded widths; last in the reading and
 * focus order on compact, exactly where the reference's focus order puts it.
 * Stored facts never dim while any of these are true.
 */
function JournalStatusPane({
  journal,
  timeZone,
  localDate,
}: {
  journal: TodayJournal;
  timeZone: string;
  localDate: string;
}) {
  const reconciled = journal.refreshedAt
    ? formatTime(journal.refreshedAt, timeZone)
    : null;
  const stored = journal.storedAt
    ? formatTime(journal.storedAt, timeZone)
    : reconciled;
  const description = describeJournalStatus({
    status: journal.status,
    awaitingReconciliation: journal.awaitingReconciliation,
    reconciledLabel: reconciled,
  });

  return (
    <aside
      aria-label="Journal status"
      className="mt-10 grid gap-6 m3-expanded:sticky m3-expanded:top-6 m3-expanded:mt-0"
    >
      <section aria-labelledby="journal-freshness-heading">
        <h2
          id="journal-freshness-heading"
          className="text-m3-title-sm text-m3-on-surface"
        >
          Freshness
        </h2>
        <dl className="mt-2 divide-y divide-m3-outline-variant border-y border-m3-outline-variant">
          {[
            ["Local day", localDate],
            ["Stored update", stored ?? "Awaiting stored activity"],
            ["GitHub reconciled", reconciled ?? "Not completed yet"],
          ].map(([term, value]) => (
            <div
              key={term}
              className="flex flex-wrap items-baseline justify-between gap-x-4 py-2"
            >
              <dt className="text-m3-body-md text-m3-on-surface-variant">
                {term}
              </dt>
              <dd className="text-m3-body-md text-m3-on-surface tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <StateBlock
          role="status"
          title={description.paneTitle}
          tone={
            journal.status === "error"
              ? "error"
              : journal.status === "partial"
                ? "warning"
                : "neutral"
          }
          className="mt-3"
        >
          {description.paneDetail}
        </StateBlock>
      </section>

      {journal.sourceFreshness?.length ? (
        <section aria-labelledby="secondary-source-heading">
          <h2
            id="secondary-source-heading"
            className="text-m3-title-sm text-m3-on-surface"
          >
            Secondary source coverage
          </h2>
          <dl className="mt-2 divide-y divide-m3-outline-variant border-y border-m3-outline-variant">
            {journal.sourceFreshness.map((source) => {
              const sourceTime = source.refreshedAt
                ? formatTime(source.refreshedAt, timeZone)
                : null;
              return (
                <div key={source.source} className="py-3">
                  <dt className="text-m3-body-md text-m3-on-surface">
                    {source.label}
                  </dt>
                  <dd className="mt-1">
                    <StatusChip tone={sourceTime ? "neutral" : "warning"}>
                      {source.status === "best-effort" && sourceTime
                        ? `Best-effort · refreshed at ${sourceTime}`
                        : "Unavailable during this refresh"}
                    </StatusChip>
                    <p className="mt-1 text-m3-body-sm text-m3-on-surface-variant">
                      {source.detail}
                    </p>
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="mt-2 text-m3-body-sm text-m3-on-surface-variant">
            Stored facts stay visible whatever these say.
          </p>
        </section>
      ) : null}
    </aside>
  );
}

/**
 * The boundaries this page reaches. They are parameters rather than module
 * imports so a test can supply real stand-ins and still render the page it is
 * describing.
 */
export type JournalPageDependencies = {
  requestHeaders: Headers;
  getSession: (requestHeaders: Headers) => Promise<JournalSession | null>;
  getOnboarding: (
    userId: string,
    requestHeaders: Headers,
  ) => Promise<JournalOnboarding>;
  getInstallations: (userId: string) => Promise<StoredGitHubInstallation[]>;
  readToday: (input: { userId: string; timeZone: string }) => Promise<{
    journal: TodayJournal;
    narrative: JournalSummary | null;
    nextSyncAt: Date | null;
  }>;
  /** The server action the refresh button runs. */
  refresh: () => Promise<RefreshActionResult>;
  redirect: (destination: string) => never;
};

export async function renderJournalPage(
  searchParams: Promise<{ setup?: string }>,
  {
    requestHeaders,
    getSession,
    getOnboarding,
    getInstallations,
    readToday,
    refresh,
    redirect,
  }: JournalPageDependencies,
) {
  const session = await getSession(requestHeaders);

  if (!session) return redirect("/sign-in?next=%2Fjournal");

  const [onboarding, installations, query] = await Promise.all([
    getOnboarding(session.user.id, requestHeaders),
    getInstallations(session.user.id),
    searchParams,
  ]);

  const todayRead =
    onboarding.timeZone &&
    onboarding.githubAccessMode &&
    query.setup !== "repositories"
      ? await readToday({
          userId: session.user.id,
          timeZone: onboarding.timeZone,
        })
      : null;
  const today = todayRead?.journal ?? null;
  const summary = todayRead?.narrative ?? null;

  const onboardingStep = !onboarding.timeZone || !onboarding.githubAccessMode;

  return (
    <AppShell current="today" navigation={!onboardingStep}>
      {!onboarding.timeZone ? (
        <TimeZoneStep />
      ) : !onboarding.githubAccessMode || query.setup === "repositories" ? (
        <RepositoryAccessStep
          canReturn={Boolean(onboarding.githubAccessMode)}
          installations={installations}
        />
      ) : today ? (
        <Today
          refresh={refresh}
          timeZone={onboarding.timeZone}
          installations={installations}
          journal={today}
          summary={summary}
          nextSyncAt={todayRead?.nextSyncAt ?? null}
        />
      ) : null}
    </AppShell>
  );
}
