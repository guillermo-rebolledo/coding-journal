// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/auth-schema";
import { user } from "@/db/auth-schema";
import type { ActivityRecord } from "@/lib/github-activity";
import { generateJournalSummary } from "@/lib/journal-summary";
import { createJournalSummaryRepository } from "@/lib/journal-summary-repository";

describe("journal summary application boundary with Postgres", () => {
  const client = new PGlite();
  const database = drizzle(client, { schema });
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
});
