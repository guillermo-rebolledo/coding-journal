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
import { getJournalSession } from "@/lib/session";

function validLocalDate(localDate: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(localDate);
}

async function authenticatedUserId() {
  const session = await getJournalSession(await headers());
  if (!session) redirect("/sign-in?next=%2Fjournal%2Fhistory");
  return session.user.id;
}

export async function retryHistoricalJournal(localDate: string) {
  if (!validLocalDate(localDate)) return;
  const userId = await authenticatedUserId();
  const retry = await journalFinalizationRepository.retry(userId, localDate);
  if (!retry) return;
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
  revalidatePath(`/journal/history/${localDate}`);
  revalidatePath("/journal/history");
}

export async function redactHistoricalNarrative(localDate: string) {
  if (!validLocalDate(localDate)) return;
  const userId = await authenticatedUserId();
  await journalFinalizationRepository.redactNarrative(userId, localDate);
  revalidatePath(`/journal/history/${localDate}`);
}
