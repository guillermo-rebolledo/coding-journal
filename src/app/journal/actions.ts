"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  runConfirmTimeZone,
  runSkipGitHubAppInstallation,
  type OnboardingActionDependencies,
  type TimeZoneActionState,
} from "@/app/journal/onboarding-actions";
import {
  runRefreshTodayJournal,
  type RefreshActionResult,
  type RefreshDependencies,
} from "@/app/journal/refresh-action";
import {
  E2E_ONBOARDING_COOKIE,
  isE2EJournalUser,
  type E2EOnboardingStage,
} from "@/lib/e2e-fixtures";
import { githubActivityRepository } from "@/lib/github-activity-repository";
import { getGitHubInstallations } from "@/lib/github-installation";
import { chooseBestEffortMode, saveJournalTimeZone } from "@/lib/journal";
import { getJournalOnboarding } from "@/lib/journal";
import { generateJournalSummary } from "@/lib/journal-summary";
import { journalSummaryRepository } from "@/lib/journal-summary-repository";
import { openAiSummaryProvider } from "@/lib/openai-summary";
import { spendRequestBudget } from "@/lib/request-budget";
import { getJournalSession } from "@/lib/session";
import { getTodayJournal } from "@/lib/today-journal";

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

/** The production wiring for both onboarding actions. */
async function onboardingDependencies(): Promise<OnboardingActionDependencies> {
  return {
    requestHeaders: await headers(),
    getSession: getJournalSession,
    isFixtureUser: isE2EJournalUser,
    recordFixtureStage: recordFixtureOnboarding,
    saveTimeZone: saveJournalTimeZone,
    chooseBestEffort: chooseBestEffortMode,
    redirect,
  };
}

const limitEvents = {
  "journal-refresh": "journal-refresh-limited",
  "github-sync-daily": "github-sync-budget-exhausted",
} as const;

/** The production wiring for the manual refresh. */
async function refreshDependencies(): Promise<RefreshDependencies> {
  return {
    requestHeaders: await headers(),
    getSession: getJournalSession,
    getOnboarding: getJournalOnboarding,
    spendBudget: (policy, userId, now) =>
      spendRequestBudget({
        policy,
        userId,
        now,
        event: limitEvents[policy],
        // The product-wide GitHub budget is the backstop behind the per-user
        // rules, and is attributed to the provider rather than a person.
        service: policy === "github-sync-daily" ? "github" : undefined,
      }),
    readStoredJournal: (userId, localDate) =>
      githubActivityRepository.read(userId, localDate),
    getInstallations: getGitHubInstallations,
    reconcile: getTodayJournal,
    summarize: ({ userId, localDate, activities, now }) =>
      generateJournalSummary({
        userId,
        localDate,
        activities,
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
      }),
    isFixtureUser: isE2EJournalUser,
    redirect,
  };
}

export async function confirmTimeZone(
  _previousState: TimeZoneActionState,
  formData: FormData,
): Promise<TimeZoneActionState> {
  return runConfirmTimeZone(formData, await onboardingDependencies());
}

export async function skipGitHubAppInstallation() {
  return runSkipGitHubAppInstallation(await onboardingDependencies());
}

export async function refreshTodayJournal(): Promise<RefreshActionResult> {
  return runRefreshTodayJournal(await refreshDependencies());
}
