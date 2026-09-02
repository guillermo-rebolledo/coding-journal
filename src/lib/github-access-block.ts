import { createHash, randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import {
  githubAccessBlock,
  githubActivity,
  journalSummary,
} from "@/db/auth-schema";
import type { ActivityRecord } from "@/lib/github-activity";
import type { GitHubAccessChange } from "@/lib/github-privacy";

type Database<TQueryResult extends PgQueryResultHKT> = PgDatabase<
  TQueryResult,
  typeof import("@/db/auth-schema")
>;

export function githubAccessBlockScopeKey(kind: string, identifier: string) {
  return createHash("sha256")
    .update(`github-access-block:${kind}:${identifier}`)
    .digest("hex");
}

export function isActivityBlocked(
  activity: ActivityRecord,
  blocks: (typeof githubAccessBlock.$inferSelect)[],
) {
  return (
    activity.visibility === "private" &&
    blocks.some(
      (block) =>
        block.allPrivate ||
        block.repositoryId === activity.repositoryId ||
        (block.installationId !== null &&
          block.installationId === activity.installationId),
    )
  );
}

export function neutralizeBlockedActivity(
  activity: ActivityRecord,
  localDate: string,
  index: number,
): ActivityRecord {
  return {
    ...activity,
    deduplicationKey: `privacy-unavailable:${localDate}:${index}`,
    actorId: "unavailable",
    actorLogin: "unavailable",
    repositoryId: "unavailable",
    repositoryName: "Unavailable repository",
    evidenceUrl: "",
    visibility: "private",
    subjectId: "unavailable",
    subjectNumber: null,
    subjectTitle: "Details unavailable because GitHub access changed.",
    installationId: null,
    status: null,
    statusOccurredAt: null,
    narrativeEligible: false,
    attributionKeys: undefined,
  };
}

export async function clearGitHubAccessBlocks<
  TQueryResult extends PgQueryResultHKT,
>(
  database: Database<TQueryResult>,
  userIds: string[],
  scopes: Array<{ kind: string; identifier: string }>,
) {
  if (userIds.length === 0 || scopes.length === 0) return;
  await database.delete(githubAccessBlock).where(
    and(
      inArray(githubAccessBlock.userId, userIds),
      inArray(
        githubAccessBlock.scopeKey,
        scopes.map(({ kind, identifier }) =>
          githubAccessBlockScopeKey(kind, identifier),
        ),
      ),
    ),
  );
}

export async function deleteSummaryWhenEvidenceIsBlocked<
  TQueryResult extends PgQueryResultHKT,
>(
  database: Database<TQueryResult>,
  userId: string,
  snapshotHash: string,
  evidence: ActivityRecord[],
) {
  const blocks = await database.query.githubAccessBlock.findMany({
    where: eq(githubAccessBlock.userId, userId),
  });
  if (!evidence.some((activity) => isActivityBlocked(activity, blocks))) {
    return false;
  }
  await database
    .delete(journalSummary)
    .where(
      and(
        eq(journalSummary.userId, userId),
        eq(journalSummary.snapshotHash, snapshotHash),
      ),
    );
  return true;
}

export async function recordGitHubAccessBlocks<
  TQueryResult extends PgQueryResultHKT,
>(
  database: Database<TQueryResult>,
  userIds: string[],
  change: GitHubAccessChange,
) {
  const scopes =
    change.kind === "repositories-removed"
      ? change.repositoryIds.map((repositoryId) => ({
          scopeKey: githubAccessBlockScopeKey("repository", repositoryId),
          repositoryId,
          installationId: null,
          allPrivate: false,
        }))
      : change.kind === "authorization-revoked"
        ? [
            {
              scopeKey: githubAccessBlockScopeKey(
                "authorization",
                "all-private",
              ),
              repositoryId: null,
              installationId: null,
              allPrivate: true,
            },
          ]
        : change.installationId
          ? [
              {
                scopeKey: githubAccessBlockScopeKey(
                  "installation",
                  change.installationId,
                ),
                repositoryId: null,
                installationId: change.installationId,
                allPrivate: false,
              },
            ]
          : [];
  if (scopes.length === 0 || userIds.length === 0) return;
  await database
    .insert(githubAccessBlock)
    .values(
      userIds.flatMap((userId) =>
        scopes.map((scope) => ({ id: randomUUID(), userId, ...scope })),
      ),
    )
    .onConflictDoNothing();
}

export async function deleteBlockedGitHubActivities<
  TQueryResult extends PgQueryResultHKT,
>(database: Database<TQueryResult>, userId: string, records: ActivityRecord[]) {
  const privateRecords = records.filter(
    (record) => record.visibility === "private",
  );
  if (privateRecords.length === 0) return 0;
  const blocks = await database.query.githubAccessBlock.findMany({
    where: eq(githubAccessBlock.userId, userId),
  });
  const blockedKeys = privateRecords
    .filter((record) => isActivityBlocked(record, blocks))
    .map((record) => record.deduplicationKey);
  if (blockedKeys.length === 0) return 0;
  const deleted = await database
    .delete(githubActivity)
    .where(
      and(
        eq(githubActivity.userId, userId),
        inArray(githubActivity.deduplicationKey, blockedKeys),
      ),
    )
    .returning({ id: githubActivity.id });
  return deleted.length;
}
