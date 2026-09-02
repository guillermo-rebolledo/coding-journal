import { createHash, randomUUID } from "node:crypto";

import { asc, eq, inArray, lt } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { githubActivity, privacyOperation } from "@/db/auth-schema";

/** What one bounded retention batch removed, and whether more remains. */
export type PrivacyMaintenanceResult = {
  deletedActivities: number;
  hasMore: boolean;
};

export const retentionDays = 30;
export const retentionBatchSize = 500;

export function createPrivacyMaintenance<TQueryResult extends PgQueryResultHKT>(
  database: PgDatabase<TQueryResult, typeof import("@/db/auth-schema")>,
) {
  return async function run(
    now: Date,
    batchSize = retentionBatchSize,
  ): Promise<PrivacyMaintenanceResult> {
    const cutoff = new Date(
      now.getTime() - retentionDays * 24 * 60 * 60 * 1000,
    );
    const candidates = await database
      .select({ id: githubActivity.id })
      .from(githubActivity)
      .where(lt(githubActivity.occurredAt, cutoff))
      .orderBy(asc(githubActivity.occurredAt), asc(githubActivity.id))
      .limit(batchSize);
    const operationId = randomUUID();
    const operationHash = createHash("sha256")
      .update(`retention:${operationId}`)
      .digest("hex");
    await database.insert(privacyOperation).values({
      id: operationId,
      operationHash,
      kind: "retention",
      status: "running",
      startedAt: now,
    });
    try {
      const deleted = candidates.length
        ? await database
            .delete(githubActivity)
            .where(
              inArray(
                githubActivity.id,
                candidates.map(({ id }) => id),
              ),
            )
            .returning({ id: githubActivity.id })
        : [];
      const result: PrivacyMaintenanceResult = {
        deletedActivities: deleted.length,
        hasMore: candidates.length === batchSize,
      };
      await database
        .update(privacyOperation)
        .set({
          status: "complete",
          deletedActivities: result.deletedActivities,
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(privacyOperation.id, operationId));
      return result;
    } catch (error) {
      await database
        .update(privacyOperation)
        .set({
          status: "failed",
          errorId: randomUUID(),
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(privacyOperation.id, operationId));
      throw error;
    }
  };
}

export const runPrivacyMaintenance = createPrivacyMaintenance(db);
