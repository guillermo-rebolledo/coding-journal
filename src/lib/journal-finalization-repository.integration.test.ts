// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/auth-schema";
import {
  githubAccessBlock,
  githubActivity,
  journalOnboarding,
  journalSummary,
  user,
} from "@/db/auth-schema";
import { githubAccessBlockScopeKey } from "@/lib/github-access-block";
import {
  computeActivityMetrics,
  type ActivityRecord,
} from "@/lib/github-activity";
import { createJournalFinalizationRepository } from "@/lib/journal-finalization-repository";

const initialActivity: ActivityRecord = {
  deduplicationKey: "github:issue:42:7",
  localDate: "2026-08-31",
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
  subjectTitle: "Original title",
  occurredAt: new Date("2026-08-31T15:00:00Z"),
  observedAt: new Date("2026-09-01T05:00:00Z"),
  authoredBeforeDay: false,
  installationId: "9",
};

describe("journal finalization repository with Postgres", () => {
  const client = new PGlite();
  const database = drizzle(client, { schema });
  // SAFETY: the repository is generic over the Neon HTTP driver's result type;
  // PGlite implements the same Drizzle query surface this repository uses, and
  // the two driver types do not otherwise overlap.
  const repository = createJournalFinalizationRepository(database as never);

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: "drizzle" });
    await database.insert(user).values({
      id: "history-user",
      name: "Ada Lovelace",
      email: "history@example.com",
      emailVerified: true,
    });
    await database.insert(journalOnboarding).values({
      userId: "history-user",
      timeZone: "America/Mexico_City",
      githubAccessMode: "app",
    });
  });

  afterAll(async () => client.close());

  it("keeps finalized evidence immutable and labels genuinely late activity as a correction", async () => {
    const candidate = {
      userId: "history-user",
      localDate: "2026-08-31",
      timeZone: "America/Mexico_City",
    };
    const finalizedAt = new Date("2026-09-01T12:00:00Z");
    const metrics = computeActivityMetrics([initialActivity]);

    await expect(repository.schedule(candidate, finalizedAt)).resolves.toBe(
      true,
    );
    await expect(repository.schedule(candidate, finalizedAt)).resolves.toBe(
      false,
    );
    await expect(
      repository.claim(candidate.userId, candidate.localDate, finalizedAt),
    ).resolves.toBe(true);
    await expect(
      repository.finalize({
        ...candidate,
        completeness: "complete",
        metrics,
        narrative: {
          overview: "Opened the journal history issue.",
          overviewEvidenceIds: ["evidence-1"],
          accomplishments: [],
          collaboration: [],
          inProgress: [],
        },
        snapshotHash: "snapshot-1",
        evidenceKeys: [initialActivity.deduplicationKey],
        evidence: [initialActivity],
        finalizedAt,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.finalize({
        ...candidate,
        completeness: "error",
        metrics: computeActivityMetrics([]),
        narrative: null,
        snapshotHash: "replacement-snapshot",
        evidenceKeys: [],
        evidence: [],
        finalizedAt: new Date("2026-09-01T13:00:00Z"),
      }),
    ).resolves.toBe(false);

    await database.insert(githubActivity).values([
      {
        id: "stored-initial",
        userId: candidate.userId,
        ...initialActivity,
        subjectTitle: "Changed after finalization",
      },
      {
        id: "stored-late",
        userId: candidate.userId,
        ...initialActivity,
        deduplicationKey: "github:issue-comment:42:7:99",
        kind: "issue-comment",
        subjectId: "99",
        subjectTitle: "Late review note",
        observedAt: new Date("2026-09-01T13:00:00Z"),
      },
    ]);

    const journal = await repository.read(
      candidate.userId,
      candidate.localDate,
    );
    expect(journal).toEqual(
      expect.objectContaining({
        status: "corrected",
        metrics,
        evidence: [expect.objectContaining({ subjectTitle: "Original title" })],
        corrections: [
          expect.objectContaining({ subjectTitle: "Late review note" }),
        ],
      }),
    );

    await expect(
      repository.redactNarrative(candidate.userId, candidate.localDate),
    ).resolves.toBe(true);
    await expect(
      repository.read(candidate.userId, candidate.localDate),
    ).resolves.toEqual(
      expect.objectContaining({
        narrative: null,
        metrics,
        status: "corrected",
      }),
    );
  });

  it("allows a recoverable failure to be explicitly retried", async () => {
    const candidate = {
      userId: "history-user",
      localDate: "2026-08-30",
      timeZone: "America/Mexico_City",
    };
    const now = new Date("2026-09-01T12:00:00Z");
    await repository.schedule(candidate, now);
    await repository.claim(candidate.userId, candidate.localDate, now);
    await repository.fail(
      candidate.userId,
      candidate.localDate,
      "summary-failed",
      true,
    );

    await expect(
      repository.read(candidate.userId, candidate.localDate),
    ).resolves.toEqual(
      expect.objectContaining({ status: "recoverable-error" }),
    );
    await expect(
      repository.retry(candidate.userId, candidate.localDate, now),
    ).resolves.toEqual(expect.objectContaining(candidate));
    await expect(
      repository.claim(candidate.userId, candidate.localDate, now),
    ).resolves.toBe(true);
  });

  it("redacts a finalization that commits after a private-access fence", async () => {
    const candidate = {
      userId: "history-user",
      localDate: "2026-08-29",
      timeZone: "America/Mexico_City",
    };
    const now = new Date("2026-09-01T14:00:00Z");
    await repository.schedule(candidate, now);
    await repository.claim(candidate.userId, candidate.localDate, now);
    await database.insert(githubAccessBlock).values({
      id: "history-access-block",
      userId: candidate.userId,
      scopeKey: githubAccessBlockScopeKey("repository", "42"),
      repositoryId: "42",
    });
    await database.insert(journalSummary).values({
      id: "racing-summary",
      userId: candidate.userId,
      localDate: candidate.localDate,
      snapshotHash: "racing-summary",
      model: "fixture",
      output: {
        overview: "Stale private summary",
        overviewEvidenceIds: ["evidence-1"],
        accomplishments: [],
        collaboration: [],
        inProgress: [],
      },
    });

    await repository.finalize({
      ...candidate,
      completeness: "complete",
      metrics: computeActivityMetrics([initialActivity]),
      narrative: {
        overview: "Stale private narrative",
        overviewEvidenceIds: ["evidence-1"],
        accomplishments: [],
        collaboration: [],
        inProgress: [],
      },
      snapshotHash: "racing-finalization",
      evidenceKeys: [initialActivity.deduplicationKey],
      evidence: [{ ...initialActivity, localDate: candidate.localDate }],
      finalizedAt: now,
    });

    await expect(
      repository.read(candidate.userId, candidate.localDate),
    ).resolves.toEqual(
      expect.objectContaining({
        narrative: expect.objectContaining({
          overview: "Details unavailable because GitHub access changed.",
        }),
        evidence: [
          expect.objectContaining({ repositoryName: "Unavailable repository" }),
        ],
      }),
    );
    await expect(
      database.query.journalSummary.findFirst({
        where: (table, { eq }) => eq(table.id, "racing-summary"),
      }),
    ).resolves.toBeUndefined();
  });
});
