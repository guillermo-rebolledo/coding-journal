import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CircleDashed,
  Clock3,
  GitCommitHorizontal,
  GitBranch,
  LockKeyhole,
  Settings,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { skipGitHubAppInstallation } from "@/app/journal/actions";
import { TimeZoneStep } from "@/app/journal/time-zone-step";
import { BrandMark } from "@/components/brand-mark";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeMenu } from "@/components/theme-menu";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  getGitHubInstallations,
  type StoredGitHubInstallation,
} from "@/lib/github-installation";
import { getGitHubInstallationCompleteness } from "@/lib/github-completeness";
import { getJournalOnboarding } from "@/lib/journal";
import type { TodayJournal } from "@/lib/github-reconciliation";
import { getJournalSession } from "@/lib/session";
import { getTodayJournal } from "@/lib/today-journal";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Journal" };
export const dynamic = "force-dynamic";

function JournalFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background">
        <nav
          aria-label="Journal navigation"
          className="mx-auto flex min-h-20 max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6"
        >
          <div className="flex min-h-11 items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-m3-title-md-emphasized">Coding Journal</p>
              <p className="text-m3-body-sm text-muted-foreground">
                Your private journal
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Link
              href="/settings"
              aria-label="Settings"
              className={buttonVariants({
                variant: "ghost",
                size: "icon-lg",
                shape: "round",
              })}
            >
              <Settings aria-hidden />
            </Link>
            <ThemeMenu />
            <SignOutButton />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
        {children}
      </main>
    </div>
  );
}

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
}: {
  name: string;
  timeZone: string;
  installations: StoredGitHubInstallation[];
  journal: TodayJournal;
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
  const activeInstallation = installations.find(
    (installation) => installation.status === "active",
  );
  const disconnected = installations.some(
    (installation) => installation.status === "disconnected",
  );
  const pending = installations.some(
    (installation) => installation.status === "pending",
  );
  const activeCompleteness = activeInstallation
    ? getGitHubInstallationCompleteness(activeInstallation)
    : null;
  const completeness = activeCompleteness
    ? activeCompleteness.kind === "partial"
      ? {
          label: activeCompleteness.label,
          detail: `${activeCompleteness.repositoryCount} selected repositories`,
        }
      : { label: activeCompleteness.label, detail: "All granted repositories" }
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
        <div
          role="status"
          className="bg-secondary-container w-fit rounded-m3-lg px-4 py-3 text-secondary-foreground"
        >
          <p className="text-m3-label-lg-emphasized">{completeness.label}</p>
          <p className="mt-1 text-m3-body-sm">{completeness.detail}</p>
        </div>
      </div>

      <JournalActivity journal={journal} timeZone={timeZone} />
    </>
  );
}

function pluralizedMetric(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function JournalActivity({
  journal,
  timeZone,
}: {
  journal: TodayJournal;
  timeZone: string;
}) {
  const freshness = journal.refreshedAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
      }).format(journal.refreshedAt)
    : null;

  return (
    <div className="mt-10">
      <div className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-m3-xl bg-card p-5 shadow-m3-1 sm:p-6">
          <span className="bg-primary-container grid size-11 place-items-center rounded-m3-lg text-primary">
            <Upload aria-hidden className="size-5" />
          </span>
          <p className="mt-5 text-m3-headline-sm">
            {pluralizedMetric(journal.metrics.pushes, "push")}
          </p>
          <p className="mt-1 text-m3-body-sm text-muted-foreground">
            Counted when each push occurred
          </p>
        </article>
        <article className="rounded-m3-xl bg-card p-5 shadow-m3-1 sm:p-6">
          <span className="bg-secondary-container grid size-11 place-items-center rounded-m3-lg text-secondary-foreground">
            <GitCommitHorizontal aria-hidden className="size-5" />
          </span>
          <p className="mt-5 text-m3-headline-sm">
            {pluralizedMetric(journal.metrics.commits, "commit")}
          </p>
          <p className="mt-1 text-m3-body-sm text-muted-foreground">
            Kept at each commit&apos;s author time
          </p>
        </article>
      </div>

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
          {journal.status === "loading"
            ? "Reconciling today's GitHub activity"
            : journal.status === "partial"
              ? "Partial GitHub response"
              : journal.status === "error"
                ? "GitHub reconciliation unavailable"
                : "GitHub activity reconciled"}
        </span>
        <span>
          {journal.status === "partial"
            ? "Some granted sources could not be refreshed."
            : journal.status === "error"
              ? "Stored activity remains available while GitHub recovers."
              : freshness
                ? `Updated at ${freshness}.`
                : "This may take a moment."}
        </span>
      </div>

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
            {journal.status === "error"
              ? "Today could not be refreshed"
              : journal.status === "loading"
                ? "Your day is being reconciled"
                : "Your day is ready to take shape"}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-m3-body-md text-muted-foreground">
            {journal.status === "error"
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
        <section aria-labelledby="today-timeline-heading" className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-m3-label-lg-emphasized text-primary">
                CHRONOLOGICAL
              </p>
              <h2
                id="today-timeline-heading"
                className="mt-2 text-m3-headline-sm"
              >
                Today&apos;s activity
              </h2>
            </div>
            {freshness ? (
              <p className="text-m3-body-sm text-muted-foreground">
                Fresh as of {freshness}
              </p>
            ) : null}
          </div>
          <ol className="mt-5 space-y-3">
            {journal.activities.map((activity) => (
              <li
                key={activity.deduplicationKey}
                className="rounded-m3-xl bg-m3-surface-container-low p-5 sm:p-6"
              >
                <div className="flex gap-4">
                  <span className="bg-surface grid size-11 shrink-0 place-items-center rounded-m3-lg text-primary shadow-m3-1">
                    {activity.kind === "push" ? (
                      <Upload aria-hidden className="size-5" />
                    ) : (
                      <GitCommitHorizontal aria-hidden className="size-5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-m3-title-md-emphasized capitalize">
                        {activity.kind}
                      </h3>
                      {activity.visibility === "private" ? (
                        <span className="bg-secondary-container inline-flex items-center gap-1 rounded-m3-full px-2.5 py-1 text-m3-label-sm text-secondary-foreground">
                          <LockKeyhole aria-hidden className="size-3.5" />
                          Private repository
                        </span>
                      ) : null}
                      {activity.authoredBeforeDay ? (
                        <span className="rounded-m3-full bg-m3-warning-container px-2.5 py-1 text-m3-label-sm text-m3-on-warning-container">
                          Authored before today
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-m3-body-md break-words">
                      {activity.repositoryName}
                    </p>
                    <p className="mt-1 text-m3-body-sm text-muted-foreground">
                      <time dateTime={activity.occurredAt.toISOString()}>
                        {new Intl.DateTimeFormat("en-US", {
                          timeZone,
                          hour: "numeric",
                          minute: "2-digit",
                          month: activity.authoredBeforeDay
                            ? "short"
                            : undefined,
                          day: activity.authoredBeforeDay
                            ? "numeric"
                            : undefined,
                        }).format(activity.occurredAt)}
                      </time>
                      {` · @${activity.actorLogin}`}
                    </p>
                    <a
                      href={activity.evidenceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-m3-label-lg-emphasized mt-3 inline-flex min-h-11 items-center gap-2 text-primary underline-offset-4 hover:underline"
                    >
                      View {activity.kind} evidence
                      <ArrowUpRight aria-hidden className="size-4" />
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
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
      ? await getTodayJournal({
          requestHeaders,
          userId: session.user.id,
          timeZone: onboarding.timeZone,
          accessMode: onboarding.githubAccessMode,
          installations,
        })
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
        />
      ) : null}
    </JournalFrame>
  );
}
