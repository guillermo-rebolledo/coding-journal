import { createHash, randomUUID } from "node:crypto";

import { and, eq, lt, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { privacyOperation } from "@/db/auth-schema";

export const privacyOperationStaleAfterMs = 15 * 60 * 1000;

export type PrivacyOperationKind = typeof privacyOperation.$inferInsert.kind;

export type PrivacyClaim = {
  id: string;
  operationHash: string;
  claimToken: string;
};

export type PrivacyOperationCounts = Partial<{
  affectedUsers: number;
  deletedActivities: number;
  redactedJournals: number;
}>;

function operationCounts(value: PrivacyOperationCounts) {
  return {
    ...(value.affectedUsers === undefined
      ? {}
      : { affectedUsers: value.affectedUsers }),
    ...(value.deletedActivities === undefined
      ? {}
      : { deletedActivities: value.deletedActivities }),
    ...(value.redactedJournals === undefined
      ? {}
      : { redactedJournals: value.redactedJournals }),
  };
}

export type PrivacyLedger = {
  claim(input: {
    key: string;
    kind: PrivacyOperationKind;
    now: Date;
  }): Promise<PrivacyClaim | null>;
  complete(
    claim: PrivacyClaim,
    counts: PrivacyOperationCounts,
    now: Date,
  ): Promise<void>;
  fail(claim: PrivacyClaim, errorId: string, now: Date): Promise<void>;
};

export function createInMemoryPrivacyLedger() {
  type MemoryOperation = PrivacyClaim & {
    kind: PrivacyOperationKind;
    status: "running" | "complete" | "failed";
    updatedAt: Date;
    errorId?: string;
    counts?: PrivacyOperationCounts;
  };
  const operations = new Map<string, MemoryOperation>();
  const ledger: PrivacyLedger & {
    find(key: string): MemoryOperation | null;
  } = {
    find: (key) => operations.get(privacyOperationHash(key)) ?? null,
    async claim({ key, kind, now }) {
      const operationHash = privacyOperationHash(key);
      const current = operations.get(operationHash);
      if (
        current?.status === "complete" ||
        (current?.status === "running" &&
          current.updatedAt.getTime() + privacyOperationStaleAfterMs >=
            now.getTime())
      ) {
        return null;
      }
      const claim = {
        id: current?.id ?? randomUUID(),
        operationHash,
        claimToken: randomUUID(),
      };
      operations.set(operationHash, {
        ...claim,
        kind,
        status: "running",
        updatedAt: now,
      });
      return claim;
    },
    async complete(claim, counts, now) {
      const current = operations.get(claim.operationHash);
      if (current?.claimToken !== claim.claimToken) return;
      operations.set(claim.operationHash, {
        ...current,
        status: "complete",
        counts,
        updatedAt: now,
      });
    },
    async fail(claim, errorId, now) {
      const current = operations.get(claim.operationHash);
      if (current?.claimToken !== claim.claimToken) return;
      operations.set(claim.operationHash, {
        ...current,
        status: "failed",
        errorId,
        updatedAt: now,
      });
    },
  };
  return ledger;
}

export function privacyOperationHash(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

export function createPrivacyLedger<TQueryResult extends PgQueryResultHKT>(
  database: PgDatabase<TQueryResult, typeof import("@/db/auth-schema")>,
): PrivacyLedger {
  return {
    async claim({ key, kind, now }) {
      const operationHash = privacyOperationHash(key);
      const id = randomUUID();
      const claimToken = randomUUID();
      const [inserted] = await database
        .insert(privacyOperation)
        .values({
          id,
          operationHash,
          kind,
          status: "running",
          claimToken,
          startedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: privacyOperation.id });
      if (inserted) return { id, operationHash, claimToken };

      const staleAt = new Date(now.getTime() - privacyOperationStaleAfterMs);
      const [reclaimed] = await database
        .update(privacyOperation)
        .set({
          status: "running",
          attemptCount: sql`${privacyOperation.attemptCount} + 1`,
          errorId: null,
          claimToken,
          startedAt: now,
          finishedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(privacyOperation.operationHash, operationHash),
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
      return reclaimed ? { id: reclaimed.id, operationHash, claimToken } : null;
    },

    async complete(claim, counts, now) {
      await database
        .update(privacyOperation)
        .set({
          status: "complete",
          ...counts,
          finishedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(privacyOperation.id, claim.id),
            eq(privacyOperation.claimToken, claim.claimToken),
          ),
        );
    },

    async fail(claim, errorId, now) {
      await database
        .update(privacyOperation)
        .set({
          status: "failed",
          errorId,
          finishedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(privacyOperation.id, claim.id),
            eq(privacyOperation.claimToken, claim.claimToken),
          ),
        );
    },
  };
}

export async function runPrivacyOperation<T extends PrivacyOperationCounts>(
  ledger: PrivacyLedger,
  input: { key: string; kind: PrivacyOperationKind; now: Date },
  work: () => Promise<T>,
): Promise<{ status: "skipped" } | { status: "completed"; value: T }> {
  const claim = await ledger.claim(input);
  if (!claim) return { status: "skipped" };
  try {
    const value = await work();
    await ledger.complete(claim, operationCounts(value), input.now);
    return { status: "completed", value };
  } catch (error) {
    await ledger.fail(claim, randomUUID(), input.now);
    throw error;
  }
}

export const privacyLedger = createPrivacyLedger(db);
