// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  enqueueDueJournalFinalizations,
  processJournalFinalization,
  type FinalizationStore,
  type FinalizationCandidate,
} from "@/lib/journal-finalization";
import { computeActivityMetrics } from "@/lib/github-activity";
import {
  reconcileGitHubActivity,
  type ReconciliationStore,
  type TodayJournal,
} from "@/lib/github-reconciliation";
import {
  generateJournalSummary,
  type SummaryStore,
} from "@/lib/journal-summary";

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

function finalizationWork(githubAvailable: boolean) {
  let stored: TodayJournal | null = null;
  const reconciliationStore: ReconciliationStore = {
    tryStart: vi.fn().mockResolvedValue(true),
    finish: vi.fn(async (_userId, journal, activities) => {
      stored = {
        ...journal,
        metrics: computeActivityMetrics(activities),
        activities,
      };
    }),
    read: vi.fn(async () => {
      if (!stored) throw new Error("Journal was not stored");
      return stored;
    }),
  };
  const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (!githubAvailable && url.endsWith("/user")) {
      return new Response(null, { status: 503 });
    }
    if (url.endsWith("/user")) {
      return Response.json({ id: 7, login: "ada" });
    }
    if (
      url.includes("/events?") ||
      url.includes("/gists?") ||
      url.includes("/gists/starred?")
    ) {
      return Response.json([]);
    }
    throw new Error(`Unexpected GitHub request: ${url}`);
  });
  const summaryStore: SummaryStore = {
    findBySnapshotHash: vi.fn().mockResolvedValue(null),
    getUsage: vi.fn().mockResolvedValue({
      userDaily: 0,
      globalDaily: 0,
      monthlyCostUsd: 0,
    }),
    save: vi.fn(),
  };
  const now = new Date("2026-09-01T12:00:00Z");

  return {
    reconcile: (candidate: FinalizationCandidate) =>
      reconcileGitHubActivity({
        ...candidate,
        accessMode: "best-effort",
        installationIds: [],
        accessToken: "github-token",
        now,
        fetchImplementation: fetchImplementation,
        store: reconciliationStore,
      }),
    summarize: (input: {
      userId: string;
      localDate: string;
      activities: TodayJournal["activities"];
    }) =>
      generateJournalSummary({
        ...input,
        store: summaryStore,
        provider: vi.fn(),
        now,
      }),
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

  it("freezes an empty day after real reconciliation and summary services succeed", async () => {
    const repository = store({ claim: vi.fn().mockResolvedValue(true) });
    const work = finalizationWork(true);
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
      work.reconcile,
      work.summarize,
      new Date("2026-09-01T12:00:00Z"),
    );

    expect(repository.finalize).toHaveBeenCalledWith({
      userId: "user-1",
      localDate: "2026-08-31",
      timeZone: "America/Mexico_City",
      completeness: "complete",
      metrics: computeActivityMetrics([]),
      narrative: null,
      snapshotHash: expect.any(String),
      evidenceKeys: [],
      evidence: [],
      finalizedAt: new Date("2026-09-01T12:00:00Z"),
    });
  });

  it("acknowledges a duplicate job without repeating final work", async () => {
    const repository = store({ claim: vi.fn().mockResolvedValue(false) });
    const work = finalizationWork(true);

    await processJournalFinalization(
      {
        version: 1,
        userId: "user-1",
        localDate: "2026-08-31",
        timeZone: "America/Mexico_City",
      },
      2,
      repository,
      work.reconcile,
      work.summarize,
    );

    expect(repository.finalize).not.toHaveBeenCalled();
  });

  it("stops retrying in a clear recoverable state after five attempts", async () => {
    const repository = store({ claim: vi.fn().mockResolvedValue(true) });
    const work = finalizationWork(false);

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
        work.reconcile,
        work.summarize,
      ),
    ).resolves.toBeUndefined();
    expect(repository.fail).toHaveBeenCalledWith(
      "user-1",
      "2026-08-31",
      "reconciliation-failed",
      true,
    );
  });

  it("rethrows transient work before the retry limit", async () => {
    const repository = store({ claim: vi.fn().mockResolvedValue(true) });
    const work = finalizationWork(false);

    await expect(
      processJournalFinalization(
        {
          version: 1,
          userId: "user-1",
          localDate: "2026-08-31",
          timeZone: "America/Mexico_City",
        },
        4,
        repository,
        work.reconcile,
        work.summarize,
      ),
    ).rejects.toThrow("Final reconciliation was unavailable");
    expect(repository.fail).toHaveBeenCalledWith(
      "user-1",
      "2026-08-31",
      "reconciliation-failed",
      false,
    );
  });
});
