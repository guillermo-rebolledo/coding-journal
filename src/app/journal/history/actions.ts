"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  journalFinalizationTopic,
  type JournalFinalizationMessage,
} from "@/lib/journal-finalization";
import { journalFinalizationRepository } from "@/lib/journal-finalization-repository";
import { queuePublisher } from "@/lib/queue";
import { rateLimitMessage } from "@/lib/rate-limit";
import { spendRequestBudget } from "@/lib/request-budget";
import { getJournalSession } from "@/lib/session";
import { logServiceEvent } from "@/lib/telemetry";

/**
 * Both history actions answer with the same three-part sentence — what
 * happened, what still works, when it returns — so a refused retry reads like
 * every other limit in the product and never implies the finalized record has
 * become unavailable.
 */
export type HistoryActionResult = {
  status: "idle" | "accepted" | "limited" | "unavailable";
  message: string;
};

function validLocalDate(localDate: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(localDate);
}

async function authenticatedUserId() {
  const session = await getJournalSession(await headers());
  if (!session) redirect("/sign-in?next=%2Fjournal%2Fhistory");
  return session.user.id;
}

export async function retryHistoricalJournal(
  localDate: string,
): Promise<HistoryActionResult> {
  if (!validLocalDate(localDate)) return { status: "idle", message: "" };
  const userId = await authenticatedUserId();
  const now = new Date();

  const budget = await spendRequestBudget({
    policy: "finalization-retry",
    userId,
    now,
    event: "finalization-retry-limited",
  });
  if (budget && !budget.allowed) {
    return { status: "limited", message: rateLimitMessage(budget, now) };
  }

  const retry = await journalFinalizationRepository.retry(userId, localDate);
  if (!retry) {
    return {
      status: "unavailable",
      message:
        "This day cannot be retried right now. The finalized record stays readable. Try again after the current attempt finishes.",
    };
  }
  const message: JournalFinalizationMessage = {
    version: 1,
    userId,
    localDate,
    timeZone: retry.timeZone,
  };
  try {
    await queuePublisher.publish(
      journalFinalizationTopic,
      message,
      `journal-finalization-retry:${userId}:${localDate}:${retry.attemptCount + 1}`,
    );
  } catch (error) {
    await journalFinalizationRepository.fail(
      userId,
      localDate,
      "reconciliation-failed",
      true,
    );
    throw error;
  }
  logServiceEvent({
    category: "finalization",
    event: "retry-queued",
    outcome: "ok",
    userId,
    jobId: `${userId}:${localDate}`,
    attempt: retry.attemptCount + 1,
  });
  revalidatePath(`/journal/history/${localDate}`);
  revalidatePath("/journal/history");
  return {
    status: "accepted",
    message:
      "Finalization queued. The recorded day stays readable while it runs.",
  };
}

export async function redactHistoricalNarrative(
  localDate: string,
): Promise<HistoryActionResult> {
  if (!validLocalDate(localDate)) return { status: "idle", message: "" };
  const userId = await authenticatedUserId();
  const now = new Date();

  const budget = await spendRequestBudget({
    policy: "narrative-redaction",
    userId,
    now,
    event: "narrative-redaction-limited",
  });
  if (budget && !budget.allowed) {
    return { status: "limited", message: rateLimitMessage(budget, now) };
  }

  await journalFinalizationRepository.redactNarrative(userId, localDate);
  logServiceEvent({
    category: "privacy",
    event: "narrative-redacted",
    outcome: "ok",
    userId,
    jobId: `${userId}:${localDate}`,
  });
  revalidatePath(`/journal/history/${localDate}`);
  return {
    status: "accepted",
    message:
      "Narrative removed. The day's recorded facts and metrics are unchanged.",
  };
}
