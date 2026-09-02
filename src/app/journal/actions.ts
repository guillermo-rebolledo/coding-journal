"use server";

import { headers } from "next/headers";
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
import { chooseJournalRequestAdapters } from "@/lib/journal-request-adapters";

/** The production wiring for both onboarding actions. */
async function onboardingDependencies(): Promise<OnboardingActionDependencies> {
  const requestHeaders = await headers();
  const adapters = chooseJournalRequestAdapters(requestHeaders);
  return {
    requestHeaders,
    getSession: adapters.session,
    saveTimeZone: adapters.onboarding.saveTimeZone,
    chooseBestEffort: adapters.onboarding.chooseBestEffort,
    redirect,
  };
}

/** The production wiring for the manual refresh. */
async function refreshDependencies(): Promise<RefreshDependencies> {
  const requestHeaders = await headers();
  const adapters = chooseJournalRequestAdapters(requestHeaders);
  return {
    requestHeaders,
    getSession: adapters.session,
    getOnboarding: adapters.onboarding.read,
    guard: (policy, userId, now, provider) =>
      adapters.guard(
        policy,
        userId,
        now,
        provider,
      ),
    readStoredJournal: adapters.reconciliation.readStored,
    getInstallations: adapters.installations,
    reconcile: adapters.reconciliation.reconcile,
    summarize: adapters.summary.generate,
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
