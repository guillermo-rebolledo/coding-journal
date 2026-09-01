import { getUserGitHubInstallation } from "@/lib/github-app";
import {
  disconnectGitHubInstallation,
  getGitHubInstallations,
  saveGitHubInstallation,
  type StoredGitHubInstallation,
} from "@/lib/github-installation";
import { getGitHubUserAccessToken } from "@/lib/github-user-token";

function displayAsDisconnected(
  installation: StoredGitHubInstallation,
): StoredGitHubInstallation {
  return installation.status === "active"
    ? { ...installation, status: "disconnected" }
    : installation;
}

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
    return stored.map(displayAsDisconnected);
  }
  if (!accessToken) return stored.map(displayAsDisconnected);

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
      return stored.map(displayAsDisconnected);
    }
  }

  return getGitHubInstallations(userId);
}
