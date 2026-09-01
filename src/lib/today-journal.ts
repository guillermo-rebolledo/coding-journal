import { randomUUID } from "node:crypto";

import type { StoredGitHubInstallation } from "@/lib/github-installation";
import { githubActivityRepository } from "@/lib/github-activity-repository";
import {
  computeActivityMetrics,
  describeError,
  getLocalDayWindow,
  reconcileGitHubActivity,
  type ActivityRecord,
  type ReconciliationDiagnostic,
  type TodayJournal,
} from "@/lib/github-reconciliation";
import { getGitHubUserAccessToken } from "@/lib/github-user-token";

function e2eJournal(userId: string, timeZone: string, now: Date): TodayJournal {
  const localDate = getLocalDayWindow(now, timeZone).localDate;
  const activities =
    userId === "e2e-all"
      ? ([
          {
            deduplicationKey: "e2e:push:api",
            localDate,
            kind: "push",
            actorId: "7",
            actorLogin: "ada",
            repositoryId: "42",
            repositoryName: "acme/api",
            evidenceUrl:
              "https://github.com/acme/api/compare/1111111...2222222",
            visibility: "private",
            source: "github-webhook",
            subjectId: "push-api",
            subjectNumber: null,
            subjectTitle: "main",
            occurredAt: new Date(now.getTime() - 30 * 60 * 1000),
            observedAt: now,
            authoredBeforeDay: false,
            installationId: "10",
          },
          {
            deduplicationKey: "e2e:issue:web",
            localDate,
            kind: "issue-opened",
            actorId: "7",
            actorLogin: "ada",
            repositoryId: "43",
            repositoryName: "acme/web",
            evidenceUrl: "https://github.com/acme/web/issues/51",
            visibility: "public",
            source: "github-events",
            subjectId: "51",
            subjectNumber: 51,
            subjectTitle: "Polish Today filters",
            occurredAt: new Date(now.getTime() - 15 * 60 * 1000),
            observedAt: now,
            authoredBeforeDay: false,
            installationId: null,
          },
        ] satisfies ActivityRecord[])
      : [];
  return {
    localDate,
    timeZone,
    status: "complete",
    refreshedAt: now,
    storedAt: now,
    lastAttemptAt: now,
    metrics: computeActivityMetrics(activities),
    activities,
  };
}

// Correlates every failure in one reconciliation attempt under a single
// opaque id. Stage and error class only -- never tokens, payloads, or bodies.
function createDiagnosticReporter(userId: string) {
  const attemptId = randomUUID();
  return (diagnostic: ReconciliationDiagnostic) => {
    console.error(
      "[journal-reconciliation]",
      JSON.stringify({ attemptId, userId, ...diagnostic }),
    );
  };
}

export async function getTodayJournal({
  requestHeaders,
  userId,
  timeZone,
  accessMode,
  installations,
  now = new Date(),
}: {
  requestHeaders: Headers;
  userId: string;
  timeZone: string;
  accessMode: "best-effort" | "app";
  installations: StoredGitHubInstallation[];
  now?: Date;
}) {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_MODE === "true" &&
    userId.startsWith("e2e-")
  ) {
    return e2eJournal(userId, timeZone, now);
  }

  let rateLimitedUntil: Date | undefined;
  const logDiagnostic = createDiagnosticReporter(userId);
  const reportDiagnostic = (diagnostic: ReconciliationDiagnostic) => {
    logDiagnostic(diagnostic);
    if (
      diagnostic.rateLimitResetAt &&
      (!rateLimitedUntil || diagnostic.rateLimitResetAt > rateLimitedUntil)
    ) {
      rateLimitedUntil = diagnostic.rateLimitResetAt;
    }
  };

  let accessToken: string | null = null;
  try {
    accessToken = await getGitHubUserAccessToken(requestHeaders, userId);
  } catch (error) {
    // The reconciliation result deliberately carries the provider error state.
    reportDiagnostic({ stage: "user-access-token", ...describeError(error) });
  }
  if (!accessToken) {
    reportDiagnostic({
      stage: "user-access-token",
      errorName: "NoAccessToken",
      errorMessage: "No GitHub access token was resolved for the user",
    });
  }

  const journal = await reconcileGitHubActivity({
    userId,
    timeZone,
    accessMode,
    installationIds: installations.flatMap((installation) =>
      installation.status === "active" && installation.installationId
        ? [installation.installationId]
        : [],
    ),
    accessToken,
    now,
    store: githubActivityRepository,
    reportDiagnostic,
  });
  return rateLimitedUntil ? { ...journal, rateLimitedUntil } : journal;
}

export async function getStoredTodayJournal(
  options: Parameters<typeof getTodayJournal>[0],
) {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_MODE === "true" &&
    options.userId.startsWith("e2e-")
  ) {
    return getTodayJournal(options);
  }
  const localDate = getLocalDayWindow(
    options.now ?? new Date(),
    options.timeZone,
  ).localDate;
  try {
    return await githubActivityRepository.read(options.userId, localDate);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "The journal reconciliation has not been started." ||
        error.message === "Reconciliation was not finished")
    ) {
      return getTodayJournal(options);
    }
    throw error;
  }
}
