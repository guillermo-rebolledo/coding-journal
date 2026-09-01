"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { githubActivityRepository } from "@/lib/github-activity-repository";
import { isE2EJournalUser } from "@/lib/e2e-fixtures";
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

export type TimeZoneActionState = { error: string | null };
export type RefreshActionResult = {
  outcome: "reconciled" | "cooldown" | "rate-limited" | "unavailable";
  message: string;
  nextSyncAt: string | null;
};

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
  const timeZone = normalizeTimeZone(formData.get("timeZone"));
  if (!timeZone) return { error: "Enter a valid IANA time zone." };

  await saveJournalTimeZone(currentUser.id, timeZone);
  redirect("/journal");
}

export async function skipGitHubAppInstallation() {
  const currentUser = await requireUser();
  await chooseBestEffortMode(currentUser.id);
  redirect("/journal");
}

export async function refreshTodayJournal(): Promise<RefreshActionResult> {
  const requestHeaders = await headers();
  const session = await getJournalSession(requestHeaders);
  if (!session) redirect("/sign-in?next=%2Fjournal");

  const onboarding = await getJournalOnboarding(session.user.id);
  if (!onboarding.timeZone || !onboarding.githubAccessMode) {
    return {
      outcome: "unavailable",
      message: "Finish journal setup before refreshing Today.",
      nextSyncAt: null,
    };
  }

  const now = new Date();
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
