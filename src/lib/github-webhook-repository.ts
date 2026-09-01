import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "@/db";
import {
  account,
  githubActivity,
  githubInstallation,
  githubWebhookDelivery,
  journalOnboarding,
} from "@/db/auth-schema";
import type { ActivityRecord } from "@/lib/github-reconciliation";

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
    // First write wins: a record already ingested by reconciliation (or a
    // concurrent consumer) stays canonical.
    await database
      .insert(githubActivity)
      .values(
        records.map((record) => ({ id: randomUUID(), userId, ...record })),
      )
      .onConflictDoNothing({
        target: [githubActivity.userId, githubActivity.deduplicationKey],
      });
  }

  return {
    claimDelivery,
    findActiveInstallationUsers,
    markDeliveryEnqueued,
    markDeliveryEnqueueFailed,
    markDeliveryFailed,
    markDeliveryProcessed,
    recordActivity,
  };
}

export type GitHubWebhookRepository = ReturnType<
  typeof createGitHubWebhookRepository
>;

export const githubWebhookRepository = createGitHubWebhookRepository(db);
