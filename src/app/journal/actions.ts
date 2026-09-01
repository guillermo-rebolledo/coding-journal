"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { githubActivityRepository } from "@/lib/github-activity-repository";
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
  const isE2EUser =
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_MODE === "true" &&
    session.user.id.startsWith("e2e-");
  if (!isE2EUser) {
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
    message:
      journal.status === "error"
        ? "Stored activity reloaded. GitHub could not sync right now."
        : "Stored activity reloaded and GitHub reconciliation finished.",
    nextSyncAt: journal.lastAttemptAt
      ? new Date(
          journal.lastAttemptAt.getTime() + reconciliationCooldownMs,
        ).toISOString()
      : new Date(now.getTime() + reconciliationCooldownMs).toISOString(),
  };
}
