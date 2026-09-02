import { handleCallback } from "@vercel/queue";

import { getGitHubInstallations } from "@/lib/github-installation";
import { isJsonObject } from "@/lib/json-payload";
import { getGitHubUserAccessTokenForJob } from "@/lib/github-user-token";
import { getJournalOnboarding } from "@/lib/journal";
import { processJournalFinalization } from "@/lib/journal-finalization";
import { journalFinalizationRepository } from "@/lib/journal-finalization-repository";
import { generateJournalSummary } from "@/lib/journal-summary";
import { journalSummaryRepository } from "@/lib/journal-summary-repository";
import { openAiSummaryProvider } from "@/lib/openai-summary";
import { queueLeaseRepository } from "@/lib/queue-lease-repository";
import { serviceCircuitRepository } from "@/lib/service-circuit-repository";
import { reconcileTodayJournalDay } from "@/lib/today-journal";

import { createFinalizationConsumer } from "./handler";

const consumer = createFinalizationConsumer({
  leases: queueLeaseRepository,
  circuits: serviceCircuitRepository,
  finalize: (payload, deliveryCount, now) =>
    processJournalFinalization(
      payload,
      deliveryCount,
      journalFinalizationRepository,
      async (candidate) => {
        const [onboarding, installations, accessToken] = await Promise.all([
          // A queue message never carries a fixture session.
          getJournalOnboarding(candidate.userId, null),
          getGitHubInstallations(candidate.userId),
          getGitHubUserAccessTokenForJob(candidate.userId),
        ]);
        if (!onboarding.githubAccessMode) {
          throw new Error("Journal access mode is not configured");
        }
        return reconcileTodayJournalDay({
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
        }),
      now,
    ),
});

// The platform boundary: a queue payload becomes a decoded message here, and
// the consumer below only ever sees one.
export const POST = handleCallback(
  (message, metadata) =>
    consumer.handle(isJsonObject(message) ? message : null, metadata),
  { retry: consumer.retry },
);
