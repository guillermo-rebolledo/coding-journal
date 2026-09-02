import type { ActivityRecord } from "@/lib/github-activity";
import type { StoredGitHubInstallation } from "@/lib/github-installation";
import type { TodayJournal } from "@/lib/github-reconciliation";
import { JournalNotFoundError } from "@/lib/journal-errors";
import type { JournalOnboarding } from "@/lib/journal";
import {
  summaryUnavailableMessage,
  type SummaryResult,
} from "@/lib/journal-summary";
import type { GuardDecision } from "@/lib/request-guard";
import type { JournalSession } from "@/lib/session";
import { getLocalDayWindow } from "@/lib/time-zone";
import { nextJournalSyncAt } from "@/lib/today-journal-policy";

export type RefreshActionResult = {
  outcome:
    | "reconciled"
    | "cooldown"
    | "rate-limited"
    | "limited"
    | "unavailable";
  message: string;
  nextSyncAt: string | null;
};

/** Every boundary reached by the Today module's manual refresh operation. */
export type RefreshDependencies = {
  requestHeaders: Headers;
  getSession: (requestHeaders: Headers) => Promise<JournalSession | null>;
  getOnboarding: (
    userId: string,
    requestHeaders: Headers,
  ) => Promise<JournalOnboarding>;
  guard: (
    policy: "journal-refresh" | "github-sync-daily",
    userId: string | null,
    now: Date,
    provider?: "github",
  ) => Promise<GuardDecision>;
  readStoredJournal: (
    userId: string,
    localDate: string,
  ) => Promise<TodayJournal>;
  getInstallations: (userId: string) => Promise<StoredGitHubInstallation[]>;
  reconcile: (input: {
    requestHeaders: Headers;
    userId: string;
    timeZone: string;
    accessMode: "best-effort" | "app";
    installations: StoredGitHubInstallation[];
    now: Date;
  }) => Promise<TodayJournal & { rateLimitedUntil?: Date }>;
  summarize: (input: {
    userId: string;
    localDate: string;
    activities: ActivityRecord[];
    now: Date;
  }) => Promise<SummaryResult | null>;
  redirect: (destination: string) => never;
};

export async function refreshTodayJournal({
  requestHeaders,
  getSession,
  getOnboarding,
  guard,
  readStoredJournal,
  getInstallations,
  reconcile,
  summarize,
  redirect,
}: RefreshDependencies): Promise<RefreshActionResult> {
  const session = await getSession(requestHeaders);
  if (!session) return redirect("/sign-in?next=%2Fjournal");

  const onboarding = await getOnboarding(session.user.id, requestHeaders);
  if (!onboarding.timeZone || !onboarding.githubAccessMode) {
    return {
      outcome: "unavailable",
      message: "Finish journal setup before refreshing Today.",
      nextSyncAt: null,
    };
  }

  const now = new Date();
  const userGuard = await guard("journal-refresh", session.user.id, now);
  if (!userGuard.proceed) {
    return {
      outcome: userGuard.refusal.outcome,
      message: userGuard.refusal.message,
      nextSyncAt: userGuard.refusal.resumeAt.toISOString(),
    };
  }

  const localDate = getLocalDayWindow(now, onboarding.timeZone).localDate;
  let storedJournal: TodayJournal | null = null;
  try {
    storedJournal = await readStoredJournal(session.user.id, localDate);
  } catch (error) {
    if (!(error instanceof JournalNotFoundError)) throw error;
  }

  const nextCooldownAt = storedJournal?.lastAttemptAt
    ? nextJournalSyncAt(storedJournal.lastAttemptAt)
    : null;
  if (nextCooldownAt && nextCooldownAt > now) {
    return {
      outcome: "cooldown",
      message: "Stored activity reloaded. GitHub sync is cooling down.",
      nextSyncAt: nextCooldownAt.toISOString(),
    };
  }

  const globalGuard = await guard("github-sync-daily", null, now, "github");
  if (!globalGuard.proceed) {
    return {
      outcome: globalGuard.refusal.outcome,
      message: globalGuard.refusal.message,
      nextSyncAt: globalGuard.refusal.resumeAt.toISOString(),
    };
  }

  const installations = await getInstallations(session.user.id);
  const journal = await reconcile({
    requestHeaders,
    userId: session.user.id,
    timeZone: onboarding.timeZone,
    accessMode: onboarding.githubAccessMode,
    installations,
    now,
  });
  const summaryResult =
    journal.status === "error"
      ? null
      : await summarize({
          userId: session.user.id,
          localDate: journal.localDate,
          activities: journal.activities,
          now,
        });

  if (journal.rateLimitedUntil) {
    const cooldownEndsAt = journal.lastAttemptAt
      ? nextJournalSyncAt(journal.lastAttemptAt)
      : nextJournalSyncAt(now);
    return {
      outcome: "rate-limited",
      message: "Stored activity reloaded. GitHub rate limit reached.",
      nextSyncAt: (
        journal.rateLimitedUntil > cooldownEndsAt
          ? journal.rateLimitedUntil
          : cooldownEndsAt
      ).toISOString(),
    };
  }

  return {
    outcome: journal.status === "error" ? "unavailable" : "reconciled",
    message: refreshMessage(journal.status, summaryResult),
    nextSyncAt: (journal.lastAttemptAt
      ? nextJournalSyncAt(journal.lastAttemptAt)
      : nextJournalSyncAt(now)
    ).toISOString(),
  };
}

function refreshMessage(
  journalStatus: TodayJournal["status"],
  summary: SummaryResult | null,
) {
  if (journalStatus === "error")
    return "Stored activity reloaded. GitHub could not sync right now.";
  const base = "Stored activity reloaded and GitHub reconciliation finished.";
  if (summary?.status !== "unavailable") return base;
  return `${base} ${summaryUnavailableMessage(summary.reason)}`;
}
