import { and, count, eq, gte, isNotNull, lt, sum } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "@/db";
import {
  githubWebhookDelivery,
  journalFinalization,
  journalReconciliation,
  journalSummary,
  journalSummaryGeneration,
  privacyOperation,
  rateLimitCounter,
  serviceLease,
} from "@/db/auth-schema";
import { privacyOperationStaleAfterMs } from "@/lib/privacy-ledger";
import { queueConcurrency, type QueueTopic } from "@/lib/queue-lease";
import { rateLimitPolicies } from "@/lib/rate-limit";

/**
 * The operational view.
 *
 * Coding Journal deliberately runs without an error-tracking vendor, so the
 * question "what is failing right now?" has to be answerable from the
 * product's own tables. This report answers it for all five failure surfaces —
 * sync, queue, provider, budget and finalization — as counts only. It contains
 * no user identifier, no repository, no evidence and no narrative, so it is
 * safe to page through, paste into an incident channel, or archive.
 */

export type ServiceHealthReport = {
  generatedAt: string;
  windowHours: number;
  sync: {
    complete: number;
    partial: number;
    error: number;
    loading: number;
  };
  queue: {
    webhookDeliveries: Record<string, number>;
    activeSlots: Record<QueueTopic, { active: number; limit: number }>;
  };
  provider: {
    circuits: Array<{
      service: string;
      state: string;
      failureCount: number;
      retryAt: string | null;
    }>;
    summaryGenerations: Record<string, number>;
  };
  budget: {
    githubSyncDaily: { used: number; limit: number; resetAt: string | null };
    summaryMonthlySpendUsd: { used: number; limit: number };
    summariesToday: number;
  };
  finalization: {
    byStatus: Record<string, number>;
    recoverableErrors: number;
    redactedNarratives: number;
  };
  privacy: {
    failedOperations: number;
    runningOperations: number;
  };
};

function toRecord(rows: Array<{ key: string | null; value: number }>) {
  return Object.fromEntries(
    rows.map((row) => [row.key ?? "unknown", row.value]),
  );
}

function utcMonthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function createServiceHealthReport<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof import("@/db/auth-schema")>) {
  return async function report(
    now: Date = new Date(),
    windowHours = 24,
  ): Promise<ServiceHealthReport> {
    const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
    const monthStart = utcMonthStart(now);
    const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const policies = rateLimitPolicies();

    const [
      reconciliations,
      deliveries,
      leases,
      circuits,
      generations,
      syncBudget,
      spend,
      summariesToday,
      finalizations,
      recoverableErrors,
      redactedNarratives,
      privacyFailures,
      privacyRunning,
    ] = await Promise.all([
      database
        .select({ key: journalReconciliation.status, value: count() })
        .from(journalReconciliation)
        .where(gte(journalReconciliation.updatedAt, since))
        .groupBy(journalReconciliation.status),
      database
        .select({ key: githubWebhookDelivery.status, value: count() })
        .from(githubWebhookDelivery)
        .where(gte(githubWebhookDelivery.receivedAt, since))
        .groupBy(githubWebhookDelivery.status),
      database
        .select({ key: serviceLease.topic, value: count() })
        .from(serviceLease)
        .where(gte(serviceLease.expiresAt, now))
        .groupBy(serviceLease.topic),
      database.query.serviceCircuit.findMany(),
      database
        .select({ key: journalSummaryGeneration.status, value: count() })
        .from(journalSummaryGeneration)
        .where(gte(journalSummaryGeneration.claimedAt, since))
        .groupBy(journalSummaryGeneration.status),
      database.query.rateLimitCounter.findFirst({
        columns: { count: true, windowEndsAt: true },
        where: and(
          eq(rateLimitCounter.scope, "github-sync-daily"),
          eq(rateLimitCounter.subject, "global"),
        ),
      }),
      database
        .select({ value: sum(journalSummary.estimatedCostMicrousd) })
        .from(journalSummary)
        .where(gte(journalSummary.createdAt, monthStart)),
      database
        .select({ value: count() })
        .from(journalSummary)
        .where(gte(journalSummary.createdAt, dayStart)),
      database
        .select({ key: journalFinalization.status, value: count() })
        .from(journalFinalization)
        .groupBy(journalFinalization.status),
      database
        .select({ value: count() })
        .from(journalFinalization)
        .where(isNotNull(journalFinalization.lastFailure)),
      database
        .select({ value: count() })
        .from(journalFinalization)
        .where(isNotNull(journalFinalization.narrativeRedactedAt)),
      database
        .select({ value: count() })
        .from(privacyOperation)
        .where(
          and(
            eq(privacyOperation.status, "failed"),
            gte(privacyOperation.updatedAt, since),
          ),
        ),
      database
        .select({ value: count() })
        .from(privacyOperation)
        .where(
          and(
            eq(privacyOperation.status, "running"),
            lt(
              privacyOperation.updatedAt,
              new Date(now.getTime() - privacyOperationStaleAfterMs),
            ),
          ),
        ),
    ]);

    const sync = toRecord(reconciliations);
    const activeLeases = toRecord(leases);
    const syncWindowLive =
      syncBudget && syncBudget.windowEndsAt > now ? syncBudget : null;

    return {
      generatedAt: now.toISOString(),
      windowHours,
      sync: {
        complete: sync.complete ?? 0,
        partial: sync.partial ?? 0,
        error: sync.error ?? 0,
        loading: sync.loading ?? 0,
      },
      queue: {
        webhookDeliveries: toRecord(deliveries),
        activeSlots: {
          "github-webhook-deliveries": {
            active: activeLeases["github-webhook-deliveries"] ?? 0,
            limit: queueConcurrency("github-webhook-deliveries"),
          },
          "journal-finalization": {
            active: activeLeases["journal-finalization"] ?? 0,
            limit: queueConcurrency("journal-finalization"),
          },
        },
      },
      provider: {
        circuits: circuits.map((circuit) => ({
          service: circuit.service,
          state: circuit.state,
          failureCount: circuit.failureCount,
          retryAt: circuit.retryAt?.toISOString() ?? null,
        })),
        summaryGenerations: toRecord(generations),
      },
      budget: {
        githubSyncDaily: {
          used: syncWindowLive?.count ?? 0,
          limit: policies["github-sync-daily"].limit,
          resetAt: syncWindowLive?.windowEndsAt.toISOString() ?? null,
        },
        summaryMonthlySpendUsd: {
          used: Number(spend[0]?.value ?? 0) / 1_000_000,
          limit: Number(process.env.SUMMARY_MONTHLY_SPEND_LIMIT_USD) || 100,
        },
        summariesToday: summariesToday[0]?.value ?? 0,
      },
      finalization: {
        byStatus: toRecord(finalizations),
        recoverableErrors: recoverableErrors[0]?.value ?? 0,
        redactedNarratives: redactedNarratives[0]?.value ?? 0,
      },
      privacy: {
        failedOperations: privacyFailures[0]?.value ?? 0,
        runningOperations: privacyRunning[0]?.value ?? 0,
      },
    };
  };
}

export const serviceHealthReport = createServiceHealthReport(db);
