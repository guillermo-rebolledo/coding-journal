// @vitest-environment node

import { createHash } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/auth-schema";
import {
  account,
  githubInstallation,
  journalSummary,
  journalOnboarding,
  privacyOperation,
  user,
} from "@/db/auth-schema";
import { createGitHubActivityRepository } from "@/lib/github-activity-repository";
import {
  computeActivityMetrics,
  type ActivityRecord,
} from "@/lib/github-activity";
import { createJournalFinalizationRepository } from "@/lib/journal-finalization-repository";
import { createGitHubWebhookRepository } from "@/lib/github-webhook-repository";

const privateActivity: ActivityRecord = {
  deduplicationKey: "github:issue-opened:42:15",
  localDate: "2026-08-01",
  kind: "issue-opened",
  actorId: "7",
  actorLogin: "ada",
  repositoryId: "42",
  repositoryName: "acme/secret-roadmap",
  evidenceUrl: "https://github.com/acme/secret-roadmap/issues/15",
  visibility: "private",
  source: "github-webhook",
  subjectId: "15",
  subjectNumber: 15,
  subjectTitle: "Secret launch plan",
  occurredAt: new Date("2026-08-01T15:00:00Z"),
  observedAt: new Date("2026-08-01T15:01:00Z"),
  authoredBeforeDay: false,
  installationId: "99",
};

describe("GitHub privacy lifecycle with Postgres", () => {
  const client = new PGlite();
  const database = drizzle(client, { schema });
  const webhookRepository = createGitHubWebhookRepository(database);
  const activityRepository = createGitHubActivityRepository(database);
  // SAFETY: the repository is generic over the Neon HTTP driver's result type;
  // PGlite implements the same Drizzle query surface this repository uses, and
  // the two driver types do not otherwise overlap.
  const historyRepository = createJournalFinalizationRepository(
    database as never,
  );

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: "drizzle" });
    await database.insert(user).values({
      id: "privacy-user",
      name: "Ada Lovelace",
      email: "privacy@example.com",
      emailVerified: true,
    });
    await database.insert(journalOnboarding).values({
      userId: "privacy-user",
      timeZone: "America/Mexico_City",
      githubAccessMode: "app",
    });
    await database.insert(githubInstallation).values({
      id: "privacy-installation",
      userId: "privacy-user",
      installationId: "99",
      status: "active",
    });
    await activityRepository.tryStart(
      "privacy-user",
      "2026-08-01",
      new Date("2026-08-01T16:00:00Z"),
      new Date("2026-08-01T15:45:00Z"),
      "America/Mexico_City",
    );
    await activityRepository.finish(
      "privacy-user",
      {
        localDate: "2026-08-01",
        timeZone: "America/Mexico_City",
        status: "complete",
        refreshedAt: new Date("2026-08-01T16:00:00Z"),
      },
      [privateActivity],
    );
    const candidate = {
      userId: "privacy-user",
      localDate: "2026-08-01",
      timeZone: "America/Mexico_City",
    };
    await historyRepository.schedule(
      candidate,
      new Date("2026-08-02T12:00:00Z"),
    );
    await historyRepository.claim(
      candidate.userId,
      candidate.localDate,
      new Date("2026-08-02T12:00:00Z"),
    );
    await historyRepository.finalize({
      ...candidate,
      completeness: "complete",
      metrics: computeActivityMetrics([privateActivity]),
      narrative: {
        overview: "Worked on the secret launch plan.",
        overviewEvidenceIds: ["evidence-1"],
        accomplishments: [],
        collaboration: [],
        inProgress: [],
      },
      snapshotHash: "privacy-snapshot",
      evidenceKeys: [privateActivity.deduplicationKey],
      evidence: [privateActivity],
      finalizedAt: new Date("2026-08-02T12:01:00Z"),
    });
    await database.insert(journalSummary).values({
      id: "privacy-summary",
      userId: "privacy-user",
      localDate: "2026-08-01",
      snapshotHash: "privacy-summary-snapshot",
      model: "fixture",
      output: {
        overview: "Cached secret launch plan.",
        overviewEvidenceIds: ["evidence-1"],
        accomplishments: [],
        collaboration: [],
        inProgress: [],
      },
    });
  });

  afterAll(async () => client.close());

  it("removes inaccessible normalized activity and neutrally redacts immutable history idempotently", async () => {
    const change = {
      deliveryId: "privacy-delivery",
      kind: "installation-suspended" as const,
      installationId: "99",
      accountId: "84",
      repositoryIds: [],
      occurredAt: new Date("2026-09-01T12:00:00Z"),
    };

    await expect(webhookRepository.applyAccessChange(change)).resolves.toEqual({
      affectedUsers: 1,
      deletedActivities: 1,
      redactedJournals: 1,
    });
    await expect(webhookRepository.applyAccessChange(change)).resolves.toEqual({
      affectedUsers: 0,
      deletedActivities: 0,
      redactedJournals: 0,
    });

    await expect(
      activityRepository.read("privacy-user", "2026-08-01"),
    ).resolves.toEqual(expect.objectContaining({ activities: [] }));
    await expect(
      historyRepository.read("privacy-user", "2026-08-01"),
    ).resolves.toEqual(
      expect.objectContaining({
        metrics: expect.objectContaining({ issues: 1 }),
        narrative: expect.objectContaining({
          overview: "Details unavailable because GitHub access changed.",
        }),
        evidence: [
          expect.objectContaining({
            repositoryName: "Unavailable repository",
            subjectTitle: "Details unavailable because GitHub access changed.",
          }),
        ],
      }),
    );
    await expect(
      webhookRepository.findActiveInstallationUsers("99"),
    ).resolves.toEqual([]);
    await expect(
      database.query.journalSummary.findFirst({
        where: eq(journalSummary.id, "privacy-summary"),
      }),
    ).resolves.toBeUndefined();

    // Both durable ingestion paths may have resolved access immediately before
    // suspension. Their post-write fence must still converge to no private row.
    await webhookRepository.recordActivity("privacy-user", [privateActivity]);
    await activityRepository.finish(
      "privacy-user",
      {
        localDate: "2026-08-01",
        timeZone: "America/Mexico_City",
        status: "complete",
        refreshedAt: new Date("2026-09-01T12:01:00Z"),
      },
      [privateActivity],
    );
    await expect(
      activityRepository.read("privacy-user", "2026-08-01"),
    ).resolves.toEqual(expect.objectContaining({ activities: [] }));

    const operationHash = createHash("sha256")
      .update("github-access-change:privacy-delivery")
      .digest("hex");
    await database
      .update(privacyOperation)
      .set({ status: "failed", errorId: "opaque-error" })
      .where(eq(privacyOperation.operationHash, operationHash));
    await Promise.all([
      webhookRepository.applyAccessChange(change),
      webhookRepository.applyAccessChange(change),
    ]);
    await expect(
      database.query.privacyOperation.findFirst({
        where: eq(privacyOperation.operationHash, operationHash),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "complete",
        attemptCount: 2,
        errorId: null,
      }),
    );
  });

  it("removes only repositories removed from an otherwise active installation", async () => {
    await database.insert(user).values([
      {
        id: "repository-user",
        name: "Grace Hopper",
        email: "repository-privacy@example.com",
        emailVerified: true,
      },
      {
        id: "shared-installation-user",
        name: "Dorothy Vaughan",
        email: "shared-installation@example.com",
        emailVerified: true,
      },
    ]);
    await database.insert(account).values({
      id: "repository-account",
      issuer: "https://github.com",
      accountId: "8",
      providerId: "github",
      userId: "repository-user",
      updatedAt: new Date(),
    });
    await database.insert(journalOnboarding).values({
      userId: "repository-user",
      timeZone: "UTC",
      githubAccessMode: "app",
    });
    await database.insert(githubInstallation).values([
      {
        id: "repository-installation",
        userId: "repository-user",
        installationId: "100",
        status: "active",
      },
      {
        id: "shared-repository-installation",
        userId: "shared-installation-user",
        installationId: "100",
        status: "active",
      },
    ]);
    await database.insert(journalSummary).values({
      id: "unrelated-shared-summary",
      userId: "shared-installation-user",
      localDate: "2026-08-01",
      snapshotHash: "unrelated-shared-snapshot",
      model: "fixture",
      output: {
        overview: "Only accessible work.",
        overviewEvidenceIds: [],
        accomplishments: [],
        collaboration: [],
        inProgress: [],
      },
    });
    await activityRepository.tryStart(
      "repository-user",
      "2026-08-01",
      new Date("2026-08-01T16:00:00Z"),
      new Date("2026-08-01T15:45:00Z"),
      "UTC",
    );
    await activityRepository.finish(
      "repository-user",
      {
        localDate: "2026-08-01",
        timeZone: "UTC",
        status: "complete",
        refreshedAt: new Date("2026-08-01T16:00:00Z"),
      },
      [
        { ...privateActivity, installationId: "100" },
        {
          ...privateActivity,
          deduplicationKey: "github:issue-opened:43:16",
          repositoryId: "43",
          repositoryName: "acme/still-accessible",
          subjectId: "16",
          subjectNumber: 16,
          installationId: "100",
        },
      ],
    );

    await expect(
      webhookRepository.applyAccessChange({
        deliveryId: "repository-removed-delivery",
        kind: "repositories-removed",
        installationId: "100",
        accountId: "8",
        repositoryIds: ["42"],
        occurredAt: new Date("2026-09-01T12:00:00Z"),
      }),
    ).resolves.toEqual({
      affectedUsers: 2,
      deletedActivities: 1,
      redactedJournals: 0,
    });
    await expect(
      activityRepository.read("repository-user", "2026-08-01"),
    ).resolves.toEqual(
      expect.objectContaining({
        activities: [expect.objectContaining({ repositoryId: "43" })],
      }),
    );
    await expect(
      webhookRepository.findActiveInstallationUsers("100"),
    ).resolves.toHaveLength(1);
    await expect(
      database.query.journalSummary.findFirst({
        where: eq(journalSummary.id, "unrelated-shared-summary"),
      }),
    ).resolves.toEqual(
      expect.objectContaining({ id: "unrelated-shared-summary" }),
    );

    await webhookRepository.restoreAccess({
      kind: "repositories-added",
      installationId: "100",
      repositoryIds: ["42"],
    });
    await webhookRepository.recordActivity("repository-user", [
      { ...privateActivity, installationId: "100" },
    ]);
    await expect(
      activityRepository.read("repository-user", "2026-08-01"),
    ).resolves.toEqual(
      expect.objectContaining({
        activities: expect.arrayContaining([
          expect.objectContaining({ repositoryId: "42" }),
        ]),
      }),
    );
  });

  it("disconnects and removes private data when an installation is deleted", async () => {
    await database.insert(user).values({
      id: "deleted-installation-user",
      name: "Katherine Johnson",
      email: "deleted-installation@example.com",
      emailVerified: true,
    });
    await database.insert(account).values({
      id: "deleted-installation-account",
      issuer: "https://github.com",
      accountId: "10",
      providerId: "github",
      userId: "deleted-installation-user",
      updatedAt: new Date(),
    });
    await database.insert(journalOnboarding).values({
      userId: "deleted-installation-user",
      timeZone: "UTC",
      githubAccessMode: "app",
    });
    await database.insert(githubInstallation).values({
      id: "deleted-installation",
      userId: "deleted-installation-user",
      installationId: "102",
      status: "active",
    });
    await activityRepository.tryStart(
      "deleted-installation-user",
      "2026-08-01",
      new Date("2026-08-01T16:00:00Z"),
      new Date("2026-08-01T15:45:00Z"),
      "UTC",
    );
    await activityRepository.finish(
      "deleted-installation-user",
      {
        localDate: "2026-08-01",
        timeZone: "UTC",
        status: "complete",
        refreshedAt: new Date("2026-08-01T16:00:00Z"),
      },
      [{ ...privateActivity, installationId: "102" }],
    );

    await expect(
      webhookRepository.applyAccessChange({
        deliveryId: "installation-deleted-delivery",
        kind: "installation-removed",
        installationId: "102",
        accountId: "10",
        repositoryIds: [],
        occurredAt: new Date("2026-09-01T12:00:00Z"),
      }),
    ).resolves.toEqual({
      affectedUsers: 1,
      deletedActivities: 1,
      redactedJournals: 0,
    });
    await expect(
      activityRepository.read("deleted-installation-user", "2026-08-01"),
    ).resolves.toEqual(expect.objectContaining({ activities: [] }));
    await expect(
      webhookRepository.findActiveInstallationUsers("102"),
    ).resolves.toEqual([]);
  });

  it("invalidates local credentials and all private processing after authorization revocation", async () => {
    await database.insert(user).values({
      id: "authorization-user",
      name: "Margaret Hamilton",
      email: "authorization-privacy@example.com",
      emailVerified: true,
    });
    await database.insert(account).values({
      id: "authorization-account",
      issuer: "https://github.com",
      accountId: "9",
      providerId: "github",
      userId: "authorization-user",
      accessToken: "stored-token",
      refreshToken: "stored-refresh-token",
      updatedAt: new Date(),
    });
    await database.insert(journalOnboarding).values({
      userId: "authorization-user",
      timeZone: "UTC",
      githubAccessMode: "app",
    });
    await database.insert(githubInstallation).values({
      id: "authorization-installation",
      userId: "authorization-user",
      installationId: "101",
      status: "active",
    });
    await activityRepository.tryStart(
      "authorization-user",
      "2026-08-01",
      new Date("2026-08-01T16:00:00Z"),
      new Date("2026-08-01T15:45:00Z"),
      "UTC",
    );
    await activityRepository.finish(
      "authorization-user",
      {
        localDate: "2026-08-01",
        timeZone: "UTC",
        status: "complete",
        refreshedAt: new Date("2026-08-01T16:00:00Z"),
      },
      [{ ...privateActivity, installationId: null }],
    );

    await expect(
      webhookRepository.applyAccessChange({
        deliveryId: "authorization-revoked-delivery",
        kind: "authorization-revoked",
        installationId: null,
        accountId: "9",
        repositoryIds: [],
        occurredAt: new Date("2026-09-01T12:00:00Z"),
      }),
    ).resolves.toEqual({
      affectedUsers: 1,
      deletedActivities: 1,
      redactedJournals: 0,
    });
    await expect(
      activityRepository.read("authorization-user", "2026-08-01"),
    ).resolves.toEqual(expect.objectContaining({ activities: [] }));
    await expect(
      database.query.account.findFirst({
        where: (table, { eq }) => eq(table.id, "authorization-account"),
      }),
    ).resolves.toEqual(
      expect.objectContaining({ accessToken: null, refreshToken: null }),
    );
    await expect(
      webhookRepository.findActiveInstallationUsers("101"),
    ).resolves.toEqual([]);
  });
});
