import { randomUUID } from "node:crypto";

import type { StoredGitHubInstallation } from "@/lib/github-installation";
import {
  computeActivityMetrics,
} from "@/lib/github-activity";
import { githubActivityRepository } from "@/lib/github-activity-repository";
import {
  describeError,
  reconcileGitHubActivity,
  type ReconciliationDiagnostic,
  type TodayJournal,
} from "@/lib/github-reconciliation";
import { getGitHubUserAccessToken } from "@/lib/github-user-token";
import { createGitHubHttpReadClient } from "@/lib/github-read-client";
import { providerReconciliationStages } from "@/lib/github-reconciliation-stages";
import { JournalNotFoundError } from "@/lib/journal-errors";
import {
  buildSummarySnapshot,
  type JournalSummary,
} from "@/lib/journal-summary";
import { journalSummaryRepository } from "@/lib/journal-summary-repository";
import {
  withProviderCircuitOutcome,
} from "@/lib/service-circuit";
import { serviceCircuitRepository } from "@/lib/service-circuit-repository";
import { logServiceEvent } from "@/lib/telemetry";
import { getLocalDayWindow } from "@/lib/time-zone";
import { nextJournalSyncAt } from "@/lib/today-journal-policy";

export {
  journalReconciliationCooldownMs,
  nextJournalSyncAt,
} from "@/lib/today-journal-policy";

/**
 * The stores a reconciliation pass writes through. They are a parameter with
 * the production default so a caller can supply real stand-ins and still
 * exercise the reconciliation, circuit accounting and telemetry below.
 */
export type TodayJournalStores = {
  activities: typeof githubActivityRepository;
  circuits: typeof serviceCircuitRepository;
  getAccessToken: (
    requestHeaders: Headers,
    userId: string,
  ) => Promise<string | null>;
};

const productionStores: TodayJournalStores = {
  activities: githubActivityRepository,
  circuits: serviceCircuitRepository,
  getAccessToken: getGitHubUserAccessToken,
};

export function describeJournalStatus({
  status,
  awaitingReconciliation = false,
  reconciledLabel = null,
}: {
  status: TodayJournal["status"];
  awaitingReconciliation?: boolean;
  reconciledLabel?: string | null;
}) {
  if (awaitingReconciliation) {
    return {
      emptyTitle: "Your day is ready to refresh",
      emptyDetail:
        "Nothing has been reconciled with GitHub yet today. Stored activity, if any, is already shown.",
      paneTitle: "GitHub reconciliation pending",
      paneDetail: "Refresh Today when you want to check GitHub.",
      completeness: "Final coverage pending",
    };
  }
  if (status === "error") {
    return {
      emptyTitle: "Today could not be refreshed",
      emptyDetail:
        "GitHub did not respond. Everything already stored is shown and stays usable. Try again after the reconciliation cooldown.",
      paneTitle: "GitHub reconciliation unavailable",
      paneDetail: "Stored activity remains available while GitHub recovers.",
      completeness: "Provider unavailable",
    };
  }
  if (status === "loading") {
    return {
      emptyTitle: "Reconciling your day",
      emptyDetail:
        "Checking the repositories Coding Journal can see. This usually takes a few seconds.",
      paneTitle: "Reconciling today's GitHub activity",
      paneDetail: "This may take a moment.",
      completeness: "Final coverage pending",
    };
  }
  if (status === "partial") {
    return {
      emptyTitle: "Nothing recorded today",
      emptyDetail:
        "Coding Journal reconciled with GitHub and found no activity. Private or delayed work outside the repositories it can see would not appear here.",
      paneTitle: "Partial GitHub response",
      paneDetail: "Some granted sources could not be refreshed.",
      completeness: "Partial coverage",
    };
  }
  return {
    emptyTitle: "Nothing recorded today",
    emptyDetail:
      "Coding Journal reconciled with GitHub and found no activity. Private or delayed work outside the repositories it can see would not appear here.",
    paneTitle: "GitHub activity reconciled",
    paneDetail: reconciledLabel
      ? `Updated at ${reconciledLabel}.`
      : "This may take a moment.",
    completeness: "Complete coverage",
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
    const rateLimitResetAt = diagnostic.rateLimitResetAt;
    const retryAfterSeconds = rateLimitResetAt
      ? Math.max(1, Math.ceil((rateLimitResetAt.getTime() - Date.now()) / 1000))
      : undefined;
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
      retryAfterSeconds,
    });
  };
}

// A stage that failed because GitHub itself was unavailable feeds the shared
// circuit; a missing user token is a per-user condition and must not open it.
export async function reconcileTodayJournalDay({
  requestHeaders,
  userId,
  timeZone,
  accessMode,
  installations,
  now = new Date(),
  localDate,
  accessToken: suppliedAccessToken,
  stores = productionStores,
}: {
  requestHeaders: Headers;
  userId: string;
  timeZone: string;
  accessMode: "best-effort" | "app";
  installations: StoredGitHubInstallation[];
  now?: Date;
  localDate?: string;
  accessToken?: string | null;
  stores?: TodayJournalStores;
}) {
  let rateLimitedUntil: Date | undefined;
  let providerFailures = 0;
  const logDiagnostic = createDiagnosticReporter(userId);
  const reportDiagnostic = (diagnostic: ReconciliationDiagnostic) => {
    logDiagnostic(diagnostic);
    if (providerReconciliationStages.has(diagnostic.stage)) {
      providerFailures += 1;
    }
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
      accessToken = await stores.getAccessToken(requestHeaders, userId);
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
  const reconcile = () =>
    reconcileGitHubActivity({
      userId,
      timeZone,
      accessMode,
      installationIds: installations.flatMap((installation) =>
        installation.status === "active" && installation.installationId
          ? [installation.installationId]
          : [],
      ),
      client: accessToken ? createGitHubHttpReadClient(accessToken) : null,
      now,
      localDate,
      store: stores.activities,
      reportDiagnostic,
    });
  const journal = accessToken
    ? await withProviderCircuitOutcome(
        { service: "github", store: stores.circuits, now },
        reconcile,
        (result) =>
          providerFailures > 0
            ? "failure"
            : result.status === "complete"
              ? "success"
              : "neutral",
      )
    : await reconcile();
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

export async function readStoredTodayJournal({
  userId,
  timeZone,
  now = new Date(),
  stores = productionStores,
}: {
  userId: string;
  timeZone: string;
  now?: Date;
  stores?: TodayJournalStores;
}) {
  const localDate = getLocalDayWindow(now, timeZone).localDate;
  try {
    return await stores.activities.read(userId, localDate);
  } catch (error) {
    if (error instanceof JournalNotFoundError)
      return emptyStoredJournal(timeZone, now);
    throw error;
  }
}

export type TodayJournalRead = {
  journal: TodayJournal;
  narrative: JournalSummary | null;
  nextSyncAt: Date | null;
};

/** Reads every piece the Today page renders through one domain operation. */
export async function readTodayJournal({
  userId,
  timeZone,
  now = new Date(),
  stores = productionStores,
  findSummary = journalSummaryRepository.findBySnapshotHash,
}: {
  userId: string;
  timeZone: string;
  now?: Date;
  stores?: TodayJournalStores;
  findSummary?: (
    userId: string,
    snapshotHash: string,
  ) => Promise<JournalSummary | null>;
}): Promise<TodayJournalRead> {
  const journal = await readStoredTodayJournal({
    userId,
    timeZone,
    now,
    stores,
  });
  const narrative = await findSummary(
    userId,
    buildSummarySnapshot(journal.activities).hash,
  );
  return {
    journal,
    narrative,
    nextSyncAt: journal.lastAttemptAt
      ? nextJournalSyncAt(journal.lastAttemptAt)
      : null,
  };
}
