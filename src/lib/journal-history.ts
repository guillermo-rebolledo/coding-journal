import type { ActivityMetrics, ActivityRecord } from "@/lib/github-activity";
import type {
  FinalizationCandidate,
  FinalizationFailure,
} from "@/lib/journal-finalization";
import type { SummaryOutput } from "@/lib/journal-summary";

export type JournalHistoryItem = {
  localDate: string;
  timeZone: string;
  status: "finalizing" | "finalized" | "corrected" | "recoverable-error";
  completeness: "loading" | "complete" | "partial" | "error" | null;
  finalizedAt: Date | null;
  correctionCount: number;
};

/**
 * Activity already stored for a closed day whose immutable journal has not
 * been created yet. Keeping this separate from `JournalHistoryItem` prevents a
 * waiting day from looking linkable or finalized before either is true.
 */
export type PendingHistoryDay = {
  localDate: string;
  eventCount: number;
  repositoryCount: number;
};

export type HistoricalJournal = JournalHistoryItem & {
  metrics: ActivityMetrics | null;
  narrative: SummaryOutput | null;
  evidence: ActivityRecord[];
  corrections: ActivityRecord[];
  failure: FinalizationFailure | null;
};

/** The complete persistence seam for listing, reading and mutating history. */
export type JournalHistoryStore = {
  list(userId: string): Promise<JournalHistoryItem[]>;
  listPending(
    userId: string,
    beforeLocalDate: string,
  ): Promise<PendingHistoryDay[]>;
  read(userId: string, localDate: string): Promise<HistoricalJournal | null>;
  retry(
    userId: string,
    localDate: string,
    now?: Date,
  ): Promise<(FinalizationCandidate & { attemptCount: number }) | null>;
  redactNarrative(
    userId: string,
    localDate: string,
    now?: Date,
  ): Promise<boolean>;
  fail(
    userId: string,
    localDate: string,
    failure: FinalizationFailure,
    terminal: boolean,
  ): Promise<void>;
};

export function validHistoricalLocalDate(localDate: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(localDate);
}
