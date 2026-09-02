import { createHash, randomUUID } from "node:crypto";

import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "@/db";
import {
  account,
  githubActivity,
  githubInstallation,
  githubWebhookDelivery,
  journalFinalization,
  journalOnboarding,
  journalSummary,
  privacyOperation,
} from "@/db/auth-schema";
import type { ActivityRecord } from "@/lib/github-reconciliation";
import {
  clearGitHubAccessBlocks,
  deleteBlockedGitHubActivities,
  neutralizeBlockedActivity,
  recordGitHubAccessBlocks,
} from "@/lib/github-access-block";
import type {
  GitHubAccessChange,
  GitHubAccessRestoration,
} from "@/lib/github-privacy";

export type WebhookInstallationUser = {
  userId: string;
  timeZone: string;
  githubAccountId: string;
};

export function createGitHubWebhookRepository<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof import("@/db/auth-schema")>) {
  async function claimDelivery(receipt: {
    deliveryId: string;
    eventType: string;
    installationId: string | null;
    status: "received" | "ignored";
    receivedAt: Date;
  }): Promise<"claimed" | "duplicate"> {
    const inserted = await database
      .insert(githubWebhookDelivery)
      .values({ id: randomUUID(), errorId: null, ...receipt })
      .onConflictDoNothing()
      .returning({ id: githubWebhookDelivery.id });
    if (inserted.length > 0) return "claimed";

    // A previously failed enqueue may be redelivered; everything else is a
    // duplicate delivery id and must not produce a second effect.
    const retried = await database
      .update(githubWebhookDelivery)
      .set({ status: receipt.status, errorId: null, updatedAt: new Date() })
      .where(
        and(
          eq(githubWebhookDelivery.deliveryId, receipt.deliveryId),
          eq(githubWebhookDelivery.status, "enqueue-failed"),
        ),
      )
      .returning({ id: githubWebhookDelivery.id });

    return retried.length > 0 ? "claimed" : "duplicate";
  }

  async function markDeliveryEnqueued(deliveryId: string) {
    await database
      .update(githubWebhookDelivery)
      .set({ status: "enqueued", errorId: null, updatedAt: new Date() })
      .where(eq(githubWebhookDelivery.deliveryId, deliveryId));
  }

  async function markDeliveryEnqueueFailed(
    deliveryId: string,
    errorId: string,
  ) {
    await database
      .update(githubWebhookDelivery)
      .set({ status: "enqueue-failed", errorId, updatedAt: new Date() })
      .where(eq(githubWebhookDelivery.deliveryId, deliveryId));
  }

  async function markDeliveryProcessed(
    deliveryId: string,
    outcome: "processed" | "skipped",
    processedAt: Date,
    attemptCount: number,
  ) {
    await database
      .update(githubWebhookDelivery)
      .set({
        status: outcome,
        errorId: null,
        processedAt,
        attemptCount,
        updatedAt: new Date(),
      })
      .where(eq(githubWebhookDelivery.deliveryId, deliveryId));
  }

  async function markDeliveryFailed(
    deliveryId: string,
    status: "failed" | "poisoned",
    errorId: string,
    attemptCount: number,
  ) {
    await database
      .update(githubWebhookDelivery)
      .set({ status, errorId, attemptCount, updatedAt: new Date() })
      .where(eq(githubWebhookDelivery.deliveryId, deliveryId));
  }

  async function findActiveInstallationUsers(
    installationId: string,
  ): Promise<WebhookInstallationUser[]> {
    const installations = await database
      .select({ userId: githubInstallation.userId })
      .from(githubInstallation)
      .where(
        and(
          eq(githubInstallation.installationId, installationId),
          eq(githubInstallation.status, "active"),
        ),
      );
    const userIds = [...new Set(installations.map((row) => row.userId))];
    if (userIds.length === 0) return [];

    const [onboardings, accounts] = await Promise.all([
      database
        .select({
          userId: journalOnboarding.userId,
          timeZone: journalOnboarding.timeZone,
        })
        .from(journalOnboarding)
        .where(inArray(journalOnboarding.userId, userIds)),
      database
        .select({ userId: account.userId, accountId: account.accountId })
        .from(account)
        .where(
          and(
            inArray(account.userId, userIds),
            eq(account.providerId, "github"),
          ),
        ),
    ]);
    const timeZones = new Map(
      onboardings.map((row) => [row.userId, row.timeZone]),
    );
    const githubAccountIds = new Map(
      accounts.map((row) => [row.userId, row.accountId]),
    );

    return userIds.flatMap((userId) => {
      const timeZone = timeZones.get(userId);
      const githubAccountId = githubAccountIds.get(userId);
      return timeZone && githubAccountId
        ? [{ userId, timeZone, githubAccountId }]
        : [];
    });
  }

  async function recordActivity(userId: string, records: ActivityRecord[]) {
    if (records.length === 0) return;
    await database
      .insert(githubActivity)
      .values(
        records.map((record) => {
          const { attributionKey, ...storedRecord } = record;
          return {
            id: randomUUID(),
            userId,
            ...storedRecord,
            narrativeEligible: record.narrativeEligible ?? true,
            attributionKeys:
              record.attributionKeys ??
              (attributionKey ? [attributionKey] : null),
            attributed: record.attributed ?? true,
          };
        }),
      )
      .onConflictDoUpdate({
        target: [githubActivity.userId, githubActivity.deduplicationKey],
        set: {
          observedAt: sql`GREATEST(${githubActivity.observedAt}, excluded.observed_at)`,
          status: sql`CASE
            WHEN excluded.status IS NULL THEN ${githubActivity.status}
            WHEN ${githubActivity.status} IS NULL THEN excluded.status
            WHEN excluded.status_occurred_at IS NULL THEN ${githubActivity.status}
            WHEN ${githubActivity.statusOccurredAt} IS NULL THEN excluded.status
            WHEN excluded.status_occurred_at >= ${githubActivity.statusOccurredAt} THEN excluded.status
            ELSE ${githubActivity.status}
          END`,
          statusOccurredAt: sql`CASE
            WHEN excluded.status_occurred_at IS NULL THEN ${githubActivity.statusOccurredAt}
            WHEN ${githubActivity.statusOccurredAt} IS NULL THEN excluded.status_occurred_at
            ELSE GREATEST(${githubActivity.statusOccurredAt}, excluded.status_occurred_at)
          END`,
          actorId: sql`CASE WHEN excluded.attributed THEN excluded.actor_id ELSE ${githubActivity.actorId} END`,
          actorLogin: sql`CASE WHEN excluded.attributed THEN excluded.actor_login ELSE ${githubActivity.actorLogin} END`,
          subjectTitle: sql`COALESCE(${githubActivity.subjectTitle}, excluded.subject_title)`,
          narrativeEligible: sql`${githubActivity.narrativeEligible} AND excluded.narrative_eligible`,
          attributionKeys: sql`COALESCE(${githubActivity.attributionKeys}, excluded.attribution_keys)`,
          attributed: sql`${githubActivity.attributed} OR excluded.attributed`,
        },
      });

    // Operational outcomes may arrive before the merge, release, or manual
    // workflow that makes them attributable. Resolve those safe candidates on
    // every related write so either event order converges on the same result.
    const correlated = await database
      .select({
        id: githubActivity.id,
        kind: githubActivity.kind,
        actorId: githubActivity.actorId,
        actorLogin: githubActivity.actorLogin,
        attributionKeys: githubActivity.attributionKeys,
        attributed: githubActivity.attributed,
      })
      .from(githubActivity)
      .where(
        and(
          eq(githubActivity.userId, userId),
          isNotNull(githubActivity.attributionKeys),
        ),
      );
    const origins = correlated.filter((record) => record.attributed);
    for (const pending of correlated.filter((record) => !record.attributed)) {
      const origin = origins.find((candidate) =>
        candidate.attributionKeys?.some((key) =>
          pending.attributionKeys?.includes(key),
        ),
      );
      if (!origin) continue;
      await database
        .update(githubActivity)
        .set({
          actorId: origin.actorId,
          actorLogin: origin.actorLogin,
          attributed: true,
        })
        .where(eq(githubActivity.id, pending.id));
    }
    // A revocation can race a worker that resolved access just before the
    // webhook arrived. The durable fence makes either ordering converge:
    // revocation's sweep wins if it runs last, this post-write sweep wins if
    // the in-flight writer runs last.
    await deleteBlockedGitHubActivities(database, userId, records);
  }

  async function applyAccessChange(change: GitHubAccessChange) {
    const operationHash = createHash("sha256")
      .update(`github-access-change:${change.deliveryId}`)
      .digest("hex");
    const claimToken = randomUUID();
    const [claimed] = await database
      .insert(privacyOperation)
      .values({
        id: randomUUID(),
        operationHash,
        kind: change.kind,
        status: "running",
        claimToken,
        startedAt: change.occurredAt,
      })
      .onConflictDoNothing()
      .returning({ id: privacyOperation.id });
    if (!claimed) {
      const existing = await database.query.privacyOperation.findFirst({
        where: eq(privacyOperation.operationHash, operationHash),
      });
      if (!existing || existing.status === "complete") {
        return { affectedUsers: 0, deletedActivities: 0, redactedJournals: 0 };
      }
      const now = new Date();
      const staleAt = new Date(now.getTime() - 5 * 60 * 1000);
      const retried = await database
        .update(privacyOperation)
        .set({
          status: "running",
          attemptCount: sql`${privacyOperation.attemptCount} + 1`,
          errorId: null,
          startedAt: now,
          finishedAt: null,
          updatedAt: now,
          claimToken,
        })
        .where(
          and(
            eq(privacyOperation.id, existing.id),
            or(
              eq(privacyOperation.status, "failed"),
              and(
                eq(privacyOperation.status, "running"),
                lt(privacyOperation.updatedAt, staleAt),
              ),
            ),
          ),
        )
        .returning({ id: privacyOperation.id });
      if (retried.length === 0) {
        return { affectedUsers: 0, deletedActivities: 0, redactedJournals: 0 };
      }
    }

    try {
      const installationUsers = change.installationId
        ? await database
            .select({ userId: githubInstallation.userId })
            .from(githubInstallation)
            .where(eq(githubInstallation.installationId, change.installationId))
        : [];
      const authorizationUsers =
        change.kind === "authorization-revoked" && change.accountId
          ? await database
              .select({ userId: account.userId })
              .from(account)
              .where(
                and(
                  eq(account.providerId, "github"),
                  eq(account.accountId, change.accountId),
                ),
              )
          : [];
      const userIds = [
        ...new Set(
          [...installationUsers, ...authorizationUsers].map(
            (row) => row.userId,
          ),
        ),
      ];

      if (userIds.length === 0) {
        await database
          .update(privacyOperation)
          .set({
            status: "complete",
            finishedAt: change.occurredAt,
            updatedAt: change.occurredAt,
          })
          .where(
            and(
              eq(privacyOperation.operationHash, operationHash),
              eq(privacyOperation.claimToken, claimToken),
            ),
          );
        return { affectedUsers: 0, deletedActivities: 0, redactedJournals: 0 };
      }

      await recordGitHubAccessBlocks(database, userIds, change);

      if (change.kind !== "repositories-removed") {
        await database
          .update(githubInstallation)
          .set({ status: "disconnected", updatedAt: change.occurredAt })
          .where(
            change.kind === "authorization-revoked"
              ? inArray(githubInstallation.userId, userIds)
              : and(
                  inArray(githubInstallation.userId, userIds),
                  eq(
                    githubInstallation.installationId,
                    change.installationId ?? "",
                  ),
                ),
          );
      }
      if (change.kind === "authorization-revoked") {
        await database
          .update(account)
          .set({
            accessToken: null,
            refreshToken: null,
            idToken: null,
            updatedAt: change.occurredAt,
          })
          .where(
            and(
              inArray(account.userId, userIds),
              eq(account.providerId, "github"),
            ),
          );
      }

      const inaccessible = (activity: ActivityRecord) =>
        activity.visibility === "private" &&
        (change.kind === "repositories-removed"
          ? change.repositoryIds.includes(activity.repositoryId)
          : change.kind === "authorization-revoked" ||
            activity.installationId === change.installationId ||
            activity.installationId === null);
      const activityScope =
        change.kind === "repositories-removed"
          ? and(
              inArray(githubActivity.userId, userIds),
              eq(githubActivity.visibility, "private"),
              inArray(githubActivity.repositoryId, change.repositoryIds),
            )
          : change.kind === "authorization-revoked"
            ? and(
                inArray(githubActivity.userId, userIds),
                eq(githubActivity.visibility, "private"),
              )
            : and(
                inArray(githubActivity.userId, userIds),
                eq(githubActivity.visibility, "private"),
                or(
                  eq(
                    githubActivity.installationId,
                    change.installationId ?? "",
                  ),
                  isNull(githubActivity.installationId),
                ),
              );
      const deleted = await database
        .delete(githubActivity)
        .where(activityScope)
        .returning({
          id: githubActivity.id,
          userId: githubActivity.userId,
          localDate: githubActivity.localDate,
        });

      const finalized = await database.query.journalFinalization.findMany({
        where: and(
          inArray(journalFinalization.userId, userIds),
          eq(journalFinalization.status, "finalized"),
        ),
      });
      let redactedJournals = 0;
      for (const journal of finalized) {
        const evidence = journal.evidence ?? [];
        if (!evidence.some(inaccessible)) continue;
        const neutralEvidence = evidence.map((activity, index) =>
          inaccessible(activity)
            ? neutralizeBlockedActivity(activity, journal.localDate, index)
            : activity,
        );
        await database
          .update(journalFinalization)
          .set({
            narrative: {
              overview: "Details unavailable because GitHub access changed.",
              overviewEvidenceIds: [],
              accomplishments: [],
              collaboration: [],
              inProgress: [],
            },
            evidence: neutralEvidence,
            evidenceKeys: neutralEvidence.map(
              (activity) => activity.deduplicationKey,
            ),
            narrativeRedactedAt: change.occurredAt,
            updatedAt: change.occurredAt,
          })
          .where(eq(journalFinalization.id, journal.id));
        redactedJournals += 1;
      }
      const affectedSummaryDates = new Map<string, Set<string>>();
      for (const activity of deleted) {
        const dates = affectedSummaryDates.get(activity.userId) ?? new Set();
        dates.add(activity.localDate);
        affectedSummaryDates.set(activity.userId, dates);
      }
      for (const journal of finalized.filter((item) =>
        (item.evidence ?? []).some(inaccessible),
      )) {
        const dates = affectedSummaryDates.get(journal.userId) ?? new Set();
        dates.add(journal.localDate);
        affectedSummaryDates.set(journal.userId, dates);
      }
      for (const [userId, dates] of affectedSummaryDates) {
        await database
          .delete(journalSummary)
          .where(
            and(
              eq(journalSummary.userId, userId),
              inArray(journalSummary.localDate, [...dates]),
            ),
          );
      }

      const result = {
        affectedUsers: userIds.length,
        deletedActivities: deleted.length,
        redactedJournals,
      };
      await database
        .update(privacyOperation)
        .set({
          status: "complete",
          ...result,
          finishedAt: change.occurredAt,
          updatedAt: change.occurredAt,
        })
        .where(
          and(
            eq(privacyOperation.operationHash, operationHash),
            eq(privacyOperation.claimToken, claimToken),
          ),
        );
      return result;
    } catch (error) {
      await database
        .update(privacyOperation)
        .set({
          status: "failed",
          errorId: randomUUID(),
          finishedAt: change.occurredAt,
          updatedAt: change.occurredAt,
        })
        .where(
          and(
            eq(privacyOperation.operationHash, operationHash),
            eq(privacyOperation.claimToken, claimToken),
          ),
        );
      throw error;
    }
  }

  async function restoreAccess(restoration: GitHubAccessRestoration) {
    const installations = await database
      .select({ userId: githubInstallation.userId })
      .from(githubInstallation)
      .where(eq(githubInstallation.installationId, restoration.installationId));
    const userIds = [...new Set(installations.map(({ userId }) => userId))];
    const scopes =
      restoration.kind === "repositories-added"
        ? restoration.repositoryIds.map((repositoryId) => ({
            kind: "repository",
            identifier: repositoryId,
          }))
        : [
            {
              kind: "installation",
              identifier: restoration.installationId,
            },
          ];
    await clearGitHubAccessBlocks(database, userIds, scopes);
    if (restoration.kind === "installation-unsuspended" && userIds.length > 0) {
      await database
        .update(githubInstallation)
        .set({ status: "active", updatedAt: new Date() })
        .where(
          and(
            inArray(githubInstallation.userId, userIds),
            eq(githubInstallation.installationId, restoration.installationId),
          ),
        );
    }
  }

  return {
    applyAccessChange,
    claimDelivery,
    findActiveInstallationUsers,
    markDeliveryEnqueued,
    markDeliveryEnqueueFailed,
    markDeliveryFailed,
    markDeliveryProcessed,
    recordActivity,
    restoreAccess,
  };
}

export type GitHubWebhookRepository = ReturnType<
  typeof createGitHubWebhookRepository
>;

export const githubWebhookRepository = createGitHubWebhookRepository(db);
