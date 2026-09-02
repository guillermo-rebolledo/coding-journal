import { randomUUID } from "node:crypto";

import type { StoredGitHubInstallation } from "@/lib/github-installation";
import { isE2EJournalUser } from "@/lib/e2e-fixtures";
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
import { JournalNotFoundError } from "@/lib/journal-errors";
import {
  recordProviderFailure,
  recordProviderSuccess,
} from "@/lib/service-circuit";
import { serviceCircuitRepository } from "@/lib/service-circuit-repository";
import { logServiceEvent } from "@/lib/telemetry";

function e2eJournal(userId: string, timeZone: string, now: Date): TodayJournal {
  const localDate = getLocalDayWindow(now, timeZone).localDate;
  const awaitingReconciliation = userId === "e2e-user";
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
    refreshedAt: awaitingReconciliation ? null : now,
    ...(awaitingReconciliation
      ? { awaitingReconciliation: true }
      : { storedAt: now, lastAttemptAt: now }),
    metrics: computeActivityMetrics(activities),
    activities,
  };
}

function emptyStoredJournal(timeZone: string, now: Date): TodayJournal {
  return {
    localDate: getLocalDayWindow(now, timeZone).localDate,
    timeZone,
    status: "complete",
    refreshedAt: null,
    awaitingReconciliation: true,
    metrics: computeActivityMetrics([]),
    activities: [],
  };
}

// Correlates every failure in one reconciliation attempt under a single
// opaque id. Stage and error class only -- never tokens, payloads, or bodies.
function createDiagnosticReporter(userId: string) {
  const attemptId = randomUUID();
  return (diagnostic: ReconciliationDiagnostic) => {
    logServiceEvent({
      category: "sync",
      event: "reconciliation-stage-failed",
      outcome: "degraded",
      service: "github",
      userId,
      jobId: attemptId,
      stage: diagnostic.stage,
      errorName: diagnostic.errorName,
      errorMessage: diagnostic.errorMessage,
      ...(diagnostic.rateLimitResetAt
        ? {
            retryAfterSeconds: Math.max(
              1,
              Math.ceil(
                (diagnostic.rateLimitResetAt.getTime() - Date.now()) / 1000,
              ),
            ),
          }
        : {}),
    });
  };
}

// A stage that failed because GitHub itself was unavailable feeds the shared
// circuit; a missing user token is a per-user condition and must not open it.
const providerStages = new Set<ReconciliationDiagnostic["stage"]>([
  "actor",
  "events",
  "gists",
  "gist-metadata",
  "push-commits",
  "installation-repositories",
  "repository-commits",
]);

export async function getTodayJournal({
  requestHeaders,
  userId,
  timeZone,
  accessMode,
  installations,
  now = new Date(),
  localDate,
  accessToken: suppliedAccessToken,
}: {
  requestHeaders: Headers;
  userId: string;
  timeZone: string;
  accessMode: "best-effort" | "app";
  installations: StoredGitHubInstallation[];
  now?: Date;
  localDate?: string;
  accessToken?: string | null;
}) {
  if (isE2EJournalUser(userId)) {
    return e2eJournal(userId, timeZone, now);
  }

  let rateLimitedUntil: Date | undefined;
  let providerFailures = 0;
  const logDiagnostic = createDiagnosticReporter(userId);
  const reportDiagnostic = (diagnostic: ReconciliationDiagnostic) => {
    logDiagnostic(diagnostic);
    if (providerStages.has(diagnostic.stage)) providerFailures += 1;
    if (
      diagnostic.rateLimitResetAt &&
      (!rateLimitedUntil || diagnostic.rateLimitResetAt > rateLimitedUntil)
    ) {
      rateLimitedUntil = diagnostic.rateLimitResetAt;
    }
  };

  let accessToken = suppliedAccessToken;
  if (accessToken === undefined) {
    try {
      accessToken = await getGitHubUserAccessToken(requestHeaders, userId);
    } catch (error) {
      // The reconciliation result deliberately carries the provider error state.
      reportDiagnostic({ stage: "user-access-token", ...describeError(error) });
      accessToken = null;
    }
  }
  if (!accessToken) {
    reportDiagnostic({
      stage: "user-access-token",
      errorName: "NoAccessToken",
      errorMessage: "No GitHub access token was resolved for the user",
    });
  }

  const startedAt = Date.now();
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
    localDate,
    store: githubActivityRepository,
    reportDiagnostic,
  });
  if (providerFailures > 0) {
    await recordProviderFailure({
      service: "github",
      store: serviceCircuitRepository,
    });
  } else if (journal.status === "complete") {
    await recordProviderSuccess({
      service: "github",
      store: serviceCircuitRepository,
    });
  }
  logServiceEvent({
    category: "sync",
    event: "reconciliation-finished",
    outcome:
      journal.status === "error"
        ? "failed"
        : journal.status === "partial"
          ? "degraded"
          : "ok",
    service: "github",
    userId,
    stage: journal.status,
    count: journal.activities.length,
    durationMs: Date.now() - startedAt,
  });
  return rateLimitedUntil ? { ...journal, rateLimitedUntil } : journal;
}

export async function getStoredTodayJournal(
  options: Parameters<typeof getTodayJournal>[0],
) {
  if (isE2EJournalUser(options.userId)) {
    return getTodayJournal(options);
  }
  const localDate = getLocalDayWindow(
    options.now ?? new Date(),
    options.timeZone,
  ).localDate;
  try {
    return await githubActivityRepository.read(options.userId, localDate);
  } catch (error) {
    if (error instanceof JournalNotFoundError)
      return emptyStoredJournal(options.timeZone, options.now ?? new Date());
    throw error;
  }
}
