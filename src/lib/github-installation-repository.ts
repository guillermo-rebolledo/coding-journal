import { randomUUID } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";

import { db } from "@/db";
import {
  githubInstallation,
  githubInstallationState,
  journalOnboarding,
} from "@/db/auth-schema";
import type { GitHubInstallationDetails } from "@/lib/github-app";

export async function insertInstallationState(record: {
  id: string;
  userId: string;
  tokenHash: string;
  returnTo: "/journal" | "/settings";
  expiresAt: Date;
}) {
  await db.insert(githubInstallationState).values(record);
}

export async function consumeInstallationState(
  userId: string,
  tokenHash: string,
  now: Date,
) {
  const [state] = await db
    .delete(githubInstallationState)
    .where(
      and(
        eq(githubInstallationState.userId, userId),
        eq(githubInstallationState.tokenHash, tokenHash),
        gt(githubInstallationState.expiresAt, now),
      ),
    )
    .returning({ returnTo: githubInstallationState.returnTo });

  return state ?? null;
}

export async function deletePendingInstallation(
  userId: string,
  accountId: string,
) {
  await db
    .delete(githubInstallation)
    .where(
      and(
        eq(githubInstallation.userId, userId),
        eq(githubInstallation.accountId, accountId),
        eq(githubInstallation.status, "pending"),
      ),
    );
}

export async function upsertActiveInstallation(
  userId: string,
  details: GitHubInstallationDetails,
) {
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
}

export async function setGitHubAccessMode(userId: string) {
  await db
    .insert(journalOnboarding)
    .values({ userId, githubAccessMode: "app" })
    .onConflictDoUpdate({
      target: journalOnboarding.userId,
      set: { githubAccessMode: "app", updatedAt: new Date() },
    });
}

export async function insertPendingInstallation(
  userId: string,
  accountId: string,
) {
  await db.insert(githubInstallation).values({
    id: randomUUID(),
    userId,
    accountId,
    accountType: "Organization",
    status: "pending",
  });
}

export async function markInstallationDisconnected(
  userId: string,
  installationId: string,
) {
  await db
    .update(githubInstallation)
    .set({ status: "disconnected", updatedAt: new Date() })
    .where(
      and(
        eq(githubInstallation.userId, userId),
        eq(githubInstallation.installationId, installationId),
      ),
    );
}

export async function findInstallations(userId: string) {
  return db.query.githubInstallation.findMany({
    columns: {
      installationId: true,
      accountId: true,
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
