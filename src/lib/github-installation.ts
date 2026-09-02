import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { GitHubInstallationDetails } from "@/lib/github-app";
import { e2eGitHubInstallations } from "@/lib/e2e-fixtures";
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

/** The fixture installations a smoke-test user starts with, if any. */
function fixtureInstallations(
  userId: string,
): readonly StoredGitHubInstallation[] {
  return Object.hasOwn(e2eGitHubInstallations, userId)
    ? (e2eGitHubInstallations[
        // SAFETY: `Object.hasOwn` established that this user has fixtures.
        userId as keyof typeof e2eGitHubInstallations
      ] ?? [])
    : [];
}

export async function getGitHubInstallations(
  userId: string,
): Promise<StoredGitHubInstallation[]> {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_MODE === "true" &&
    userId.startsWith("e2e-")
  ) {
    return fixtureInstallations(userId).map((installation) => ({
      ...installation,
    }));
  }

  return findInstallations(userId);
}
