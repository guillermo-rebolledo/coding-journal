import { randomUUID } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "@/db";
import {
  githubInstallation,
  githubInstallationState,
  journalOnboarding,
} from "@/db/auth-schema";
import type { GitHubInstallationDetails } from "@/lib/github-app";

export function createGitHubInstallationRepository<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof import("@/db/auth-schema")>) {
  async function insertInstallationState(record: {
    id: string;
    userId: string;
    tokenHash: string;
    returnTo: "/journal" | "/settings";
    expiresAt: Date;
  }) {
    await database.insert(githubInstallationState).values(record);
  }

  async function consumeInstallationState(
    userId: string,
    tokenHash: string,
    now: Date,
  ) {
    const [state] = await database
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

  async function deletePendingInstallation(userId: string, accountId: string) {
    await database
      .delete(githubInstallation)
      .where(
        and(
          eq(githubInstallation.userId, userId),
          eq(githubInstallation.accountId, accountId),
          eq(githubInstallation.status, "pending"),
        ),
      );
  }

  async function upsertActiveInstallation(
    userId: string,
    details: GitHubInstallationDetails,
  ) {
    await database
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

  async function setGitHubAccessMode(userId: string) {
    await database
      .insert(journalOnboarding)
      .values({ userId, githubAccessMode: "app" })
      .onConflictDoUpdate({
        target: journalOnboarding.userId,
        set: { githubAccessMode: "app", updatedAt: new Date() },
      });
  }

  async function insertPendingInstallation(userId: string, accountId: string) {
    await database.insert(githubInstallation).values({
      id: randomUUID(),
      userId,
      accountId,
      accountType: "Organization",
      status: "pending",
    });
  }

  async function markInstallationDisconnected(
    userId: string,
    installationId: string,
  ) {
    await database
      .update(githubInstallation)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(
        and(
          eq(githubInstallation.userId, userId),
          eq(githubInstallation.installationId, installationId),
        ),
      );
  }

  async function findInstallations(userId: string) {
    return database.query.githubInstallation.findMany({
      columns: {
        installationId: true,
        accountId: true,
        accountLogin: true,
        accountType: true,
        repositorySelection: true,
        repositoryCount: true,
        permissions: true,
        status: true,
      },
      where: eq(githubInstallation.userId, userId),
      orderBy: (installation, { asc }) => [asc(installation.createdAt)],
    });
  }

  return {
    consumeInstallationState,
    deletePendingInstallation,
    findInstallations,
    insertInstallationState,
    insertPendingInstallation,
    markInstallationDisconnected,
    setGitHubAccessMode,
    upsertActiveInstallation,
  };
}

const productionRepository = createGitHubInstallationRepository(db);

export const {
  consumeInstallationState,
  deletePendingInstallation,
  findInstallations,
  insertInstallationState,
  insertPendingInstallation,
  markInstallationDisconnected,
  setGitHubAccessMode,
  upsertActiveInstallation,
} = productionRepository;
