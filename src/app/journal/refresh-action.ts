import type { StoredGitHubInstallation } from "@/lib/github-installation";
import {
  reconciliationCooldownMs,
  getLocalDayWindow,
  type ActivityRecord,
  type TodayJournal,
} from "@/lib/github-reconciliation";
import { JournalNotFoundError } from "@/lib/journal-errors";
import type { JournalOnboarding } from "@/lib/journal";
import type { SummaryResult } from "@/lib/journal-summary";
import { rateLimitMessage, type RateLimitDecision } from "@/lib/rate-limit";
import type { JournalSession } from "@/lib/session";

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

/**
 * A refused request states what happened, what still works, and when it
 * returns — the same sentence shape every limit in the product uses, so the
 * recorded journal below it never has to look degraded.
 */
function limitedResult(
  decision: RateLimitDecision,
  now: Date,
): RefreshActionResult {
  return {
    outcome: "limited",
    message: rateLimitMessage(decision, now),
    nextSyncAt: decision.resetAt.toISOString(),
  };
}

/**
 * The boundaries a manual refresh reaches. They are parameters rather than
 * module imports so a test can supply real stand-ins and still exercise the
 * budget, cooldown and rate-limit reporting this action owns.
 */
export type RefreshDependencies = {
  requestHeaders: Headers;
  getSession: (requestHeaders: Headers) => Promise<JournalSession | null>;
  getOnboarding: (
    userId: string,
    requestHeaders: Headers,
  ) => Promise<JournalOnboarding>;
  spendBudget: (
    policy: "journal-refresh" | "github-sync-daily",
    userId: string | null,
    now: Date,
  ) => Promise<RateLimitDecision | null>;
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
  }) => Promise<SummaryResult>;
  isFixtureUser: (userId: string) => boolean;
  redirect: (destination: string) => never;
};

export async function runRefreshTodayJournal({
  requestHeaders,
  getSession,
  getOnboarding,
  spendBudget,
  readStoredJournal,
  getInstallations,
  reconcile,
  summarize,
  isFixtureUser,
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
  const userBudget = await spendBudget("journal-refresh", session.user.id, now);
  if (userBudget && !userBudget.allowed) return limitedResult(userBudget, now);

  const localDate = getLocalDayWindow(now, onboarding.timeZone).localDate;
  let storedJournal: TodayJournal | null = null;
  if (!isFixtureUser(session.user.id)) {
    try {
      storedJournal = await readStoredJournal(session.user.id, localDate);
    } catch (error) {
      if (!(error instanceof JournalNotFoundError)) {
        throw error;
      }
      // A first refresh has no stored day yet; reconciliation initializes it.
    }
  }

  const nextCooldownAt = storedJournal?.lastAttemptAt
    ? new Date(storedJournal.lastAttemptAt.getTime() + reconciliationCooldownMs)
    : null;
  if (nextCooldownAt && nextCooldownAt > now) {
    return {
      outcome: "cooldown",
      message: "Stored activity reloaded. GitHub sync is cooling down.",
      nextSyncAt: nextCooldownAt.toISOString(),
    };
  }

  // The product-wide GitHub budget is the backstop behind the per-user rules:
  // it is spent only when a reconciliation is actually about to run.
  const globalBudget = isFixtureUser(session.user.id)
    ? null
    : await spendBudget("github-sync-daily", null, now);
  if (globalBudget && !globalBudget.allowed)
    return limitedResult(globalBudget, now);

  const installations = await getInstallations(session.user.id);
  const journal = await reconcile({
    requestHeaders,
    userId: session.user.id,
    timeZone: onboarding.timeZone,
    accessMode: onboarding.githubAccessMode,
    installations,
    now,
  });
  let summaryResult: SummaryResult | null = null;
  if (journal.status !== "error" && !isFixtureUser(session.user.id)) {
    summaryResult = await summarize({
      userId: session.user.id,
      localDate: journal.localDate,
      activities: journal.activities,
      now,
    });
  }
  if (journal.rateLimitedUntil) {
    const cooldownEndsAt = journal.lastAttemptAt
      ? new Date(journal.lastAttemptAt.getTime() + reconciliationCooldownMs)
      : new Date(now.getTime() + reconciliationCooldownMs);
    const nextSyncAt =
      journal.rateLimitedUntil > cooldownEndsAt
        ? journal.rateLimitedUntil
        : cooldownEndsAt;
    return {
      outcome: "rate-limited",
      message: "Stored activity reloaded. GitHub rate limit reached.",
      nextSyncAt: nextSyncAt.toISOString(),
    };
  }

  return {
    outcome: journal.status === "error" ? "unavailable" : "reconciled",
    message: refreshMessage(journal.status, summaryResult),
    nextSyncAt: journal.lastAttemptAt
      ? new Date(
          journal.lastAttemptAt.getTime() + reconciliationCooldownMs,
        ).toISOString()
      : new Date(now.getTime() + reconciliationCooldownMs).toISOString(),
  };
}

function refreshMessage(
  journalStatus: "loading" | "complete" | "partial" | "error",
  summary: SummaryResult | null,
) {
  if (journalStatus === "error")
    return "Stored activity reloaded. GitHub could not sync right now.";
  const base = "Stored activity reloaded and GitHub reconciliation finished.";
  if (summary?.status !== "unavailable") return base;
  if (summary.reason === "cooldown")
    return `${base} The narrative is cooling down.`;
  if (summary.reason === "daily-exhausted")
    return `${base} Today's narrative allowance is exhausted.`;
  if (summary.reason === "global-paused")
    return `${base} Narrative generation is globally paused.`;
  if (summary.reason === "budget-exhausted")
    return `${base} The monthly narrative budget is exhausted.`;
  if (summary.reason === "input-too-large" || summary.reason === "queue-busy")
    return `${base} Narrative generation is temporarily paused by a service limit.`;
  return base;
}
