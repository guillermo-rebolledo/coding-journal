// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/auth-schema";
import { user } from "@/db/auth-schema";
import { createGitHubActivityRepository } from "@/lib/github-activity-repository";
import type { ActivityRecord } from "@/lib/github-reconciliation";

describe("GitHub activity repository with Postgres", () => {
  const client = new PGlite();
  const testDatabase = drizzle(client, { schema });
  const repository = createGitHubActivityRepository(testDatabase);

  beforeAll(async () => {
    await migrate(testDatabase, { migrationsFolder: "drizzle" });
    await testDatabase.insert(user).values({
      id: "activity-user",
      name: "Ada Lovelace",
      email: "activity@example.com",
      emailVerified: true,
    });
  });

  afterAll(async () => client.close());

  it("claims a cooldown window and keeps retries idempotent", async () => {
    const firstAttempt = new Date("2026-03-08T18:00:00Z");
    const record: ActivityRecord = {
      deduplicationKey: "github:push:event-1",
      localDate: "2026-03-08",
      kind: "push",
      actorId: "7",
      actorLogin: "ada",
      repositoryId: "42",
      repositoryName: "acme/private-engine",
      evidenceUrl:
        "https://github.com/acme/private-engine/compare/1111111...2222222",
      visibility: "private",
      source: "github-events",
      subjectId: "event-1",
      occurredAt: new Date("2026-03-08T15:00:00Z"),
      observedAt: firstAttempt,
      authoredBeforeDay: false,
      installationId: "99",
    };

    await expect(
      repository.tryStart(
        "activity-user",
        "2026-03-08",
        firstAttempt,
        new Date("2026-03-08T17:45:00Z"),
        "America/New_York",
      ),
    ).resolves.toBe(true);
    await repository.finish(
      "activity-user",
      {
        localDate: "2026-03-08",
        timeZone: "America/New_York",
        status: "complete",
        refreshedAt: firstAttempt,
      },
      [record, record],
    );

    await expect(
      repository.tryStart(
        "activity-user",
        "2026-03-08",
        new Date("2026-03-08T18:01:00Z"),
        new Date("2026-03-08T17:46:00Z"),
        "America/New_York",
      ),
    ).resolves.toBe(false);
    expect(await repository.read("activity-user", "2026-03-08")).toEqual(
      expect.objectContaining({
        status: "complete",
        metrics: { pushes: 1, commits: 0 },
        activities: [
          expect.objectContaining({
            deduplicationKey: record.deduplicationKey,
          }),
        ],
      }),
    );
  });
});
