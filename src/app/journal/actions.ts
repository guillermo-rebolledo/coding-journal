"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { githubActivityRepository } from "@/lib/github-activity-repository";
import {
  E2E_ONBOARDING_COOKIE,
  isE2EJournalUser,
  type E2EOnboardingStage,
} from "@/lib/e2e-fixtures";
import { getGitHubInstallations } from "@/lib/github-installation";
import {
  getLocalDayWindow,
  reconciliationCooldownMs,
} from "@/lib/github-reconciliation";
import { JournalNotFoundError } from "@/lib/journal-errors";
import { chooseBestEffortMode, saveJournalTimeZone } from "@/lib/journal";
import { getJournalOnboarding } from "@/lib/journal";
import { getJournalSession } from "@/lib/session";
import { normalizeTimeZone } from "@/lib/time-zone";
import { getTodayJournal } from "@/lib/today-journal";
import {
  generateJournalSummary,
  type SummaryResult,
} from "@/lib/journal-summary";
import { journalSummaryRepository } from "@/lib/journal-summary-repository";
import { openAiSummaryProvider } from "@/lib/openai-summary";
import { rateLimitMessage, type RateLimitDecision } from "@/lib/rate-limit";
import { spendRequestBudget } from "@/lib/request-budget";

export type TimeZoneActionState = { error: string | null };
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
 * A fixture user has no database row to write onboarding into, so the smoke
 * run's progress is recorded in a cookie instead. Everything else about the
 * action — validation, redirect, the rendered step — is the real path.
 */
async function recordFixtureOnboarding(stage: E2EOnboardingStage) {
  const store = await cookies();
  store.set(E2E_ONBOARDING_COOKIE, stage, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
  });
}

async function requireUser() {
  const session = await getJournalSession(await headers());
  if (!session) redirect("/sign-in?next=%2Fjournal");
  return session.user;
}

export async function confirmTimeZone(
  _previousState: TimeZoneActionState,
  formData: FormData,
): Promise<TimeZoneActionState> {
  const currentUser = await requireUser();
  // A submitted field is text or an upload; only text can name a time zone.
  const submitted = formData.get("timeZone");
  const timeZone = normalizeTimeZone(
    submitted instanceof File ? null : submitted,
  );
  if (!timeZone) return { error: "Enter a valid IANA time zone." };

  if (isE2EJournalUser(currentUser.id)) {
    await recordFixtureOnboarding("time-zone");
  } else {
    await saveJournalTimeZone(currentUser.id, timeZone);
  }
  redirect("/journal");
}

export async function skipGitHubAppInstallation() {
  const currentUser = await requireUser();
  if (isE2EJournalUser(currentUser.id)) {
    await recordFixtureOnboarding("complete");
  } else {
    await chooseBestEffortMode(currentUser.id);
  }
  redirect("/journal");
}

export async function refreshTodayJournal(): Promise<RefreshActionResult> {
  const requestHeaders = await headers();
  const session = await getJournalSession(requestHeaders);
  if (!session) redirect("/sign-in?next=%2Fjournal");

  const onboarding = await getJournalOnboarding(
    session.user.id,
    requestHeaders,
  );
  if (!onboarding.timeZone || !onboarding.githubAccessMode) {
    return {
      outcome: "unavailable",
      message: "Finish journal setup before refreshing Today.",
      nextSyncAt: null,
    };
  }

  const now = new Date();
  const userBudget = await spendRequestBudget({
    policy: "journal-refresh",
    userId: session.user.id,
    now,
    event: "journal-refresh-limited",
  });
  if (userBudget && !userBudget.allowed) return limitedResult(userBudget, now);

  const localDate = getLocalDayWindow(now, onboarding.timeZone).localDate;
  let storedJournal: Awaited<
    ReturnType<typeof githubActivityRepository.read>
  > | null = null;
  if (!isE2EJournalUser(session.user.id)) {
    try {
      storedJournal = await githubActivityRepository.read(
        session.user.id,
        localDate,
      );
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
  const globalBudget = isE2EJournalUser(session.user.id)
    ? null
    : await spendRequestBudget({
        policy: "github-sync-daily",
        now,
        event: "github-sync-budget-exhausted",
        service: "github",
      });
  if (globalBudget && !globalBudget.allowed)
    return limitedResult(globalBudget, now);

  const installations = await getGitHubInstallations(session.user.id);
  const journal = await getTodayJournal({
    requestHeaders,
    userId: session.user.id,
    timeZone: onboarding.timeZone,
    accessMode: onboarding.githubAccessMode,
    installations,
    now,
  });
  let summaryResult: SummaryResult | null = null;
  if (journal.status !== "error" && !isE2EJournalUser(session.user.id)) {
    summaryResult = await generateJournalSummary({
      userId: session.user.id,
      localDate: journal.localDate,
      activities: journal.activities,
      store: journalSummaryRepository,
      provider: openAiSummaryProvider,
      now,
      limits: {
        globalDaily: Number(process.env.SUMMARY_GLOBAL_DAILY_LIMIT) || 1_000,
        monthlySpendUsd:
          Number(process.env.SUMMARY_MONTHLY_SPEND_LIMIT_USD) || 100,
        maximumInputBytes:
          Number(process.env.SUMMARY_MAXIMUM_INPUT_BYTES) || 16_000,
        queueConcurrency: Number(process.env.SUMMARY_QUEUE_CONCURRENCY) || 5,
      },
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
