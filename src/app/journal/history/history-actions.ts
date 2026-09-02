import {
  journalFinalizationTopic,
  type JournalFinalizationMessage,
} from "@/lib/journal-finalization";
import {
  validHistoricalLocalDate,
  type JournalHistoryStore,
} from "@/lib/journal-history";
import type { QueuePublisher } from "@/lib/queue";
import { rateLimitMessage, type RateLimitDecision } from "@/lib/rate-limit";
import type { JournalSession } from "@/lib/session";
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

/**
 * The boundaries both history actions reach. They are parameters rather than
 * module imports so a test can supply real stand-ins and still exercise the
 * validation, budget and queue-failure handling these actions own.
 */
export type HistoryActionDependencies = {
  requestHeaders: Headers;
  getSession: (requestHeaders: Headers) => Promise<JournalSession | null>;
  spendBudget: (
    policy: "finalization-retry" | "narrative-redaction",
    userId: string,
    now: Date,
  ) => Promise<RateLimitDecision | null>;
  store: Pick<
    JournalHistoryStore,
    "fail" | "retry" | "redactNarrative"
  >;
  queue: QueuePublisher;
  revalidatePath: (path: string) => void;
  redirect: (destination: string) => never;
};

async function authenticatedUserId({
  requestHeaders,
  getSession,
  redirect,
}: HistoryActionDependencies) {
  const session = await getSession(requestHeaders);
  if (!session) return redirect("/sign-in?next=%2Fjournal%2Fhistory");
  return session.user.id;
}

export async function runRetryHistoricalJournal(
  localDate: string,
  dependencies: HistoryActionDependencies,
): Promise<HistoryActionResult> {
  if (!validHistoricalLocalDate(localDate))
    return { status: "idle", message: "" };
  const { store, queue, revalidatePath } = dependencies;
  const userId = await authenticatedUserId(dependencies);
  const now = new Date();

  const budget = await dependencies.spendBudget(
    "finalization-retry",
    userId,
    now,
  );
  if (budget && !budget.allowed) {
    return { status: "limited", message: rateLimitMessage(budget, now) };
  }

  const retry = await store.retry(userId, localDate);
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
    await queue.publish(
      journalFinalizationTopic,
      message,
      `journal-finalization-retry:${userId}:${localDate}:${retry.attemptCount + 1}`,
    );
  } catch (error) {
    await store.fail(userId, localDate, "reconciliation-failed", true);
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

export async function runRedactHistoricalNarrative(
  localDate: string,
  dependencies: HistoryActionDependencies,
): Promise<HistoryActionResult> {
  if (!validHistoricalLocalDate(localDate))
    return { status: "idle", message: "" };
  const { store, revalidatePath } = dependencies;
  const userId = await authenticatedUserId(dependencies);
  const now = new Date();

  const budget = await dependencies.spendBudget(
    "narrative-redaction",
    userId,
    now,
  );
  if (budget && !budget.allowed) {
    return { status: "limited", message: rateLimitMessage(budget, now) };
  }

  await store.redactNarrative(userId, localDate);
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
