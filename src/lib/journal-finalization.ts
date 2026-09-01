import type { ActivityMetrics, ActivityRecord } from "@/lib/github-activity";
import {
  buildSummarySnapshot,
  type SummaryOutput,
  type SummaryResult,
} from "@/lib/journal-summary";
import type { TodayJournal } from "@/lib/github-reconciliation";
import type { QueuePublisher } from "@/lib/queue";

export const journalFinalizationTopic = "journal-finalization";
const maximumAttempts = 5;

export type FinalizationCandidate = {
  userId: string;
  localDate: string;
  timeZone: string;
};

export type JournalFinalizationMessage = FinalizationCandidate & {
  version: 1;
};

export type FinalizedJournalInput = FinalizationCandidate & {
  completeness: TodayJournal["status"];
  metrics: ActivityMetrics;
  narrative: SummaryOutput | null;
  snapshotHash: string;
  evidenceKeys: string[];
  evidence: ActivityRecord[];
  finalizedAt: Date;
};

export type FinalizationFailure = "reconciliation-failed" | "summary-failed";

export type FinalizationStore = {
  findDueCandidates(now: Date): Promise<FinalizationCandidate[]>;
  schedule(candidate: FinalizationCandidate, now: Date): Promise<boolean>;
  claim(userId: string, localDate: string, now: Date): Promise<boolean>;
  finalize(input: FinalizedJournalInput): Promise<boolean>;
  fail(
    userId: string,
    localDate: string,
    failure: FinalizationFailure,
    terminal: boolean,
  ): Promise<void>;
};

type ReconcileFinalDay = (
  candidate: FinalizationCandidate,
) => Promise<TodayJournal>;

type GenerateFinalSummary = (input: {
  userId: string;
  localDate: string;
  activities: ActivityRecord[];
}) => Promise<SummaryResult>;

function idempotencyKey(candidate: FinalizationCandidate) {
  return `journal-finalization:${candidate.userId}:${candidate.localDate}`;
}

export async function enqueueDueJournalFinalizations(
  store: FinalizationStore,
  queue: QueuePublisher,
  now = new Date(),
) {
  const candidates = await store.findDueCandidates(now);
  let enqueued = 0;
  for (const candidate of candidates) {
    const scheduled = await store.schedule(candidate, now);
    if (!scheduled) continue;
    const message: JournalFinalizationMessage = { version: 1, ...candidate };
    try {
      await queue.publish(
        journalFinalizationTopic,
        message,
        idempotencyKey(candidate),
      );
      enqueued += 1;
    } catch (error) {
      await store.fail(
        candidate.userId,
        candidate.localDate,
        "reconciliation-failed",
        true,
      );
      throw error;
    }
  }
  return enqueued;
}

export function parseJournalFinalizationMessage(
  value: unknown,
): JournalFinalizationMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  return message.version === 1 &&
    typeof message.userId === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(message.localDate)) &&
    typeof message.timeZone === "string"
    ? (message as JournalFinalizationMessage)
    : null;
}

export async function processJournalFinalization(
  rawMessage: unknown,
  deliveryCount: number,
  store: FinalizationStore,
  reconcile: ReconcileFinalDay,
  summarize: GenerateFinalSummary,
  now = new Date(),
) {
  const message = parseJournalFinalizationMessage(rawMessage);
  if (!message) return;
  const claimed = await store.claim(message.userId, message.localDate, now);
  if (!claimed) return;

  let journal: TodayJournal;
  try {
    journal = await reconcile(message);
  } catch (error) {
    const terminal = deliveryCount >= maximumAttempts;
    await store.fail(
      message.userId,
      message.localDate,
      "reconciliation-failed",
      terminal,
    );
    if (!terminal) throw error;
    return;
  }

  if (journal.status === "error") {
    const terminal = deliveryCount >= maximumAttempts;
    await store.fail(
      message.userId,
      message.localDate,
      "reconciliation-failed",
      terminal,
    );
    if (!terminal) throw new Error("Final reconciliation was unavailable");
    return;
  }

  let summary: Awaited<ReturnType<GenerateFinalSummary>>;
  try {
    summary = await summarize({
      userId: message.userId,
      localDate: message.localDate,
      activities: journal.activities,
    });
  } catch (error) {
    const terminal = deliveryCount >= maximumAttempts;
    await store.fail(
      message.userId,
      message.localDate,
      "summary-failed",
      terminal,
    );
    if (!terminal) throw error;
    return;
  }

  const snapshot = buildSummarySnapshot(journal.activities);
  if (summary.status === "unavailable" && summary.reason !== "no-activity") {
    const terminal = deliveryCount >= maximumAttempts;
    await store.fail(
      message.userId,
      message.localDate,
      "summary-failed",
      terminal,
    );
    if (!terminal) throw new Error(`Summary unavailable: ${summary.reason}`);
    return;
  }

  await store.finalize({
    userId: message.userId,
    localDate: message.localDate,
    timeZone: message.timeZone,
    completeness: journal.status,
    metrics: journal.metrics,
    narrative: summary.status === "available" ? summary.summary.output : null,
    snapshotHash:
      summary.status === "available"
        ? summary.summary.snapshotHash
        : snapshot.hash,
    evidenceKeys: journal.activities.map(
      (activity) => activity.deduplicationKey,
    ),
    evidence: journal.activities,
    finalizedAt: now,
  });
}
