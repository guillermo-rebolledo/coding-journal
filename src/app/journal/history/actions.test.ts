// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  runRedactHistoricalNarrative,
  runRetryHistoricalJournal,
  type HistoryActionDependencies,
} from "@/app/journal/history/history-actions";
import type { JournalFinalizationRepository } from "@/lib/journal-finalization-repository";
import type { QueuePublisher } from "@/lib/queue";
import type { RateLimitDecision } from "@/lib/rate-limit";
import type { JournalSession } from "@/lib/session";
import { journalSession } from "~test/session-fixture";

const boundaries = {
  getSession: vi.fn<(headers: Headers) => Promise<JournalSession | null>>(),
  retry: vi.fn<JournalFinalizationRepository["retry"]>(),
  redactNarrative: vi.fn<JournalFinalizationRepository["redactNarrative"]>(),
  publish: vi.fn<QueuePublisher["publish"]>(),
  fail: vi.fn<JournalFinalizationRepository["fail"]>(),
  spendBudget: vi.fn<HistoryActionDependencies["spendBudget"]>(),
};

function dependencies(): HistoryActionDependencies {
  return {
    requestHeaders: new Headers(),
    getSession: boundaries.getSession,
    spendBudget: boundaries.spendBudget,
    store: {
      retry: boundaries.retry,
      redactNarrative: boundaries.redactNarrative,
      fail: boundaries.fail,
    },
    queue: { publish: boundaries.publish },
    revalidatePath: () => {},
    redirect: (destination: string): never => {
      throw new Error(`NEXT_REDIRECT:${destination}`);
    },
  };
}

function retryHistoricalJournal(localDate: string) {
  return runRetryHistoricalJournal(localDate, dependencies());
}

function redactHistoricalNarrative(localDate: string) {
  return runRedactHistoricalNarrative(localDate, dependencies());
}

/** A refusal from the shared request budget, as the real one reports it. */
function refusal(policy: RateLimitDecision["policy"]): RateLimitDecision {
  return {
    allowed: false,
    policy,
    limit: 3,
    remaining: 0,
    resetAt: new Date(Date.now() + 30 * 60 * 1000),
    retryAfterSeconds: 1800,
  };
}

describe("journal history actions", () => {
  beforeEach(() => {
    boundaries.getSession
      .mockReset()
      .mockResolvedValue(journalSession("user-1"));
    boundaries.retry.mockReset().mockResolvedValue({
      userId: "user-1",
      localDate: "2026-08-30",
      timeZone: "UTC",
      attemptCount: 1,
    });
    boundaries.redactNarrative.mockReset().mockResolvedValue(true);
    boundaries.publish.mockReset().mockResolvedValue(undefined);
    boundaries.fail.mockReset();
    boundaries.spendBudget.mockReset().mockResolvedValue(null);
  });

  it("queues a retry and says the recorded day is still readable", async () => {
    await expect(retryHistoricalJournal("2026-08-30")).resolves.toEqual({
      status: "accepted",
      message:
        "Finalization queued. The recorded day stays readable while it runs.",
    });
    expect(boundaries.publish).toHaveBeenCalledTimes(1);
  });

  it("refuses a repeated retry without queueing more provider work", async () => {
    boundaries.spendBudget.mockResolvedValue(refusal("finalization-retry"));

    const result = await retryHistoricalJournal("2026-08-30");

    expect(result.status).toBe("limited");
    expect(result.message).toContain("Request limit reached.");
    expect(result.message).toContain(
      "The finalized record and its metrics stay readable",
    );
    expect(boundaries.retry).not.toHaveBeenCalled();
    expect(boundaries.publish).not.toHaveBeenCalled();
  });

  it("refuses a malformed date before authenticating", async () => {
    await expect(retryHistoricalJournal("yesterday")).resolves.toMatchObject({
      status: "idle",
    });
    expect(boundaries.getSession).not.toHaveBeenCalled();
  });

  it("redirects a signed-out request", async () => {
    boundaries.getSession.mockResolvedValue(null);

    await expect(retryHistoricalJournal("2026-08-30")).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?next=%2Fjournal%2Fhistory",
    );
  });

  it("reports a day that cannot be retried without implying it is lost", async () => {
    boundaries.retry.mockResolvedValue(null);

    await expect(retryHistoricalJournal("2026-08-30")).resolves.toMatchObject({
      status: "unavailable",
    });
  });

  it("redacts a narrative and states what survives", async () => {
    await expect(redactHistoricalNarrative("2026-08-30")).resolves.toEqual({
      status: "accepted",
      message:
        "Narrative removed. The day's recorded facts and metrics are unchanged.",
    });
    expect(boundaries.redactNarrative).toHaveBeenCalledWith(
      "user-1",
      "2026-08-30",
    );
  });

  it("refuses a redaction burst without touching the record", async () => {
    boundaries.spendBudget.mockResolvedValue(refusal("narrative-redaction"));

    const result = await redactHistoricalNarrative("2026-08-30");

    expect(result.status).toBe("limited");
    expect(boundaries.redactNarrative).not.toHaveBeenCalled();
  });
});
