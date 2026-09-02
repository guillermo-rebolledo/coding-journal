import { cookies } from "next/headers";

import { deleteJournalAccount } from "@/lib/account-deletion";
import {
  E2E_ONBOARDING_COOKIE,
  E2E_SESSION_COOKIE,
  getE2EGitHubInstallations,
  getE2EHistoricalJournal,
  getE2EJournalHistory,
  getE2EOnboardingProgress,
  getE2ESession,
  getE2ESessionMode,
  getE2ETodayJournal,
  type E2EOnboardingStage,
} from "@/lib/e2e-fixtures";
import { refreshGitHubConnections } from "@/lib/github-connection";
import { getRequiredEnv } from "@/lib/env";
import { githubActivityRepository } from "@/lib/github-activity-repository";
import { getGitHubInstallations } from "@/lib/github-installation";
import { getGitHubUserAccessToken } from "@/lib/github-user-token";
import {
  chooseBestEffortMode,
  getJournalOnboarding,
  saveJournalTimeZone,
} from "@/lib/journal";
import { journalFinalizationRepository } from "@/lib/journal-finalization-repository";
import {
  generateJournalSummary,
  type SummaryResult,
} from "@/lib/journal-summary";
import { journalSummaryRepository } from "@/lib/journal-summary-repository";
import { openAiSummaryProvider } from "@/lib/openai-summary";
import type { RateLimitPolicyName } from "@/lib/rate-limit";
import { spendRequestBudget } from "@/lib/request-budget";
import { guardAction } from "@/lib/request-guard";
import { serviceCircuitRepository } from "@/lib/service-circuit-repository";
import { getJournalSession } from "@/lib/session";
import {
  readTodayJournal,
  reconcileTodayJournalDay,
} from "@/lib/today-journal";
import type { IanaTimeZone } from "@/lib/time-zone";

async function recordFixtureOnboarding(stage: E2EOnboardingStage) {
  const store = await cookies();
  store.set(E2E_ONBOARDING_COOKIE, stage, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
  });
}

/**
 * All request-scoped journal boundaries. The fixture choice is made here once
 * from the existing development flag and session cookie; downstream domain
 * modules receive ordinary stores and functions and never inspect fixture
 * identity themselves.
 */
export function chooseJournalRequestAdapters(requestHeaders: Headers) {
  const fixtureMode =
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_MODE === "true"
      ? getE2ESessionMode(requestHeaders)
      : null;
  const fixtureSession = fixtureMode ? getE2ESession(requestHeaders) : null;

  if (fixtureMode && fixtureSession) {
    const fixtureUserId = fixtureSession.user.id;
    const fixtureInstallations = () =>
      Promise.resolve(getE2EGitHubInstallations(fixtureUserId));
    return {
      fixture: true as const,
      session: async () => fixtureSession,
      onboarding: {
        read: async (_userId: string, headers: Headers | null) =>
          getE2EOnboardingProgress(fixtureUserId, headers),
        saveTimeZone: async (userId: string, timeZone: IanaTimeZone) => {
          void userId;
          void timeZone;
          return recordFixtureOnboarding("time-zone");
        },
        chooseBestEffort: async (userId: string) => {
          void userId;
          return recordFixtureOnboarding("complete");
        },
      },
      installations: fixtureInstallations,
      refreshConnections: async () => fixtureInstallations(),
      reconciliation: {
        read: async ({ timeZone }: { userId: string; timeZone: string }) => ({
          journal: getE2ETodayJournal(fixtureUserId, timeZone),
          narrative: null,
          nextSyncAt: null,
        }),
        readStored: async () =>
          getE2ETodayJournal(fixtureUserId, "America/Mexico_City"),
        reconcile: async ({
          timeZone,
          now = new Date(),
        }: Parameters<typeof reconcileTodayJournalDay>[0]) =>
          getE2ETodayJournal(fixtureUserId, timeZone, now),
      },
      summary: {
        findBySnapshotHash: async () => null,
        generate: async (): Promise<SummaryResult | null> => null,
      },
      finalization: {
        list: async () => getE2EJournalHistory(),
        read: async (_userId: string, localDate: string) =>
          getE2EHistoricalJournal(localDate),
        retry: async () => null,
        redactNarrative: async () => false,
        fail: journalFinalizationRepository.fail,
      },
      budget: async () => null,
      guard: async () => ({ proceed: true as const }),
      endSession: async () => {
        const store = await cookies();
        store.delete(E2E_SESSION_COOKIE);
        store.delete(E2E_ONBOARDING_COOKIE);
      },
      deleteAccount: async () => {
        const store = await cookies();
        store.delete(E2E_SESSION_COOKIE);
        store.delete(E2E_ONBOARDING_COOKIE);
      },
    };
  }

  return {
    fixture: false as const,
    session: getJournalSession,
    onboarding: {
      read: getJournalOnboarding,
      saveTimeZone: saveJournalTimeZone,
      chooseBestEffort: chooseBestEffortMode,
    },
    installations: getGitHubInstallations,
    refreshConnections: refreshGitHubConnections,
    reconciliation: {
      read: readTodayJournal,
      readStored: (userId: string, localDate: string) =>
        githubActivityRepository.read(userId, localDate),
      reconcile: reconcileTodayJournalDay,
    },
    summary: {
      findBySnapshotHash: journalSummaryRepository.findBySnapshotHash,
      generate: ({
        userId,
        localDate,
        activities,
        now,
      }: {
        userId: string;
        localDate: string;
        activities: Parameters<typeof generateJournalSummary>[0]["activities"];
        now: Date;
      }) =>
        generateJournalSummary({
          userId,
          localDate,
          activities,
          store: journalSummaryRepository,
          provider: openAiSummaryProvider,
          now,
        }),
    },
    finalization: journalFinalizationRepository,
    budget: (
      policy: RateLimitPolicyName,
      userId: string | null,
      now: Date,
      service?: "github" | "openai",
    ) => spendRequestBudget({ policy, userId, now, service }),
    guard: (
      policy: RateLimitPolicyName,
      userId: string | null,
      now: Date,
      provider?: "github" | "openai",
    ) =>
      guardAction({
        policy,
        userId,
        now,
        provider,
        circuitStore: provider ? serviceCircuitRepository : undefined,
      }),
    endSession: async () => {},
    deleteAccount: async (requestHeaders: Headers, userId: string) => {
      const accessToken = await getGitHubUserAccessToken(
        requestHeaders,
        userId,
      ).catch(() => null);
      await deleteJournalAccount({
        userId,
        accessToken,
        clientId: getRequiredEnv("GITHUB_CLIENT_ID"),
        clientSecret: getRequiredEnv("GITHUB_CLIENT_SECRET"),
      });
    },
  };
}

export type JournalRequestAdapters = ReturnType<
  typeof chooseJournalRequestAdapters
>;
