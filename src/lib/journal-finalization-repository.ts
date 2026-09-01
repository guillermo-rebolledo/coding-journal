import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "@/db";
import {
  githubActivity,
  journalFinalization,
  journalOnboarding,
} from "@/db/auth-schema";
import type { ActivityMetrics, ActivityRecord } from "@/lib/github-activity";
import type {
  FinalizationCandidate,
  FinalizationFailure,
  FinalizationStore,
  FinalizedJournalInput,
} from "@/lib/journal-finalization";
import type { SummaryOutput } from "@/lib/journal-summary";
import { getFinalizationDueAt, getLocalDate } from "@/lib/time-zone";

const schedulingLookbackDays = 7;

export type JournalHistoryItem = {
  localDate: string;
  timeZone: string;
  status: "finalizing" | "finalized" | "corrected" | "recoverable-error";
  completeness: "loading" | "complete" | "partial" | "error" | null;
  finalizedAt: Date | null;
  correctionCount: number;
};

export type HistoricalJournal = JournalHistoryItem & {
  metrics: ActivityMetrics | null;
  narrative: SummaryOutput | null;
  evidence: ActivityRecord[];
  corrections: ActivityRecord[];
  failure: FinalizationFailure | null;
};

function subtractCalendarDays(localDate: string, count: number) {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

function hydrateActivity(activity: ActivityRecord): ActivityRecord {
  return {
    ...activity,
    occurredAt: new Date(activity.occurredAt),
    observedAt: new Date(activity.observedAt),
    ...(activity.statusOccurredAt
      ? { statusOccurredAt: new Date(activity.statusOccurredAt) }
      : {}),
  };
}

function activityFromRow(
  row: typeof githubActivity.$inferSelect,
): ActivityRecord {
  return {
    deduplicationKey: row.deduplicationKey,
    localDate: row.localDate,
    kind: row.kind,
    actorId: row.actorId,
    actorLogin: row.actorLogin,
    repositoryId: row.repositoryId,
    repositoryName: row.repositoryName,
    evidenceUrl: row.evidenceUrl,
    visibility: row.visibility,
    source: row.source,
    subjectId: row.subjectId,
    subjectNumber: row.subjectNumber,
    subjectTitle: row.subjectTitle,
    occurredAt: row.occurredAt,
    observedAt: row.observedAt,
    authoredBeforeDay: row.authoredBeforeDay,
    installationId: row.installationId,
    status: row.status,
    statusOccurredAt: row.statusOccurredAt,
    narrativeEligible: row.narrativeEligible,
    attributionKeys: row.attributionKeys ?? undefined,
    attributed: row.attributed,
  };
}

function historicalStatus(
  status: typeof journalFinalization.$inferSelect.status,
  correctionCount: number,
): JournalHistoryItem["status"] {
  if (status === "recoverable-error") return "recoverable-error";
  if (status === "scheduled" || status === "finalizing") return "finalizing";
  return correctionCount > 0 ? "corrected" : "finalized";
}

export function createJournalFinalizationRepository<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof import("@/db/auth-schema")>) {
  async function findDueCandidates(now: Date) {
    const onboardings = await database
      .select({
        userId: journalOnboarding.userId,
        timeZone: journalOnboarding.timeZone,
      })
      .from(journalOnboarding)
      .where(
        and(
          isNotNull(journalOnboarding.timeZone),
          isNotNull(journalOnboarding.githubAccessMode),
        ),
      );

    return onboardings.flatMap(({ userId, timeZone }) => {
      if (!timeZone) return [];
      const today = getLocalDate(now, timeZone).iso;
      return Array.from({ length: schedulingLookbackDays }, (_, index) => ({
        userId,
        localDate: subtractCalendarDays(today, index + 1),
        timeZone,
      })).filter(
        (candidate) =>
          getFinalizationDueAt(candidate.localDate, timeZone) <= now,
      );
    });
  }

  async function schedule(candidate: FinalizationCandidate, now: Date) {
    const inserted = await database
      .insert(journalFinalization)
      .values({
        id: randomUUID(),
        ...candidate,
        status: "scheduled",
        scheduledAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: journalFinalization.id });
    return inserted.length > 0;
  }

  async function claim(userId: string, localDate: string, now: Date) {
    const claimed = await database
      .update(journalFinalization)
      .set({
        status: "finalizing",
        finalizationStartedAt: now,
        attemptCount: sql`${journalFinalization.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(journalFinalization.userId, userId),
          eq(journalFinalization.localDate, localDate),
          eq(journalFinalization.status, "scheduled"),
        ),
      )
      .returning({ id: journalFinalization.id });
    return claimed.length > 0;
  }

  async function finalize(input: FinalizedJournalInput) {
    const finalized = await database
      .update(journalFinalization)
      .set({
        status: "finalized",
        timeZone: input.timeZone,
        completeness: input.completeness,
        metrics: input.metrics,
        narrative: input.narrative,
        snapshotHash: input.snapshotHash,
        evidenceKeys: input.evidenceKeys,
        evidence: input.evidence,
        finalizedAt: input.finalizedAt,
        lastFailure: null,
        updatedAt: input.finalizedAt,
      })
      .where(
        and(
          eq(journalFinalization.userId, input.userId),
          eq(journalFinalization.localDate, input.localDate),
          eq(journalFinalization.status, "finalizing"),
        ),
      )
      .returning({ id: journalFinalization.id });
    return finalized.length > 0;
  }

  async function fail(
    userId: string,
    localDate: string,
    failure: FinalizationFailure,
    terminal: boolean,
  ) {
    await database
      .update(journalFinalization)
      .set({
        status: terminal ? "recoverable-error" : "scheduled",
        lastFailure: failure,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(journalFinalization.userId, userId),
          eq(journalFinalization.localDate, localDate),
          inArray(journalFinalization.status, ["scheduled", "finalizing"]),
        ),
      );
  }

  async function retry(userId: string, localDate: string, now = new Date()) {
    const [retried] = await database
      .update(journalFinalization)
      .set({
        status: "scheduled",
        scheduledAt: now,
        finalizationStartedAt: null,
        lastFailure: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(journalFinalization.userId, userId),
          eq(journalFinalization.localDate, localDate),
          eq(journalFinalization.status, "recoverable-error"),
        ),
      )
      .returning({
        userId: journalFinalization.userId,
        localDate: journalFinalization.localDate,
        timeZone: journalFinalization.timeZone,
        attemptCount: journalFinalization.attemptCount,
      });
    return retried ?? null;
  }

  async function correctionsFor(
    userId: string,
    localDate: string,
    finalizedAt: Date | null,
    evidenceKeys: string[],
  ) {
    if (!finalizedAt) return [];
    const rows = await database.query.githubActivity.findMany({
      where: and(
        eq(githubActivity.userId, userId),
        eq(githubActivity.localDate, localDate),
        eq(githubActivity.attributed, true),
        gt(githubActivity.observedAt, finalizedAt),
      ),
      orderBy: [asc(githubActivity.occurredAt), asc(githubActivity.createdAt)],
    });
    const frozenEvidence = new Set(evidenceKeys);
    return rows
      .filter((row) => !frozenEvidence.has(row.deduplicationKey))
      .map(activityFromRow);
  }

  async function read(
    userId: string,
    localDate: string,
  ): Promise<HistoricalJournal | null> {
    const row = await database.query.journalFinalization.findFirst({
      where: and(
        eq(journalFinalization.userId, userId),
        eq(journalFinalization.localDate, localDate),
      ),
    });
    if (!row) return null;
    const corrections = await correctionsFor(
      userId,
      localDate,
      row.finalizedAt,
      row.evidenceKeys ?? [],
    );
    return {
      localDate,
      timeZone: row.timeZone,
      status: historicalStatus(row.status, corrections.length),
      completeness: row.completeness,
      metrics: row.metrics,
      narrative: row.narrative,
      evidence: (row.evidence ?? []).map(hydrateActivity),
      corrections,
      finalizedAt: row.finalizedAt,
      correctionCount: corrections.length,
      failure: row.lastFailure,
    };
  }

  async function list(userId: string): Promise<JournalHistoryItem[]> {
    const rows = await database.query.journalFinalization.findMany({
      where: eq(journalFinalization.userId, userId),
      orderBy: [desc(journalFinalization.localDate)],
    });
    return Promise.all(
      rows.map(async (row) => {
        const corrections = await correctionsFor(
          userId,
          row.localDate,
          row.finalizedAt,
          row.evidenceKeys ?? [],
        );
        return {
          localDate: row.localDate,
          timeZone: row.timeZone,
          status: historicalStatus(row.status, corrections.length),
          completeness: row.completeness,
          finalizedAt: row.finalizedAt,
          correctionCount: corrections.length,
        };
      }),
    );
  }

  async function redactNarrative(
    userId: string,
    localDate: string,
    now = new Date(),
  ) {
    const redacted = await database
      .update(journalFinalization)
      .set({ narrative: null, narrativeRedactedAt: now, updatedAt: now })
      .where(
        and(
          eq(journalFinalization.userId, userId),
          eq(journalFinalization.localDate, localDate),
          eq(journalFinalization.status, "finalized"),
        ),
      )
      .returning({ id: journalFinalization.id });
    return redacted.length > 0;
  }

  return {
    findDueCandidates,
    schedule,
    claim,
    finalize,
    fail,
    retry,
    list,
    read,
    redactNarrative,
  } satisfies FinalizationStore & {
    list(userId: string): Promise<JournalHistoryItem[]>;
    read(userId: string, localDate: string): Promise<HistoricalJournal | null>;
    redactNarrative(
      userId: string,
      localDate: string,
      now?: Date,
    ): Promise<boolean>;
    retry(
      userId: string,
      localDate: string,
      now?: Date,
    ): Promise<(FinalizationCandidate & { attemptCount: number }) | null>;
  };
}

export const journalFinalizationRepository =
  createJournalFinalizationRepository(db);
