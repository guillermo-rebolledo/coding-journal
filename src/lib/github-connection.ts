import { getUserGitHubInstallation } from "@/lib/github-app";
import {
  disconnectGitHubInstallation,
  getGitHubInstallations,
  saveGitHubInstallation,
  type StoredGitHubInstallation,
} from "@/lib/github-installation";
import { getGitHubUserAccessToken } from "@/lib/github-user-token";
import type { GitHubConnectionView } from "@/lib/github-completeness";

function displayAsUnavailable(
  installation: StoredGitHubInstallation,
): GitHubConnectionView {
  return installation.status === "active"
    ? { ...installation, status: "unavailable" }
    : installation;
}

/** A stored installation, after the freshness pass this module runs. */
export type GitHubConnection = Awaited<
  ReturnType<typeof refreshGitHubConnections>
>[number];

export async function refreshGitHubConnections(
  requestHeaders: Headers,
  userId: string,
) {
  const stored = await getGitHubInstallations(userId);
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_MODE === "true"
  ) {
    return stored;
  }

  const active = stored.filter(
    (installation) =>
      installation.status === "active" && installation.installationId,
  );
  if (!active.length) return stored;

  let accessToken: string | null;
  try {
    accessToken = await getGitHubUserAccessToken(requestHeaders, userId);
  } catch {
    return stored.map(displayAsUnavailable);
  }
  if (!accessToken) return stored.map(displayAsUnavailable);

  const unavailableInstallationIds = new Set<string>();

  for (const installation of active) {
    try {
      const details = await getUserGitHubInstallation(
        accessToken,
        installation.installationId!,
      );
      if (details) {
        await saveGitHubInstallation(userId, details);
      } else {
        await disconnectGitHubInstallation(
          userId,
          installation.installationId!,
        );
      }
    } catch {
      unavailableInstallationIds.add(installation.installationId!);
    }
  }

  const refreshed = await getGitHubInstallations(userId);
  return refreshed.map((installation) =>
    installation.installationId &&
    unavailableInstallationIds.has(installation.installationId)
      ? displayAsUnavailable(installation)
      : installation,
  );
}
