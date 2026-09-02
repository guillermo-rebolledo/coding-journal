"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { chooseJournalRequestAdapters } from "@/lib/journal-request-adapters";
import { queuePublisher } from "@/lib/queue";

import {
  runRedactHistoricalNarrative,
  runRetryHistoricalJournal,
  type HistoryActionDependencies,
  type HistoryActionResult,
} from "./history-actions";

/** The production wiring for both history actions. */
async function historyDependencies(): Promise<HistoryActionDependencies> {
  const requestHeaders = await headers();
  const adapters = chooseJournalRequestAdapters(requestHeaders);
  return {
    requestHeaders,
    getSession: adapters.session,
    guard: (policy, userId, now) => adapters.guard(policy, userId, now),
    store: adapters.finalization,
    queue: queuePublisher,
    revalidatePath,
    redirect,
  };
}

export async function retryHistoricalJournal(
  localDate: string,
): Promise<HistoryActionResult> {
  return runRetryHistoricalJournal(localDate, await historyDependencies());
}

export async function redactHistoricalNarrative(
  localDate: string,
): Promise<HistoryActionResult> {
  return runRedactHistoricalNarrative(localDate, await historyDependencies());
}
