// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/auth-schema";
import { user } from "@/db/auth-schema";
import { createGitHubActivityRepository } from "@/lib/github-activity-repository";
import type { ActivityRecord } from "@/lib/github-activity";
import { createJournalSummaryRepository } from "@/lib/journal-summary-repository";
import { createPrivacyMaintenance } from "@/lib/privacy-maintenance";

function activity(id: string, occurredAt: string): ActivityRecord {
  return {
    deduplicationKey: `github:issue-opened:42:${id}`,
    localDate: "2026-08-01",
    kind: "issue-opened",
    actorId: "7",
    actorLogin: "ada",
    repositoryId: "42",
    repositoryName: "acme/journal",
    evidenceUrl: `https://github.com/acme/journal/issues/${id}`,
    visibility: "public",
    source: "github-webhook",
    subjectId: id,
    subjectNumber: Number(id),
    subjectTitle: `Issue ${id}`,
    occurredAt: new Date(occurredAt),
    observedAt: new Date(occurredAt),
    authoredBeforeDay: false,
    installationId: "99",
  };
}

describe("privacy maintenance with Postgres", () => {
  const client = new PGlite();
  const database = drizzle(client, { schema });
  const activities = createGitHubActivityRepository(database);
  // SAFETY: the repository is generic over the Neon HTTP driver's result type;
  // PGlite implements the same Drizzle query surface this repository uses, and
  // the two driver types do not otherwise overlap.
  const summaries = createJournalSummaryRepository(database as never);
  const maintain = createPrivacyMaintenance(database);

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: "drizzle" });
    await database.insert(user).values({
      id: "retention-user",
      name: "Ada Lovelace",
      email: "retention@example.com",
      emailVerified: true,
    });
    await activities.tryStart(
      "retention-user",
      "2026-08-01",
      new Date("2026-09-01T12:00:00Z"),
      new Date("2026-09-01T11:45:00Z"),
      "UTC",
    );
    await activities.finish(
      "retention-user",
      {
        localDate: "2026-08-01",
        timeZone: "UTC",
        status: "complete",
        refreshedAt: new Date("2026-09-01T12:00:00Z"),
      },
      [
        activity("1", "2026-08-02T11:59:59Z"),
        activity("2", "2026-08-02T12:00:00Z"),
        activity("3", "2026-08-03T12:00:00Z"),
      ],
    );
    await summaries.save(
      {
        id: "retained-summary",
        userId: "retention-user",
        localDate: "2026-08-01",
        snapshotHash: "retained-snapshot",
        model: "fixture",
        output: {
          overview: "One issue was opened.",
          overviewEvidenceIds: ["evidence-1"],
          accomplishments: [],
          collaboration: [],
          inProgress: [],
        },
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 0,
        createdAt: new Date("2026-08-02T12:00:00Z"),
      },
      [],
    );
  });

  afterAll(async () => client.close());

  it("deletes only activity strictly older than 30 days in retry-safe bounded batches", async () => {
    const now = new Date("2026-09-01T12:00:00Z");

    await expect(maintain(now, 1)).resolves.toEqual({
      deletedActivities: 1,
      hasMore: true,
    });
    await expect(maintain(now, 1)).resolves.toEqual({
      deletedActivities: 0,
      hasMore: false,
    });

    await expect(
      activities.read("retention-user", "2026-08-01"),
    ).resolves.toEqual(
      expect.objectContaining({
        activities: [
          expect.objectContaining({ subjectId: "2" }),
          expect.objectContaining({ subjectId: "3" }),
        ],
      }),
    );
    await expect(
      summaries.findBySnapshotHash("retention-user", "retained-snapshot"),
    ).resolves.toEqual(expect.objectContaining({ id: "retained-summary" }));
  });

  it("converges safely when retention batches run concurrently", async () => {
    await activities.finish(
      "retention-user",
      {
        localDate: "2026-08-01",
        timeZone: "UTC",
        status: "complete",
        refreshedAt: new Date("2026-09-01T12:00:00Z"),
      },
      [
        activity("4", "2026-07-01T12:00:00Z"),
        activity("5", "2026-07-02T12:00:00Z"),
      ],
    );
    const now = new Date("2026-09-01T12:00:00Z");

    const concurrent = await Promise.all([maintain(now, 1), maintain(now, 1)]);
    const drained = await maintain(now, 10);

    expect(
      concurrent.reduce(
        (total, result) => total + result.deletedActivities,
        0,
      ) + drained.deletedActivities,
    ).toBe(2);
    await expect(
      activities.read("retention-user", "2026-08-01"),
    ).resolves.toEqual(
      expect.objectContaining({
        activities: [
          expect.objectContaining({ subjectId: "2" }),
          expect.objectContaining({ subjectId: "3" }),
        ],
      }),
    );
  });
});
