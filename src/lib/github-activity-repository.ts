import { randomUUID } from "node:crypto";

import { and, asc, eq, lte } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { githubActivity, journalReconciliation } from "@/db/auth-schema";
import { computeActivityMetrics } from "@/lib/github-activity";
import { JournalNotFoundError } from "@/lib/journal-errors";
import { deleteBlockedGitHubActivities } from "@/lib/github-access-block";
import type { StoredSecondarySourceFreshness } from "@/lib/github-secondary";
import type {
  ActivityRecord,
  ReconciliationStore,
  TodayJournal,
} from "@/lib/github-reconciliation";

export function createGitHubActivityRepository<
  TQueryResult extends PgQueryResultHKT,
>(
  database: PgDatabase<TQueryResult, typeof import("@/db/auth-schema")>,
  runAtomicBatch?: (
    queries: readonly [BatchItem<"pg">, ...BatchItem<"pg">[]],
  ) => Promise<unknown>,
) {
  function serializeSourceFreshness(
    sources: TodayJournal["sourceFreshness"],
  ): StoredSecondarySourceFreshness[] | undefined {
    return sources?.map((source) => ({
      ...source,
      refreshedAt: source.refreshedAt?.toISOString() ?? null,
    }));
  }

  async function tryStart(
    userId: string,
    localDate: string,
    now: Date,
    cutoff: Date,
    timeZone: string,
  ) {
    const inserted = await database
      .insert(journalReconciliation)
      .values({
        id: randomUUID(),
        userId,
        localDate,
        timeZone,
        status: "loading",
        lastAttemptAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: journalReconciliation.id });
    if (inserted.length > 0) return true;

    const updated = await database
      .update(journalReconciliation)
      .set({
        timeZone,
        status: "loading",
        lastAttemptAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(journalReconciliation.userId, userId),
          eq(journalReconciliation.localDate, localDate),
          lte(journalReconciliation.lastAttemptAt, cutoff),
        ),
      )
      .returning({ id: journalReconciliation.id });

    return updated.length > 0;
  }

  async function finish(
    userId: string,
    journal: Omit<TodayJournal, "activities" | "metrics">,
    records: ActivityRecord[],
  ) {
    const uniqueRecords = [
      ...new Map(
        records.map((record) => [record.deduplicationKey, record]),
      ).values(),
    ];
    const reconciliationUpdate = {
      timeZone: journal.timeZone,
      status: journal.status,
      ...(journal.refreshedAt ? { refreshedAt: journal.refreshedAt } : {}),
      ...(journal.sourceFreshness
        ? {
            sourceFreshness: serializeSourceFreshness(journal.sourceFreshness),
          }
        : {}),
      updatedAt: new Date(),
    };

    if (runAtomicBatch) {
      const reconciliationQuery = database
        .update(journalReconciliation)
        .set(reconciliationUpdate)
        .where(
          and(
            eq(journalReconciliation.userId, userId),
            eq(journalReconciliation.localDate, journal.localDate),
          ),
        );

      if (uniqueRecords.length > 0) {
        const activityQuery = database
          .insert(githubActivity)
          .values(
            uniqueRecords.map((record) => ({
              id: randomUUID(),
              userId,
              ...record,
            })),
          )
          .onConflictDoUpdate({
            target: [githubActivity.userId, githubActivity.deduplicationKey],
            set: {
              observedAt: journal.refreshedAt ?? new Date(),
            },
          });

        await runAtomicBatch([activityQuery, reconciliationQuery]);
        await deleteBlockedGitHubActivities(database, userId, uniqueRecords);
      } else {
        await runAtomicBatch([reconciliationQuery]);
      }
      return;
    }

    await database.transaction(async (transaction) => {
      if (uniqueRecords.length > 0) {
        await transaction
          .insert(githubActivity)
          .values(
            uniqueRecords.map((record) => ({
              id: randomUUID(),
              userId,
              ...record,
            })),
          )
          .onConflictDoUpdate({
            target: [githubActivity.userId, githubActivity.deduplicationKey],
            set: {
              observedAt: journal.refreshedAt ?? new Date(),
            },
          });
      }
      await transaction
        .update(journalReconciliation)
        .set(reconciliationUpdate)
        .where(
          and(
            eq(journalReconciliation.userId, userId),
            eq(journalReconciliation.localDate, journal.localDate),
          ),
        );
    });
    await deleteBlockedGitHubActivities(database, userId, uniqueRecords);
  }

  async function read(
    userId: string,
    localDate: string,
  ): Promise<TodayJournal> {
    const [state, activities] = await Promise.all([
      database.query.journalReconciliation.findFirst({
        where: and(
          eq(journalReconciliation.userId, userId),
          eq(journalReconciliation.localDate, localDate),
        ),
      }),
      database.query.githubActivity.findMany({
        where: and(
          eq(githubActivity.userId, userId),
          eq(githubActivity.localDate, localDate),
          eq(githubActivity.attributed, true),
        ),
        orderBy: [
          asc(githubActivity.occurredAt),
          asc(githubActivity.createdAt),
        ],
      }),
    ]);

    if (!state) {
      throw new JournalNotFoundError();
    }

    const latestObservedAt = activities.reduce<Date | null>(
      (latest, activity) =>
        !latest || activity.observedAt > latest ? activity.observedAt : latest,
      null,
    );

    return {
      localDate,
      timeZone: state.timeZone,
      status: state.status,
      refreshedAt: state.refreshedAt,
      storedAt:
        latestObservedAt && latestObservedAt > state.updatedAt
          ? latestObservedAt
          : state.updatedAt,
      lastAttemptAt: state.lastAttemptAt,
      sourceFreshness: state.sourceFreshness?.map((source) => ({
        ...source,
        refreshedAt: source.refreshedAt ? new Date(source.refreshedAt) : null,
      })),
      metrics: computeActivityMetrics(activities),
      activities: activities.map((activity) => ({
        deduplicationKey: activity.deduplicationKey,
        localDate: activity.localDate,
        kind: activity.kind,
        actorId: activity.actorId,
        actorLogin: activity.actorLogin,
        repositoryId: activity.repositoryId,
        repositoryName: activity.repositoryName,
        evidenceUrl: activity.evidenceUrl,
        visibility: activity.visibility,
        source: activity.source,
        subjectId: activity.subjectId,
        subjectNumber: activity.subjectNumber,
        subjectTitle: activity.subjectTitle,
        occurredAt: activity.occurredAt,
        observedAt: activity.observedAt,
        authoredBeforeDay: activity.authoredBeforeDay,
        installationId: activity.installationId,
        status: activity.status,
        narrativeEligible: activity.narrativeEligible,
        attributionKeys: activity.attributionKeys ?? undefined,
        attributed: activity.attributed,
      })),
    };
  }

  return { tryStart, finish, read } satisfies ReconciliationStore;
}

export const githubActivityRepository = createGitHubActivityRepository(
  db,
  (queries) => db.batch(queries),
);
