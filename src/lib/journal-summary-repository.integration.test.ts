// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/auth-schema";
import { githubAccessBlock, user } from "@/db/auth-schema";
import { githubAccessBlockScopeKey } from "@/lib/github-access-block";
import type { ActivityRecord } from "@/lib/github-activity";
import { generateJournalSummary } from "@/lib/journal-summary";
import { createJournalSummaryRepository } from "@/lib/journal-summary-repository";

describe("journal summary application boundary with Postgres", () => {
  const client = new PGlite();
  const database = drizzle(client, { schema });
  // SAFETY: the repository is generic over the Neon HTTP driver's result type;
  // PGlite implements the same Drizzle query surface this repository uses, and
  // the two driver types do not otherwise overlap.
  const repository = createJournalSummaryRepository(database as never);
  const now = new Date("2026-09-01T16:00:00Z");
  const record: ActivityRecord = {
    deduplicationKey: "github:issue:42:7",
    localDate: "2026-09-01",
    kind: "issue-opened",
    actorId: "7",
    actorLogin: "ada",
    repositoryId: "42",
    repositoryName: "acme/journal",
    evidenceUrl: "https://github.com/acme/journal/issues/7",
    visibility: "private",
    source: "github-webhook",
    subjectId: "7",
    subjectNumber: 7,
    subjectTitle: "Safe summaries",
    occurredAt: new Date("2026-09-01T15:00:00Z"),
    observedAt: now,
    authoredBeforeDay: false,
    installationId: "9",
  };

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: "drizzle" });
    await database.insert(user).values({
      id: "summary-user",
      name: "Ada Lovelace",
      email: "summary@example.com",
      emailVerified: true,
    });
  });

  afterAll(async () => client.close());

  it("atomically allows only one provider request for concurrent unchanged snapshots", async () => {
    const provider = vi.fn().mockResolvedValue({
      output: {
        overview:
          "Opened the safe summaries issue. The work remains in progress.",
        overviewEvidenceIds: ["evidence-1"],
        accomplishments: [
          {
            repositoryId: "repo-1",
            summary: "Opened the safe summaries issue.",
            evidenceIds: ["evidence-1"],
          },
        ],
        collaboration: [],
        inProgress: [
          {
            summary: "Safe summaries remain in progress.",
            evidenceIds: ["evidence-1"],
          },
        ],
      },
    });
    const input = {
      userId: "summary-user",
      localDate: "2026-09-01",
      activities: [record],
      store: repository,
      provider,
      now,
    };

    const results = await Promise.all([
      generateJournalSummary(input),
      generateJournalSummary(input),
    ]);

    expect(provider).toHaveBeenCalledTimes(1);
    expect(
      results.filter((result) => result.status === "available"),
    ).toHaveLength(1);
    expect(results.filter((result) => result.status === "unavailable")).toEqual(
      [expect.objectContaining({ reason: "cooldown" })],
    );
  });

  it("removes only summaries whose evidence matches a private-access fence", async () => {
    await database.insert(githubAccessBlock).values({
      id: "summary-access-block",
      userId: "summary-user",
      scopeKey: githubAccessBlockScopeKey("repository", "42"),
      repositoryId: "42",
    });
    await repository.save(
      {
        id: "stale-summary",
        userId: "summary-user",
        localDate: "2026-09-02",
        snapshotHash: "stale-snapshot",
        model: "fixture",
        output: {
          overview: "Stale private content",
          overviewEvidenceIds: ["evidence-1"],
          accomplishments: [],
          collaboration: [],
          inProgress: [],
        },
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 0,
        createdAt: now,
      },
      [record],
    );
    await expect(
      database.query.journalSummary.findFirst({
        where: (table, { eq }) => eq(table.id, "stale-summary"),
      }),
    ).resolves.toBeUndefined();

    await repository.save(
      {
        id: "accessible-summary",
        userId: "summary-user",
        localDate: "2026-09-03",
        snapshotHash: "accessible-snapshot",
        model: "fixture",
        output: {
          overview: "Accessible public content",
          overviewEvidenceIds: ["evidence-1"],
          accomplishments: [],
          collaboration: [],
          inProgress: [],
        },
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 0,
        createdAt: now,
      },
      [
        {
          ...record,
          localDate: "2026-09-03",
          repositoryId: "43",
          visibility: "public",
        },
      ],
    );
    await expect(
      database.query.journalSummary.findFirst({
        where: (table, { eq }) => eq(table.id, "accessible-summary"),
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "accessible-summary" }));
  });
});
