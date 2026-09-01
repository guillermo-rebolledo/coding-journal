// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/auth-schema";
import { githubInstallation, journalOnboarding, user } from "@/db/auth-schema";
import { createGitHubInstallationRepository } from "@/lib/github-installation-repository";

describe("GitHub installation repository with Postgres", () => {
  const client = new PGlite();
  const testDatabase = drizzle(client, { schema });
  const repository = createGitHubInstallationRepository(testDatabase);

  beforeAll(async () => {
    await migrate(testDatabase, { migrationsFolder: "drizzle" });
    await testDatabase.insert(user).values({
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      emailVerified: true,
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it("atomically consumes a valid, user-bound state only once", async () => {
    await repository.insertInstallationState({
      id: "state-1",
      userId: "user-1",
      tokenHash: "token-hash",
      returnTo: "/settings",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    await expect(
      repository.consumeInstallationState(
        "another-user",
        "token-hash",
        new Date("2029-01-01T00:00:00.000Z"),
      ),
    ).resolves.toBeNull();
    await expect(
      repository.consumeInstallationState(
        "user-1",
        "token-hash",
        new Date("2029-01-01T00:00:00.000Z"),
      ),
    ).resolves.toEqual({ returnTo: "/settings" });
    await expect(
      repository.consumeInstallationState(
        "user-1",
        "token-hash",
        new Date("2029-01-01T00:00:00.000Z"),
      ),
    ).resolves.toBeNull();
  });

  it("persists pending, active, partial, and disconnected transitions", async () => {
    await repository.insertPendingInstallation("user-1", "org-1");
    await repository.insertPendingInstallation("user-1", "org-2");
    await repository.deletePendingInstallation("user-1", "org-1");
    await repository.upsertActiveInstallation("user-1", {
      installationId: "installation-1",
      accountId: "org-1",
      accountLogin: "analytical-engines",
      accountType: "Organization",
      repositorySelection: "selected",
      repositoryCount: 3,
      permissions: { contents: "read", metadata: "read" },
    });
    await repository.setGitHubAccessMode("user-1");

    expect(await repository.findInstallations("user-1")).toEqual([
      expect.objectContaining({ accountId: "org-2", status: "pending" }),
      expect.objectContaining({
        installationId: "installation-1",
        accountId: "org-1",
        repositorySelection: "selected",
        repositoryCount: 3,
        status: "active",
      }),
    ]);
    await expect(
      testDatabase.query.journalOnboarding.findFirst({
        where: eq(journalOnboarding.userId, "user-1"),
      }),
    ).resolves.toEqual(expect.objectContaining({ githubAccessMode: "app" }));

    await repository.markInstallationDisconnected("user-1", "installation-1");
    await expect(
      testDatabase.query.githubInstallation.findFirst({
        where: eq(githubInstallation.installationId, "installation-1"),
      }),
    ).resolves.toEqual(expect.objectContaining({ status: "disconnected" }));
  });
});
