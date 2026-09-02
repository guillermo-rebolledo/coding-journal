import { randomUUID } from "node:crypto";

import { and, count, eq, gte, lt, sum } from "drizzle-orm";

import { db } from "@/db";
import { journalSummary, journalSummaryGeneration } from "@/db/auth-schema";
import type {
  JournalSummary,
  SummaryStore,
  SummaryUsage,
} from "@/lib/journal-summary";
import { deleteSummaryWhenEvidenceIsBlocked } from "@/lib/github-access-block";

function hydrate(row: typeof journalSummary.$inferSelect): JournalSummary {
  return {
    id: row.id,
    userId: row.userId,
    localDate: row.localDate,
    snapshotHash: row.snapshotHash,
    model: row.model,
    output: row.output,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    estimatedCostUsd: row.estimatedCostMicrousd / 1_000_000,
    createdAt: row.createdAt,
  };
}

function utcMonthWindow(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return { start, end };
}

function utcDayWindow(localDate: string) {
  const start = new Date(`${localDate}T00:00:00Z`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export function createJournalSummaryRepository(
  database: typeof db,
): SummaryStore {
  return {
    async findBySnapshotHash(userId, snapshotHash) {
      const row = await database.query.journalSummary.findFirst({
        where: and(
          eq(journalSummary.userId, userId),
          eq(journalSummary.snapshotHash, snapshotHash),
        ),
      });
      return row ? hydrate(row) : null;
    },

    async getUsage(userId, localDate, now): Promise<SummaryUsage> {
      const { start, end } = utcMonthWindow(now);
      const day = utcDayWindow(localDate);
      const activeLease = new Date(now.getTime() - 60 * 1000);
      const [userRows, globalRows, spendRows, latest, active] =
        await Promise.all([
          database
            .select({ value: count() })
            .from(journalSummary)
            .where(
              and(
                eq(journalSummary.userId, userId),
                eq(journalSummary.localDate, localDate),
              ),
            ),
          database
            .select({ value: count() })
            .from(journalSummary)
            .where(
              and(
                gte(journalSummary.createdAt, day.start),
                lt(journalSummary.createdAt, day.end),
              ),
            ),
          database
            .select({ value: sum(journalSummary.estimatedCostMicrousd) })
            .from(journalSummary)
            .where(
              and(
                gte(journalSummary.createdAt, start),
                lt(journalSummary.createdAt, end),
              ),
            ),
          database.query.journalSummary.findFirst({
            columns: { createdAt: true },
            where: eq(journalSummary.userId, userId),
            orderBy: (table, { desc }) => [desc(table.createdAt)],
          }),
          database
            .select({ value: count() })
            .from(journalSummaryGeneration)
            .where(
              and(
                eq(journalSummaryGeneration.status, "active"),
                gte(journalSummaryGeneration.claimedAt, activeLease),
              ),
            ),
        ]);
      const usage: SummaryUsage = {
        userDaily: userRows[0]?.value ?? 0,
        globalDaily: globalRows[0]?.value ?? 0,
        monthlyCostUsd: Number(spendRows[0]?.value ?? 0) / 1_000_000,
        activeClaims: active[0]?.value ?? 0,
      };
      if (latest) usage.lastGeneratedAt = latest.createdAt;
      return usage;
    },

    async save(summary, evidence) {
      const [inserted] = await database
        .insert(journalSummary)
        .values({
          id: summary.id,
          userId: summary.userId,
          localDate: summary.localDate,
          snapshotHash: summary.snapshotHash,
          model: summary.model,
          output: summary.output,
          inputTokens: summary.inputTokens,
          outputTokens: summary.outputTokens,
          estimatedCostMicrousd: Math.round(
            summary.estimatedCostUsd * 1_000_000,
          ),
          createdAt: summary.createdAt,
        })
        .onConflictDoNothing({
          target: [journalSummary.userId, journalSummary.snapshotHash],
        })
        .returning();
      if (inserted) {
        await deleteSummaryWhenEvidenceIsBlocked(
          database,
          summary.userId,
          summary.snapshotHash,
          evidence,
        );
        return hydrate(inserted);
      }
      const existing = await this.findBySnapshotHash(
        summary.userId,
        summary.snapshotHash,
      );
      if (!existing) throw new Error("Summary cache conflict was not readable");
      return existing;
    },

    async claimSlot(input) {
      const [claimed] = await database
        .insert(journalSummaryGeneration)
        .values({
          id: randomUUID(),
          userId: input.userId,
          localDate: input.localDate,
          snapshotHash: input.snapshotHash,
          status: "active",
          claimedAt: input.now,
        })
        .onConflictDoNothing({
          target: [
            journalSummaryGeneration.userId,
            journalSummaryGeneration.snapshotHash,
          ],
        })
        .returning({ id: journalSummaryGeneration.id });
      if (!claimed) return null;
      return {
        async finish(succeeded) {
          await database
            .update(journalSummaryGeneration)
            .set({ status: succeeded ? "complete" : "failed" })
            .where(eq(journalSummaryGeneration.id, claimed.id));
        },
      };
    },
  };
}

export const journalSummaryRepository = createJournalSummaryRepository(db);
