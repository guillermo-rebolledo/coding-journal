import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { GitHubInstallationDetails } from "@/lib/github-app";
import {
  consumeInstallationState,
  deletePendingInstallation,
  findInstallations,
  insertInstallationState,
  insertPendingInstallation,
  markInstallationDisconnected,
  setGitHubAccessMode,
  upsertActiveInstallation,
} from "@/lib/github-installation-repository";

const installationStateLifetimeMs = 10 * 60 * 1000;

function hashInstallationState(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createGitHubInstallationState(
  userId: string,
  returnTo: "/journal" | "/settings",
) {
  const token = randomBytes(32).toString("base64url");

  await insertInstallationState({
    id: randomUUID(),
    userId,
    tokenHash: hashInstallationState(token),
    returnTo,
    expiresAt: new Date(Date.now() + installationStateLifetimeMs),
  });

  return token;
}

export async function consumeGitHubInstallationState(
  userId: string,
  token: string,
) {
  const state = await consumeInstallationState(
    userId,
    hashInstallationState(token),
    new Date(),
  );

  if (state?.returnTo !== "/journal" && state?.returnTo !== "/settings") {
    return null;
  }

  return { returnTo: state.returnTo };
}

export async function saveGitHubInstallation(
  userId: string,
  details: GitHubInstallationDetails,
) {
  await deletePendingInstallation(userId, details.accountId);
  await upsertActiveInstallation(userId, details);
  await setGitHubAccessMode(userId);
}

export async function savePendingGitHubInstallation(
  userId: string,
  accountId: string,
) {
  await deletePendingInstallation(userId, accountId);
  await insertPendingInstallation(userId, accountId);
}

export type StoredGitHubInstallation = Awaited<
  ReturnType<typeof findInstallations>
>[number];

export async function disconnectGitHubInstallation(
  userId: string,
  installationId: string,
) {
  await markInstallationDisconnected(userId, installationId);
}

export async function getGitHubInstallations(
  userId: string,
): Promise<StoredGitHubInstallation[]> {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_MODE === "true" &&
    userId.startsWith("e2e-")
  ) {
    const fixtureByUser: Record<string, StoredGitHubInstallation[]> = {
      "e2e-all": [
        {
          installationId: "10",
          accountId: "20",
          accountLogin: "ada",
          accountType: "User",
          repositorySelection: "all",
          repositoryCount: 8,
          status: "active",
        },
      ],
      "e2e-partial": [
        {
          installationId: "42",
          accountId: "84",
          accountLogin: "example-org",
          accountType: "Organization",
          repositorySelection: "selected",
          repositoryCount: 3,
          status: "active",
        },
      ],
      "e2e-pending": [
        {
          installationId: null,
          accountId: "84",
          accountLogin: null,
          accountType: "Organization",
          repositorySelection: null,
          repositoryCount: null,
          status: "pending",
        },
      ],
      "e2e-disconnected": [
        {
          installationId: "11",
          accountId: "22",
          accountLogin: "old-org",
          accountType: "Organization",
          repositorySelection: "selected",
          repositoryCount: 2,
          status: "disconnected",
        },
      ],
    };

    return fixtureByUser[userId] ?? [];
  }

  return findInstallations(userId);
}
