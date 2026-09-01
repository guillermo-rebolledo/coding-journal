import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";

import { db } from "@/db";
import {
  githubInstallation,
  githubInstallationState,
  journalOnboarding,
} from "@/db/auth-schema";
import type { GitHubInstallationDetails } from "@/lib/github-app";

const installationStateLifetimeMs = 10 * 60 * 1000;

function hashInstallationState(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createGitHubInstallationState(
  userId: string,
  returnTo: "/journal" | "/settings",
) {
  const token = randomBytes(32).toString("base64url");

  await db.insert(githubInstallationState).values({
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
  const [state] = await db
    .delete(githubInstallationState)
    .where(
      and(
        eq(githubInstallationState.userId, userId),
        eq(githubInstallationState.tokenHash, hashInstallationState(token)),
        gt(githubInstallationState.expiresAt, new Date()),
      ),
    )
    .returning({ returnTo: githubInstallationState.returnTo });

  if (state?.returnTo !== "/journal" && state?.returnTo !== "/settings") {
    return null;
  }

  return { returnTo: state.returnTo };
}

export async function saveGitHubInstallation(
  userId: string,
  details: GitHubInstallationDetails,
) {
  await db
    .delete(githubInstallation)
    .where(
      and(
        eq(githubInstallation.userId, userId),
        eq(githubInstallation.status, "pending"),
      ),
    );

  await db
    .insert(githubInstallation)
    .values({
      id: randomUUID(),
      userId,
      ...details,
      status: "active",
    })
    .onConflictDoUpdate({
      target: [githubInstallation.userId, githubInstallation.installationId],
      set: {
        userId,
        ...details,
        status: "active",
        updatedAt: new Date(),
      },
    });

  await db
    .insert(journalOnboarding)
    .values({ userId, githubAccessMode: "app" })
    .onConflictDoUpdate({
      target: journalOnboarding.userId,
      set: { githubAccessMode: "app", updatedAt: new Date() },
    });
}

export async function savePendingGitHubInstallation(userId: string) {
  await db
    .delete(githubInstallation)
    .where(
      and(
        eq(githubInstallation.userId, userId),
        eq(githubInstallation.status, "pending"),
      ),
    );

  await db.insert(githubInstallation).values({
    id: randomUUID(),
    userId,
    status: "pending",
  });
}

export type StoredGitHubInstallation = Pick<
  typeof githubInstallation.$inferSelect,
  | "installationId"
  | "accountLogin"
  | "accountType"
  | "repositorySelection"
  | "repositoryCount"
  | "status"
>;

export async function getGitHubInstallations(
  userId: string,
): Promise<StoredGitHubInstallation[]> {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_MODE === "true" &&
    userId === "e2e-user"
  ) {
    return [];
  }

  return db.query.githubInstallation.findMany({
    columns: {
      installationId: true,
      accountLogin: true,
      accountType: true,
      repositorySelection: true,
      repositoryCount: true,
      status: true,
    },
    where: eq(githubInstallation.userId, userId),
    orderBy: (installation, { asc }) => [asc(installation.createdAt)],
  });
}
