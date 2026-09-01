import { randomUUID } from "node:crypto";

import type { StoredGitHubInstallation } from "@/lib/github-installation";
import { githubActivityRepository } from "@/lib/github-activity-repository";
import {
  describeError,
  getLocalDayWindow,
  reconcileGitHubActivity,
  type ReconciliationDiagnostic,
  type TodayJournal,
} from "@/lib/github-reconciliation";
import { getGitHubUserAccessToken } from "@/lib/github-user-token";

function emptyE2EJournal(timeZone: string, now: Date): TodayJournal {
  return {
    localDate: getLocalDayWindow(now, timeZone).localDate,
    timeZone,
    status: "complete",
    refreshedAt: now,
    metrics: { pushes: 0, commits: 0 },
    activities: [],
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
    return emptyE2EJournal(timeZone, now);
  }

  const reportDiagnostic = createDiagnosticReporter(userId);

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

  return reconcileGitHubActivity({
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
}
