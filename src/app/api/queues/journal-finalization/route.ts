import { handleCallback } from "@vercel/queue";

import { getGitHubInstallations } from "@/lib/github-installation";
import { getGitHubUserAccessTokenForJob } from "@/lib/github-user-token";
import {
  processJournalFinalization,
  parseJournalFinalizationMessage,
} from "@/lib/journal-finalization";
import { journalFinalizationRepository } from "@/lib/journal-finalization-repository";
import { getJournalOnboarding } from "@/lib/journal";
import { generateJournalSummary } from "@/lib/journal-summary";
import { journalSummaryRepository } from "@/lib/journal-summary-repository";
import { openAiSummaryProvider } from "@/lib/openai-summary";
import {
  QueueSaturatedError,
  withQueueSlot,
  type QueueTopic,
} from "@/lib/queue-lease";
import { queueLeaseRepository } from "@/lib/queue-lease-repository";
import {
  assertProviderAvailable,
  ProviderUnavailableError,
} from "@/lib/service-circuit";
import { serviceCircuitRepository } from "@/lib/service-circuit-repository";
import { logServiceEvent } from "@/lib/telemetry";
import { getTodayJournal } from "@/lib/today-journal";

const topic: QueueTopic = "journal-finalization";

function configuredNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Finalization is the most expensive job in the product: a full day
 * reconciliation followed by a narrative generation. Before any of it starts
 * the consumer takes a concurrency slot and checks both provider circuits, so
 * a GitHub or summary outage delays the day rather than spending a retry
 * budget on calls that cannot succeed.
 */
export const POST = handleCallback(
  async (message, metadata) => {
    const now = new Date();
    const parsed = parseJournalFinalizationMessage(message);
    const jobId = parsed ? `${parsed.userId}:${parsed.localDate}` : undefined;

    await withQueueSlot(
      { topic, store: queueLeaseRepository, now, ...(jobId ? { jobId } : {}) },
      async () => {
        await assertProviderAvailable({
          service: "github",
          store: serviceCircuitRepository,
          now,
          ...(jobId ? { jobId } : {}),
        });
        if (process.env.OPENAI_API_KEY) {
          await assertProviderAvailable({
            service: "openai",
            store: serviceCircuitRepository,
            now,
            ...(jobId ? { jobId } : {}),
          });
        }

        await processJournalFinalization(
          message,
          metadata.deliveryCount,
          journalFinalizationRepository,
          async (candidate) => {
            const [onboarding, installations, accessToken] = await Promise.all([
              getJournalOnboarding(candidate.userId),
              getGitHubInstallations(candidate.userId),
              getGitHubUserAccessTokenForJob(candidate.userId),
            ]);
            if (!onboarding.githubAccessMode) {
              throw new Error("Journal access mode is not configured");
            }
            return getTodayJournal({
              requestHeaders: new Headers(),
              userId: candidate.userId,
              timeZone: candidate.timeZone,
              accessMode: onboarding.githubAccessMode,
              installations,
              localDate: candidate.localDate,
              accessToken,
              now,
            });
          },
          ({ userId, localDate, activities }) =>
            generateJournalSummary({
              userId,
              localDate,
              activities,
              store: journalSummaryRepository,
              provider: openAiSummaryProvider,
              now,
              limits: {
                globalDaily: configuredNumber(
                  process.env.SUMMARY_GLOBAL_DAILY_LIMIT,
                  1_000,
                ),
                monthlySpendUsd: configuredNumber(
                  process.env.SUMMARY_MONTHLY_SPEND_LIMIT_USD,
                  100,
                ),
                maximumInputBytes: configuredNumber(
                  process.env.SUMMARY_MAXIMUM_INPUT_BYTES,
                  16_000,
                ),
                queueConcurrency: configuredNumber(
                  process.env.SUMMARY_QUEUE_CONCURRENCY,
                  5,
                ),
              },
            }),
          now,
        );

        logServiceEvent({
          category: "finalization",
          event: "delivery-processed",
          outcome: "ok",
          ...(jobId ? { jobId } : {}),
          attempt: metadata.deliveryCount,
        });
      },
    );
  },
  {
    // Neither refusal is a failure of this day's journal, so the message is
    // redelivered instead of counting against the finalization attempts.
    retry: (error) =>
      error instanceof QueueSaturatedError ||
      error instanceof ProviderUnavailableError
        ? { afterSeconds: error.retryAfterSeconds }
        : undefined,
  },
);
