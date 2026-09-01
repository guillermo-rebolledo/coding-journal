import type { StoredGitHubInstallation } from "@/lib/github-installation";
import { githubActivityRepository } from "@/lib/github-activity-repository";
import {
  getLocalDayWindow,
  reconcileGitHubActivity,
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

  let accessToken: string | null = null;
  try {
    accessToken = await getGitHubUserAccessToken(requestHeaders, userId);
  } catch {
    // The reconciliation result deliberately carries the provider error state.
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
  });
}
