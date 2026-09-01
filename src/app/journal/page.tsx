import {
  AlertTriangle,
  CalendarDays,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Clock3,
  FileCheck,
  FileText,
  GitCommitHorizontal,
  GitBranch,
  GitMerge,
  GitPullRequest,
  LayoutDashboard,
  MessageSquare,
  MessagesSquare,
  Rocket,
  ShieldCheck,
  Star,
  Upload,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { skipGitHubAppInstallation } from "@/app/journal/actions";
import { JournalExplorer } from "@/app/journal/journal-explorer";
import { JournalFrame } from "@/app/journal/journal-frame";
import { JournalRefresh } from "@/app/journal/journal-refresh";
import { TimeZoneStep } from "@/app/journal/time-zone-step";
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
      className="mx-auto max-w-4xl"
    >
      <p className="text-m3-label-lg-emphasized text-primary">STEP 2 OF 2</p>
      <h1
        id="repository-access-heading"
        className="mt-3 max-w-3xl text-m3-headline-lg text-balance"
      >
        Choose what your journal can see
      </h1>
      <p className="mt-4 max-w-2xl text-m3-body-lg text-muted-foreground">
        GitHub sign-in proves who you are. Installing the GitHub App is a
        separate choice that lets Coding Journal read activity from only the
        repositories you select.
      </p>

      <div className="mt-9 grid gap-5 md:grid-cols-2">
        <article className="rounded-m3-xl bg-m3-surface-container-low p-6 sm:p-7">
          <span className="bg-primary-container grid size-12 place-items-center rounded-m3-lg text-primary">
            <GitBranch aria-hidden />
          </span>
          <h2 className="text-m3-title-lg-emphasized mt-6">
            GitHub App access
          </h2>
          <p className="mt-3 text-m3-body-md text-muted-foreground">
            Selected repositories can be tracked with near-real-time, read-only
            access. GitHub lets you choose selected repositories or all
            repositories before anything is granted.
          </p>
          {approvalPending ? (
            <div
              role="status"
              className="bg-secondary-container mt-5 rounded-m3-lg p-4"
            >
              <p className="text-m3-label-lg-emphasized">Pending approval</p>
              <p className="mt-1 text-m3-body-sm">
                An organization owner must approve your request. You can
                continue in best-effort mode while you wait.
              </p>
            </div>
          ) : (
            <p className="mt-5 text-m3-label-lg text-muted-foreground">
              No repository access has been granted yet.
            </p>
          )}
          <Link
            href="/api/github/install?from=onboarding"
            className={cn(
              buttonVariants({ size: "lg" }),
              "mt-6 w-full md:w-auto",
            )}
          >
            Install GitHub App
          </Link>
        </article>

        <article className="rounded-m3-xl bg-card p-6 shadow-m3-2 sm:p-7">
          <span className="bg-secondary-container grid size-12 place-items-center rounded-m3-lg text-secondary-foreground">
            <ShieldCheck aria-hidden />
          </span>
          <h2 className="text-m3-title-lg-emphasized mt-6">
            Continue without installation
          </h2>
          <p className="mt-3 text-m3-body-md text-muted-foreground">
            You can open Today now. Coverage will be limited to activity GitHub
            exposes without repository installation, and every journal will stay
            clearly labeled best-effort.
          </p>
          <form action={skipGitHubAppInstallation} className="mt-6">
            <Button type="submit" size="lg" className="w-full md:w-auto">
              Continue in best-effort mode
            </Button>
          </form>
        </article>
      </div>

      {canReturn ? (
        <Link
          href="/journal"
          className={cn(buttonVariants({ variant: "ghost" }), "mt-6")}
        >
          Back to Today
        </Link>
      ) : null}
    </section>
  );
}

function Today({
  name,
  timeZone,
  installations,
  journal,
  summary,
}: {
  name: string;
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
  const firstName = name.trim().split(/\s+/)[0] || "there";
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
    <>
      <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="text-m3-label-lg-emphasized text-primary">
            WELCOME, {firstName.toUpperCase()}
          </p>
          <h1 className="mt-3 text-m3-headline-lg text-balance">
            Today, <time dateTime={localDate.iso}>{localDate.long}</time>
          </h1>
          <p className="mt-3 flex items-center gap-2 text-m3-body-md text-muted-foreground">
            <CalendarDays aria-hidden className="size-5" />
            <span>{timeZone}</span>
          </p>
        </div>
        <div className="grid justify-items-start gap-2 lg:justify-items-end">
          <p className="bg-primary-container text-m3-label-md-emphasized w-fit rounded-m3-full px-3 py-1.5 text-primary">
            Live
          </p>
          <div
            role="status"
            className="bg-secondary-container w-fit rounded-m3-lg px-4 py-3 text-secondary-foreground"
          >
            <p className="text-m3-label-lg-emphasized">{completeness.label}</p>
            <p className="mt-1 text-m3-body-sm">{completeness.detail}</p>
          </div>
        </div>
      </div>

      <JournalActivity
        journal={journal}
        summary={summary}
        timeZone={timeZone}
      />
    </>
  );
}

function pluralizedMetric(
  count: number,
  singular: string,
  plural = `${singular}s`,
) {
  return `${count} ${count === 1 ? singular : plural}`;
}

const metricCards: Array<{
  key: keyof TodayJournal["metrics"];
  singular: string;
  plural?: string;
  detail: string;
  icon: LucideIcon;
}> = [
  {
    key: "pushes",
    singular: "push",
    plural: "pushes",
    detail: "Counted when each push occurred",
    icon: Upload,
  },
  {
    key: "commits",
    singular: "commit",
    detail: "Kept at each commit's author time",
    icon: GitCommitHorizontal,
  },
  {
    key: "refs",
    singular: "ref change",
    detail: "Events feed in best-effort; webhooks with App access",
    icon: GitBranch,
  },
  {
    key: "releases",
    singular: "release update",
    detail: "Releases you published or updated",
    icon: Rocket,
  },
  {
    key: "discussions",
    singular: "discussion update",
    detail: "Comments and answers require GitHub App access",
    icon: MessagesSquare,
  },
  {
    key: "issues",
    singular: "issue update",
    detail: "Issues you opened, closed, or reopened",
    icon: CircleDot,
  },
  {
    key: "pullRequests",
    singular: "pull request update",
    detail: "Pull requests you opened, updated, closed, or reopened",
    icon: GitPullRequest,
  },
  {
    key: "reviews",
    singular: "review",
    detail: "Reviews you submitted on pull requests",
    icon: FileCheck,
  },
  {
    key: "merges",
    singular: "merge",
    detail: "Pull requests you merged",
    icon: GitMerge,
  },
  {
    key: "comments",
    singular: "comment",
    detail: "Comments on issues, pull requests, and diffs",
    icon: MessageSquare,
  },
  {
    key: "workflows",
    singular: "workflow run",
    detail: "Manual dispatches, reruns, and approved runs",
    icon: CircleCheck,
  },
  {
    key: "deployments",
    singular: "deployment",
    detail: "Only outcomes linked to your activity",
    icon: Rocket,
  },
  {
    key: "packages",
    singular: "package update",
    detail: "Publications and updates count toward your journal",
    icon: Upload,
  },
  {
    key: "projects",
    singular: "project update",
    detail: "Organization Projects preview webhooks · best-effort",
    icon: LayoutDashboard,
  },
  {
    key: "gists",
    singular: "Gist update",
    detail: "Metadata-only reconciliation · best-effort",
    icon: FileText,
  },
  {
    key: "social",
    singular: "social action",
    detail: "Excluded completely from the AI narrative",
    icon: Star,
  },
];

function JournalActivity({
  journal,
  summary,
  timeZone,
}: {
  journal: TodayJournal;
  summary: JournalSummary | null;
  timeZone: string;
}) {
  const freshness = journal.refreshedAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
      }).format(journal.refreshedAt)
    : null;
  const storedFreshness = journal.storedAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
      }).format(journal.storedAt)
    : freshness;
  const nextSyncAt = journal.lastAttemptAt
    ? new Date(
        journal.lastAttemptAt.getTime() + reconciliationCooldownMs,
      ).toISOString()
    : null;
  const evidence = new Map(
    summaryEvidenceLinks(journal.activities).map((item) => [item.id, item]),
  );

  return (
    <div className="mt-10">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricCards.map((card, index) => (
          <article
            key={card.key}
            className="rounded-m3-xl bg-card p-5 shadow-m3-1 sm:p-6"
          >
            <span
              className={cn(
                "grid size-11 place-items-center rounded-m3-lg",
                index % 2 === 0
                  ? "bg-primary-container text-primary"
                  : "bg-secondary-container text-secondary-foreground",
              )}
            >
              <card.icon aria-hidden className="size-5" />
            </span>
            <p className="mt-5 text-m3-headline-sm">
              {pluralizedMetric(
                journal.metrics[card.key],
                card.singular,
                card.plural,
              )}
            </p>
            <p className="mt-1 text-m3-body-sm text-muted-foreground">
              {card.detail}
            </p>
          </article>
        ))}
      </div>

      <section
        aria-labelledby="journal-freshness-heading"
        className="mt-5 grid gap-4 rounded-m3-xl bg-m3-surface-container-low p-5 sm:grid-cols-3 sm:p-6"
      >
        <div>
          <h2
            id="journal-freshness-heading"
            className="text-m3-label-lg-emphasized"
          >
            Journal freshness
          </h2>
          <p className="mt-1 text-m3-body-sm text-muted-foreground">
            Local day · {journal.localDate} · {timeZone}
          </p>
        </div>
        <div>
          <p className="text-m3-label-lg-emphasized">Last stored update</p>
          <p className="mt-1 text-m3-body-sm text-muted-foreground">
            {storedFreshness ?? "Waiting for stored activity"}
          </p>
        </div>
        <div>
          <p className="text-m3-label-lg-emphasized">
            Last GitHub reconciliation
          </p>
          <p className="mt-1 text-m3-body-sm text-muted-foreground">
            {freshness ?? "Not completed yet"}
          </p>
        </div>
        <div className="sm:col-span-3">
          <JournalRefresh nextSyncAt={nextSyncAt} timeZone={timeZone} />
        </div>
      </section>

      <section
        aria-labelledby="summary-heading"
        className="mt-5 rounded-m3-2xl bg-card p-5 shadow-m3-1 sm:p-7"
      >
        <p className="text-m3-label-lg-emphasized text-primary">
          DAILY NARRATIVE
        </p>
        <h2 id="summary-heading" className="mt-2 text-m3-headline-sm">
          Your day, distilled
        </h2>
        {summary ? (
          <div className="mt-4 grid gap-6">
            <p className="max-w-3xl text-m3-body-lg">
              {summary.output.overview}
            </p>
            {summary.output.accomplishments.length ? (
              <div>
                <h3 className="text-m3-title-md-emphasized">Accomplishments</h3>
                <div className="mt-3 grid gap-3">
                  {summary.output.accomplishments.map((claim, index) => {
                    const repository = evidence.get(claim.evidenceIds[0] ?? "");
                    return (
                      <article
                        key={`${claim.repositoryId}-${index}`}
                        className="rounded-m3-lg bg-m3-surface-container-low p-4"
                      >
                        <p className="text-m3-label-md text-muted-foreground">
                          {repository?.repositoryName ?? "Repository"}
                        </p>
                        <p className="mt-1 text-m3-body-md">{claim.summary}</p>
                        <EvidenceLinks
                          ids={claim.evidenceIds}
                          evidence={evidence}
                        />
                      </article>
                    );
                  })}
                </div>
              </div>
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
          </div>
        ) : (
          <p className="mt-3 max-w-2xl text-m3-body-md text-muted-foreground">
            The deterministic journal remains available. A narrative will appear
            after a successful refresh when AI generation and allowance are
            available.
          </p>
        )}
      </section>

      <div
        role="status"
        className={cn(
          "mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-m3-lg px-4 py-3 text-m3-body-sm",
          journal.status === "error"
            ? "bg-m3-error-container text-m3-on-error-container"
            : journal.status === "partial"
              ? "bg-m3-warning-container text-m3-on-warning-container"
              : "bg-m3-surface-container text-muted-foreground",
        )}
      >
        {journal.status === "error" || journal.status === "partial" ? (
          <AlertTriangle aria-hidden className="size-5 shrink-0" />
        ) : (
          <Clock3 aria-hidden className="size-5 shrink-0" />
        )}
        <span className="font-m3-medium">
          {journal.awaitingReconciliation
            ? "GitHub reconciliation pending"
            : journal.status === "loading"
              ? "Reconciling today's GitHub activity"
              : journal.status === "partial"
                ? "Partial GitHub response"
                : journal.status === "error"
                  ? "GitHub reconciliation unavailable"
                  : "GitHub activity reconciled"}
        </span>
        <span>
          {journal.awaitingReconciliation
            ? "Refresh Today when you want to check GitHub."
            : journal.status === "partial"
              ? "Some granted sources could not be refreshed."
              : journal.status === "error"
                ? "Stored activity remains available while GitHub recovers."
                : freshness
                  ? `Updated at ${freshness}.`
                  : "This may take a moment."}
        </span>
      </div>

      {journal.sourceFreshness?.length ? (
        <section
          aria-labelledby="secondary-source-heading"
          className="mt-8 rounded-m3-2xl bg-m3-surface-container-low p-5 sm:p-6"
        >
          <p className="text-m3-label-lg-emphasized text-primary">
            BEST-EFFORT COVERAGE
          </p>
          <h2
            id="secondary-source-heading"
            className="text-m3-title-lg-emphasized mt-2"
          >
            Secondary source coverage
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {journal.sourceFreshness.map((source) => {
              const sourceTime = source.refreshedAt
                ? new Intl.DateTimeFormat("en-US", {
                    timeZone,
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(source.refreshedAt)
                : null;
              return (
                <article
                  key={source.source}
                  className="rounded-m3-xl bg-card p-4 shadow-m3-1"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-m3-title-md-emphasized">
                      {source.label}
                    </h3>
                    <p className="text-m3-label-md text-muted-foreground">
                      {source.status === "best-effort" && sourceTime
                        ? `Best-effort · refreshed at ${sourceTime}`
                        : "Unavailable during this refresh"}
                    </p>
                  </div>
                  <p className="mt-2 text-m3-body-sm text-muted-foreground">
                    {source.detail}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {journal.activities.length === 0 ? (
        <section
          aria-labelledby="empty-today-heading"
          className="mt-5 rounded-m3-2xl bg-m3-surface-container-low px-6 py-14 text-center sm:px-10 sm:py-18"
        >
          <span className="bg-surface mx-auto grid size-16 place-items-center rounded-m3-xl text-primary shadow-m3-1">
            <CircleDashed aria-hidden className="size-8" />
          </span>
          <h2
            id="empty-today-heading"
            className="mt-6 text-m3-headline-sm text-balance"
          >
            {journal.awaitingReconciliation
              ? "Your day is ready to refresh"
              : journal.status === "error"
                ? "Today could not be refreshed"
                : journal.status === "loading"
                  ? "Your day is being reconciled"
                  : "Your day is ready to take shape"}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-m3-body-md text-muted-foreground">
            {journal.awaitingReconciliation
              ? "Stored activity is shown immediately. Use Refresh Today to start the first GitHub reconciliation."
              : journal.status === "error"
                ? "GitHub did not return activity right now. Try opening Today again after the reconciliation cooldown."
                : "There is no activity in this journal yet. Without repository access, Coding Journal may miss private work and delayed GitHub events."}
          </p>
          <Link
            href="/journal?setup=repositories"
            className={cn(buttonVariants({ size: "lg" }), "mt-7")}
          >
            Review repository access
          </Link>
        </section>
      ) : (
        <JournalExplorer activities={journal.activities} timeZone={timeZone} />
      )}
    </div>
  );
}

function EvidenceLinks({
  ids,
  evidence,
}: {
  ids: string[];
  evidence: Map<string, ReturnType<typeof summaryEvidenceLinks>[number]>;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      {ids.flatMap((id) => {
        const item = evidence.get(id);
        return item
          ? [
              <a
                key={id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-m3-label-md-emphasized text-primary underline underline-offset-4"
              >
                View evidence
              </a>,
            ]
          : [];
      })}
    </div>
  );
}

function SummaryClaims({
  title,
  claims,
  evidence,
}: {
  title: string;
  claims: Array<{ summary: string; evidenceIds: string[] }>;
  evidence: Map<string, ReturnType<typeof summaryEvidenceLinks>[number]>;
}) {
  return (
    <div>
      <h3 className="text-m3-title-md-emphasized">{title}</h3>
      <div className="mt-2 grid gap-3">
        {claims.map((claim, index) => (
          <article
            key={`${title}-${index}`}
            className="rounded-m3-lg bg-m3-surface-container-low p-4"
          >
            <p className="text-m3-body-md">{claim.summary}</p>
            <EvidenceLinks ids={claim.evidenceIds} evidence={evidence} />
          </article>
        ))}
      </div>
    </div>
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

  return (
    <JournalFrame>
      {!onboarding.timeZone ? (
        <TimeZoneStep />
      ) : !onboarding.githubAccessMode || query.setup === "repositories" ? (
        <RepositoryAccessStep
          canReturn={Boolean(onboarding.githubAccessMode)}
          installations={installations}
        />
      ) : today ? (
        <Today
          name={session.user.name}
          timeZone={onboarding.timeZone}
          installations={installations}
          journal={today}
          summary={summary}
        />
      ) : null}
    </JournalFrame>
  );
}
