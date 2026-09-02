// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/auth-schema";
import {
  account,
  githubActivity,
  githubInstallation,
  journalFinalization,
  journalOnboarding,
  journalSummary,
  journalSummaryGeneration,
  session,
  user,
} from "@/db/auth-schema";
import { createAccountDeletion } from "@/lib/account-deletion";

describe("account deletion with Postgres", () => {
  const client = new PGlite();
  const database = drizzle(client, { schema });
  const deleteAccount = createAccountDeletion(database);

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: "drizzle" });
    await database.insert(user).values({
      id: "delete-user",
      name: "Ada Lovelace",
      email: "delete@example.com",
      emailVerified: true,
    });
    await database.insert(account).values({
      id: "delete-account",
      issuer: "https://github.com",
      accountId: "7",
      providerId: "github",
      userId: "delete-user",
      accessToken: "encrypted-provider-token",
      updatedAt: new Date(),
    });
    await database.insert(session).values({
      id: "delete-session",
      token: "session-token",
      userId: "delete-user",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
      updatedAt: new Date(),
    });
    await database.insert(journalSummary).values({
      id: "delete-summary",
      userId: "delete-user",
      localDate: "2026-08-01",
      snapshotHash: "delete-snapshot",
      model: "fixture",
      output: {
        overview: "Private summary",
        overviewEvidenceIds: [],
        accomplishments: [],
        collaboration: [],
        inProgress: [],
      },
    });
    await database.insert(journalSummaryGeneration).values({
      id: "delete-generation",
      userId: "delete-user",
      localDate: "2026-08-01",
      snapshotHash: "delete-generation-snapshot",
      status: "complete",
      claimedAt: new Date("2026-08-01T12:00:00Z"),
    });
    await database.insert(journalOnboarding).values({
      userId: "delete-user",
      timeZone: "UTC",
      githubAccessMode: "app",
    });
    await database.insert(githubInstallation).values({
      id: "delete-installation",
      userId: "delete-user",
      installationId: "99",
      status: "active",
    });
    await database.insert(githubActivity).values({
      id: "delete-activity",
      userId: "delete-user",
      localDate: "2026-08-01",
      kind: "issue-opened",
      deduplicationKey: "github:issue-opened:42:1",
      actorId: "7",
      actorLogin: "ada",
      repositoryId: "42",
      repositoryName: "acme/private",
      evidenceUrl: "https://github.com/acme/private/issues/1",
      visibility: "private",
      source: "github-webhook",
      subjectId: "1",
      subjectNumber: 1,
      subjectTitle: "Private issue",
      occurredAt: new Date("2026-08-01T12:00:00Z"),
      observedAt: new Date("2026-08-01T12:01:00Z"),
      installationId: "99",
    });
    await database.insert(journalFinalization).values({
      id: "delete-finalization",
      userId: "delete-user",
      localDate: "2026-08-01",
      timeZone: "UTC",
      status: "finalized",
      scheduledAt: new Date("2026-08-02T12:00:00Z"),
      finalizedAt: new Date("2026-08-02T12:01:00Z"),
    });
  });

  afterAll(async () => client.close());

  it("revokes the provider grant and atomically removes the account, sessions, and summaries", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      deleteAccount({
        userId: "delete-user",
        accessToken: "plain-provider-token",
        clientId: "github-client",
        clientSecret: "github-secret",
        fetchImplementation,
        now: new Date("2026-09-01T12:00:00Z"),
      }),
    ).resolves.toEqual({ deleted: true, providerRevoked: true });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.github.com/applications/github-client/grant",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ access_token: "plain-provider-token" }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(await database.query.user.findFirst()).toBeUndefined();
    expect(await database.query.account.findFirst()).toBeUndefined();
    expect(await database.query.session.findFirst()).toBeUndefined();
    expect(await database.query.journalSummary.findFirst()).toBeUndefined();
    expect(
      await database.query.journalSummaryGeneration.findFirst(),
    ).toBeUndefined();
    expect(await database.query.journalOnboarding.findFirst()).toBeUndefined();
    expect(await database.query.githubInstallation.findFirst()).toBeUndefined();
    expect(await database.query.githubActivity.findFirst()).toBeUndefined();
    expect(
      await database.query.journalFinalization.findFirst(),
    ).toBeUndefined();
  });

  it("finishes local deletion when GitHub revocation is unavailable", async () => {
    await database.insert(user).values({
      id: "offline-delete-user",
      name: "Grace Hopper",
      email: "offline-delete@example.com",
      emailVerified: true,
    });
    await database.insert(account).values({
      id: "offline-delete-account",
      issuer: "https://github.com",
      accountId: "8",
      providerId: "github",
      userId: "offline-delete-user",
      accessToken: "encrypted-provider-token",
      updatedAt: new Date(),
    });

    await expect(
      deleteAccount({
        userId: "offline-delete-user",
        accessToken: "plain-provider-token",
        clientId: "github-client",
        clientSecret: "github-secret",
        fetchImplementation: vi.fn().mockRejectedValue(new Error("offline")),
        now: new Date("2026-09-01T12:00:00Z"),
      }),
    ).resolves.toEqual({ deleted: true, providerRevoked: false });
    expect(
      await database.query.user.findFirst({
        where: (table, { eq }) => eq(table.id, "offline-delete-user"),
      }),
    ).toBeUndefined();
    expect(
      await database.query.account.findFirst({
        where: (table, { eq }) => eq(table.id, "offline-delete-account"),
      }),
    ).toBeUndefined();
  });
});
