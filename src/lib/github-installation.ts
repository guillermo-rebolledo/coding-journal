import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  getUserGitHubInstallation,
  type GitHubInstallationDetails,
} from "@/lib/github-app";
import { readIdentifier } from "@/lib/github-activity";
import type { GitHubReadClient } from "@/lib/github-read-client";
import type { GitHubUserAccess } from "@/lib/github-user-token";
import { readString } from "@/lib/json-payload";
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

export type InstallationAssociationStore = Pick<
  InstallationStore,
  | "deletePendingInstallation"
  | "setGitHubAccessMode"
  | "upsertActiveInstallation"
>;

export class GitHubInstallationSaveError extends Error {
  constructor() {
    super("GitHub installation connection could not be saved");
    this.name = "GitHubInstallationSaveError";
  }
}

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

export const githubInstallationAssociationStore: InstallationAssociationStore =
  productionStore;

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
  store: InstallationAssociationStore = productionStore,
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

export async function associateExistingGitHubInstallations(
  userId: string,
  userAccess: GitHubUserAccess,
  configuredAppSlug: string,
  client: GitHubReadClient,
  store: InstallationAssociationStore = productionStore,
) {
  const actor = await client.authenticatedUser();
  if (readIdentifier(actor, "id") !== userAccess.accountId) {
    return { identityVerified: false, connectedCount: 0, rejectedCount: 0 };
  }

  const accessible = await client.userInstallations();
  let connectedCount = 0;
  let rejectedCount = 0;

  for (const candidate of accessible) {
    if (readString(candidate, "app_slug") !== configuredAppSlug) continue;
    const installationId = readIdentifier(candidate, "id");
    if (!installationId) {
      rejectedCount += 1;
      continue;
    }

    const details = await getUserGitHubInstallation(
      userAccess.accessToken,
      installationId,
      configuredAppSlug,
      client,
    );
    if (!details) {
      rejectedCount += 1;
      continue;
    }

    try {
      await saveGitHubInstallation(userId, details, store);
    } catch {
      throw new GitHubInstallationSaveError();
    }
    connectedCount += 1;
  }

  return { identityVerified: true, connectedCount, rejectedCount };
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

export async function getGitHubInstallations(
  userId: string,
  store: InstallationStore = productionStore,
): Promise<StoredGitHubInstallation[]> {
  return store.findInstallations(userId);
}
