import { randomUUID } from "node:crypto";

import { asc, inArray, lt } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { githubActivity } from "@/db/auth-schema";
import { createPrivacyLedger, runPrivacyOperation } from "@/lib/privacy-ledger";

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
  const ledger = createPrivacyLedger(database);
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
    const operation = await runPrivacyOperation(
      ledger,
      { key: `retention:${randomUUID()}`, kind: "retention", now },
      async () => {
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
        return result;
      },
    );
    if (operation.status === "skipped") {
      return { deletedActivities: 0, hasMore: false };
    }
    return operation.value;
  };
}

export const runPrivacyMaintenance = createPrivacyMaintenance(db);
