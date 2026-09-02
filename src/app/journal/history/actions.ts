"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { journalFinalizationRepository } from "@/lib/journal-finalization-repository";
import { queuePublisher } from "@/lib/queue";
import { spendRequestBudget } from "@/lib/request-budget";
import { getJournalSession } from "@/lib/session";

import {
  runRedactHistoricalNarrative,
  runRetryHistoricalJournal,
  type HistoryActionDependencies,
  type HistoryActionResult,
} from "./history-actions";

const limitEvents = {
  "finalization-retry": "finalization-retry-limited",
  "narrative-redaction": "narrative-redaction-limited",
} as const;

/** The production wiring for both history actions. */
async function historyDependencies(): Promise<HistoryActionDependencies> {
  return {
    requestHeaders: await headers(),
    getSession: getJournalSession,
    spendBudget: (policy, userId, now) =>
      spendRequestBudget({ policy, userId, now, event: limitEvents[policy] }),
    store: journalFinalizationRepository,
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
