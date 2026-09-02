import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { skipGitHubAppInstallation } from "@/app/journal/actions";
import { JournalExplorer } from "@/app/journal/journal-explorer";
import { JournalRefresh } from "@/app/journal/journal-refresh";
import { TimeZoneStep } from "@/app/journal/time-zone-step";
import { AppShell } from "@/components/journal/app-shell";
import { EvidenceLink } from "@/components/journal/evidence-link";
import { MetricOverview } from "@/components/journal/metric-overview";
import { StateBlock } from "@/components/journal/state-block";
import { StatusChip } from "@/components/journal/status-chip";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  getGitHubInstallations,
  type StoredGitHubInstallation,
} from "@/lib/github-installation";
import { getGitHubJournalCompleteness } from "@/lib/github-completeness";
import { isE2EJournalUser } from "@/lib/e2e-fixtures";
import { getJournalOnboarding } from "@/lib/journal";
import {
  reconciliationCooldownMs,
  type TodayJournal,
} from "@/lib/github-reconciliation";
import { getJournalSession } from "@/lib/session";
import { getStoredTodayJournal } from "@/lib/today-journal";
import {
  buildSummarySnapshot,
  summaryEvidenceLinks,
  type JournalSummary,
} from "@/lib/journal-summary";
import { journalSummaryRepository } from "@/lib/journal-summary-repository";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Journal" };
export const dynamic = "force-dynamic";

type EvidenceIndex = Map<
  string,
  ReturnType<typeof summaryEvidenceLinks>[number]
>;

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
}: {
  timeZone: string;
  installations: StoredGitHubInstallation[];
  journal: TodayJournal;
  summary: JournalSummary | null;
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
            nextSyncAt={
              journal.lastAttemptAt
                ? new Date(
                    journal.lastAttemptAt.getTime() + reconciliationCooldownMs,
                  ).toISOString()
                : null
            }
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
          summary={summary}
          activities={journal.activities}
          timeZone={timeZone}
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
  const [title, body] = journal.awaitingReconciliation
    ? [
        "Your day is ready to refresh",
        "Nothing has been reconciled with GitHub yet today. Stored activity, if any, is already shown.",
      ]
    : journal.status === "error"
      ? [
          "Today could not be refreshed",
          "GitHub did not respond. Everything already stored is shown and stays usable. Try again after the reconciliation cooldown.",
        ]
      : journal.status === "loading"
        ? [
            "Reconciling your day",
            "Checking the repositories Coding Journal can see. This usually takes a few seconds.",
          ]
        : [
            "Nothing recorded today",
            "Coding Journal reconciled with GitHub and found no activity. Private or delayed work outside the repositories it can see would not appear here.",
          ];

  return (
    <StateBlock
      headingId="empty-today-heading"
      title={title}
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
      {body}
    </StateBlock>
  );
}

/**
 * The narrative slot — pattern 9. The only tertiary-tinted, 28dp surface in
 * the product, so you can tell at a glance which sentences a model wrote.
 * Degrading it never touches the deterministic journal above or below.
 */
function JournalNarrative({
  summary,
  activities,
  timeZone,
}: {
  summary: JournalSummary | null;
  activities: TodayJournal["activities"];
  timeZone: string;
}) {
  const evidence: EvidenceIndex = new Map(
    summaryEvidenceLinks(activities).map((item) => [item.id, item]),
  );
  const generatedAt = summary?.createdAt
    ? formatTime(summary.createdAt, timeZone)
    : null;

  return (
    <section
      aria-labelledby="summary-heading"
      className={cn(
        "mt-8 rounded-m3-xl p-6 sm:p-7",
        summary
          ? "bg-m3-tertiary-container text-m3-on-tertiary-container"
          : "bg-m3-surface-container-low text-m3-on-surface",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="summary-heading" className="text-m3-title-lg">
          Written for you
        </h2>
        <p className="text-m3-label-md">
          Read-only{generatedAt ? ` · generated ${generatedAt}` : null}
        </p>
      </div>
      {summary ? (
        <div className="mt-4 grid gap-6">
          <p className="max-w-[62ch] text-m3-body-lg">
            {summary.output.overview}
          </p>
          {summary.output.accomplishments.length ? (
            <SummaryClaims
              title="Accomplishments"
              claims={summary.output.accomplishments}
              evidence={evidence}
              withRepository
            />
          ) : null}
          {summary.output.collaboration.length ? (
            <SummaryClaims
              title="Reviews and collaboration"
              claims={summary.output.collaboration}
              evidence={evidence}
            />
          ) : null}
          {summary.output.inProgress.length ? (
            <SummaryClaims
              title="In progress"
              claims={summary.output.inProgress}
              evidence={evidence}
            />
          ) : null}
          <p className="text-m3-body-sm">
            Every claim links to the recorded event it came from. Gists and
            social activity are excluded from the narrative.
          </p>
        </div>
      ) : (
        <p className="mt-3 max-w-[62ch] text-m3-body-md text-m3-on-surface-variant">
          No narrative yet. A summary appears after a successful refresh when
          generation and allowance are available. The recorded journal below is
          unaffected.
        </p>
      )}
    </section>
  );
}

function SummaryClaims({
  title,
  claims,
  evidence,
  withRepository = false,
}: {
  title: string;
  claims: Array<{ summary: string; evidenceIds: string[] }>;
  evidence: EvidenceIndex;
  withRepository?: boolean;
}) {
  return (
    <div>
      <h3 className="text-m3-title-sm">{title}</h3>
      <ul className="mt-2 grid gap-4">
        {claims.map((claim, index) => {
          const repository = withRepository
            ? evidence.get(claim.evidenceIds[0] ?? "")?.repositoryName
            : null;
          return (
            <li key={`${title}-${index}`} className="max-w-[62ch]">
              {repository ? (
                <p className="text-m3-label-md wrap-anywhere">{repository}</p>
              ) : null}
              <p className="text-m3-body-md">{claim.summary}</p>
              <div className="flex flex-wrap gap-x-4">
                {claim.evidenceIds.flatMap((id) => {
                  const item = evidence.get(id);
                  return item
                    ? [<EvidenceLink key={id} href={item.url} noun="source" />]
                    : [];
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
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
  const statusTitle = journal.awaitingReconciliation
    ? "GitHub reconciliation pending"
    : journal.status === "loading"
      ? "Reconciling today's GitHub activity"
      : journal.status === "partial"
        ? "Partial GitHub response"
        : journal.status === "error"
          ? "GitHub reconciliation unavailable"
          : "GitHub activity reconciled";
  const statusDetail = journal.awaitingReconciliation
    ? "Refresh Today when you want to check GitHub."
    : journal.status === "partial"
      ? "Some granted sources could not be refreshed."
      : journal.status === "error"
        ? "Stored activity remains available while GitHub recovers."
        : reconciled
          ? `Updated at ${reconciled}.`
          : "This may take a moment.";

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
          title={statusTitle}
          tone={
            journal.status === "error"
              ? "error"
              : journal.status === "partial"
                ? "warning"
                : "neutral"
          }
          className="mt-3"
        >
          {statusDetail}
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

export default async function JournalPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ setup?: string }>;
} = {}) {
  const requestHeaders = await headers();
  const session = await getJournalSession(requestHeaders);

  if (!session) redirect("/sign-in?next=%2Fjournal");

  const [onboarding, installations, query] = await Promise.all([
    getJournalOnboarding(session.user.id),
    getGitHubInstallations(session.user.id),
    searchParams,
  ]);

  const today =
    onboarding.timeZone &&
    onboarding.githubAccessMode &&
    query.setup !== "repositories"
      ? await getStoredTodayJournal({
          requestHeaders,
          userId: session.user.id,
          timeZone: onboarding.timeZone,
          accessMode: onboarding.githubAccessMode,
          installations,
        })
      : null;
  const summary =
    today && !isE2EJournalUser(session.user.id)
      ? await journalSummaryRepository.findBySnapshotHash(
          session.user.id,
          buildSummarySnapshot(today.activities).hash,
        )
      : null;

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
          timeZone={onboarding.timeZone}
          installations={installations}
          journal={today}
          summary={summary}
        />
      ) : null}
    </AppShell>
  );
}
