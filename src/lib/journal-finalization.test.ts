// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  enqueueDueJournalFinalizations,
  processJournalFinalization,
  type FinalizationStore,
} from "@/lib/journal-finalization";
import {
  computeActivityMetrics,
  type ActivityRecord,
} from "@/lib/github-activity";

const activity: ActivityRecord = {
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
  subjectTitle: "Journal history",
  occurredAt: new Date("2026-08-31T15:00:00Z"),
  observedAt: new Date("2026-09-01T05:00:00Z"),
  authoredBeforeDay: false,
  installationId: "9",
};

function store(overrides: Partial<FinalizationStore> = {}): FinalizationStore {
  return {
    findDueCandidates: vi.fn().mockResolvedValue([]),
    schedule: vi.fn().mockResolvedValue(false),
    claim: vi.fn().mockResolvedValue(false),
    finalize: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("journal finalization application boundary", () => {
  it("enqueues a due day once with a stable idempotency key", async () => {
    const repository = store({
      findDueCandidates: vi.fn().mockResolvedValue([
        {
          userId: "user-1",
          localDate: "2026-08-31",
          timeZone: "America/Mexico_City",
        },
      ]),
      schedule: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    });
    const publish = vi.fn().mockResolvedValue(undefined);

    await enqueueDueJournalFinalizations(
      repository,
      { publish },
      new Date("2026-09-01T12:00:00Z"),
    );
    await enqueueDueJournalFinalizations(
      repository,
      { publish },
      new Date("2026-09-01T12:05:00Z"),
    );

    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      "journal-finalization",
      {
        version: 1,
        userId: "user-1",
        localDate: "2026-08-31",
        timeZone: "America/Mexico_City",
      },
      "journal-finalization:user-1:2026-08-31",
    );
  });

  it("freezes metrics, narrative, and evidence after successful work", async () => {
    const repository = store({ claim: vi.fn().mockResolvedValue(true) });
    const reconcile = vi.fn().mockResolvedValue({
      localDate: "2026-08-31",
      timeZone: "America/Mexico_City",
      status: "complete",
      refreshedAt: new Date("2026-09-01T12:00:00Z"),
      metrics: computeActivityMetrics([activity]),
      activities: [activity],
    });
    const narrative = {
      overview: "Opened the journal history issue.",
      overviewEvidenceIds: ["evidence-1"],
      accomplishments: [],
      collaboration: [],
      inProgress: [],
    };
    const summarize = vi.fn().mockResolvedValue({
      status: "available",
      summary: { output: narrative, snapshotHash: "snapshot-1" },
    });
    const message = {
      version: 1 as const,
      userId: "user-1",
      localDate: "2026-08-31",
      timeZone: "America/Mexico_City",
    };

    await processJournalFinalization(
      message,
      1,
      repository,
      reconcile,
      summarize,
      new Date("2026-09-01T12:00:00Z"),
    );

    expect(repository.finalize).toHaveBeenCalledWith({
      userId: "user-1",
      localDate: "2026-08-31",
      timeZone: "America/Mexico_City",
      completeness: "complete",
      metrics: computeActivityMetrics([activity]),
      narrative,
      snapshotHash: "snapshot-1",
      evidenceKeys: [activity.deduplicationKey],
      evidence: [activity],
      finalizedAt: new Date("2026-09-01T12:00:00Z"),
    });
  });

  it("acknowledges a duplicate job without repeating final work", async () => {
    const repository = store({ claim: vi.fn().mockResolvedValue(false) });
    const reconcile = vi.fn();
    const summarize = vi.fn();

    await processJournalFinalization(
      {
        version: 1,
        userId: "user-1",
        localDate: "2026-08-31",
        timeZone: "America/Mexico_City",
      },
      2,
      repository,
      reconcile,
      summarize,
    );

    expect(reconcile).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
    expect(repository.finalize).not.toHaveBeenCalled();
  });

  it("stops retrying in a clear recoverable state after five attempts", async () => {
    const repository = store({ claim: vi.fn().mockResolvedValue(true) });
    const reconcile = vi
      .fn()
      .mockRejectedValue(new Error("GitHub unavailable"));

    await expect(
      processJournalFinalization(
        {
          version: 1,
          userId: "user-1",
          localDate: "2026-08-31",
          timeZone: "America/Mexico_City",
        },
        5,
        repository,
        reconcile,
        vi.fn(),
      ),
    ).resolves.toBeUndefined();
    expect(repository.fail).toHaveBeenCalledWith(
      "user-1",
      "2026-08-31",
      "reconciliation-failed",
      true,
    );
  });
});
