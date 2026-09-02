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

/**
 * The installation repository, as the operations below use it. Each takes it
 * as a parameter with the production default, so a test can supply a real
 * stand-in and still exercise the state hashing and ordering done here.
 */
export type InstallationStore = {
  consumeInstallationState: typeof consumeInstallationState;
  deletePendingInstallation: typeof deletePendingInstallation;
  findInstallations: typeof findInstallations;
  insertInstallationState: typeof insertInstallationState;
  insertPendingInstallation: typeof insertPendingInstallation;
  markInstallationDisconnected: typeof markInstallationDisconnected;
  setGitHubAccessMode: typeof setGitHubAccessMode;
  upsertActiveInstallation: typeof upsertActiveInstallation;
};

const productionStore: InstallationStore = {
  consumeInstallationState,
  deletePendingInstallation,
  findInstallations,
  insertInstallationState,
  insertPendingInstallation,
  markInstallationDisconnected,
  setGitHubAccessMode,
  upsertActiveInstallation,
};

function hashInstallationState(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createGitHubInstallationState(
  userId: string,
  returnTo: "/journal" | "/settings",
  store: InstallationStore = productionStore,
) {
  const token = randomBytes(32).toString("base64url");

  await store.insertInstallationState({
    id: randomUUID(),
    userId,
    tokenHash: hashInstallationState(token),
    returnTo,
    expiresAt: new Date(Date.now() + installationStateLifetimeMs),
  });

  return token;
}

/** Where the install flow returns to once GitHub hands the user back. */
export type InstallationReturnTo = "/journal" | "/settings";

export async function consumeGitHubInstallationState(
  userId: string,
  token: string,
  store: InstallationStore = productionStore,
): Promise<{ returnTo: InstallationReturnTo } | null> {
  const state = await store.consumeInstallationState(
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
  store: InstallationStore = productionStore,
) {
  await store.deletePendingInstallation(userId, details.accountId);
  await store.upsertActiveInstallation(userId, details);
  await store.setGitHubAccessMode(userId);
}

export async function savePendingGitHubInstallation(
  userId: string,
  accountId: string,
  store: InstallationStore = productionStore,
) {
  await store.deletePendingInstallation(userId, accountId);
  await store.insertPendingInstallation(userId, accountId);
}

export type StoredGitHubInstallation = Awaited<
  ReturnType<typeof findInstallations>
>[number];

export async function disconnectGitHubInstallation(
  userId: string,
  installationId: string,
  store: InstallationStore = productionStore,
) {
  await store.markInstallationDisconnected(userId, installationId);
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
  store: InstallationStore = productionStore,
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

  return store.findInstallations(userId);
}
