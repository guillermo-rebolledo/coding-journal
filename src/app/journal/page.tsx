import {
  CalendarDays,
  CircleDashed,
  GitBranch,
  Settings,
  ShieldCheck,
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
import { getJournalSession } from "@/lib/session";
import { getLocalDate } from "@/lib/time-zone";
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
}: {
  name: string;
  timeZone: string;
  installations: StoredGitHubInstallation[];
}) {
  const localDate = getLocalDate(new Date(), timeZone);
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

      <section
        aria-labelledby="empty-today-heading"
        className="mt-10 rounded-m3-2xl bg-m3-surface-container-low px-6 py-14 text-center sm:px-10 sm:py-18"
      >
        <span className="bg-surface mx-auto grid size-16 place-items-center rounded-m3-xl text-primary shadow-m3-1">
          <CircleDashed aria-hidden className="size-8" />
        </span>
        <h2
          id="empty-today-heading"
          className="mt-6 text-m3-headline-sm text-balance"
        >
          Your day is ready to take shape
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-m3-body-md text-muted-foreground">
          There is no activity in this journal yet. Without repository access,
          Coding Journal may miss private work and delayed GitHub events.
        </p>
        <Link
          href="/journal?setup=repositories"
          className={cn(buttonVariants({ size: "lg" }), "mt-7")}
        >
          Review repository access
        </Link>
      </section>
    </>
  );
}

export default async function JournalPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ setup?: string }>;
} = {}) {
  const session = await getJournalSession(await headers());

  if (!session) redirect("/sign-in?next=%2Fjournal");

  const [onboarding, installations, query] = await Promise.all([
    getJournalOnboarding(session.user.id),
    getGitHubInstallations(session.user.id),
    searchParams,
  ]);

  return (
    <JournalFrame>
      {!onboarding.timeZone ? (
        <TimeZoneStep />
      ) : !onboarding.githubAccessMode || query.setup === "repositories" ? (
        <RepositoryAccessStep
          canReturn={Boolean(onboarding.githubAccessMode)}
          installations={installations}
        />
      ) : (
        <Today
          name={session.user.name}
          timeZone={onboarding.timeZone}
          installations={installations}
        />
      )}
    </JournalFrame>
  );
}
