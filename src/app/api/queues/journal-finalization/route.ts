import { handleCallback } from "@vercel/queue";

import { getGitHubInstallations } from "@/lib/github-installation";
import { getGitHubUserAccessTokenForJob } from "@/lib/github-user-token";
import { processJournalFinalization } from "@/lib/journal-finalization";
import { journalFinalizationRepository } from "@/lib/journal-finalization-repository";
import { getJournalOnboarding } from "@/lib/journal";
import { generateJournalSummary } from "@/lib/journal-summary";
import { journalSummaryRepository } from "@/lib/journal-summary-repository";
import { openAiSummaryProvider } from "@/lib/openai-summary";
import { getTodayJournal } from "@/lib/today-journal";

function configuredNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const POST = handleCallback(async (message, metadata) => {
  const now = new Date();
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
});
