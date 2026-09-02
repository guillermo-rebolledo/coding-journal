// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const boundaries = vi.hoisted(() => ({
  getSession: vi.fn(),
  retry: vi.fn(),
  redactNarrative: vi.fn(),
  publish: vi.fn(),
  fail: vi.fn(),
  increment: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getJournalSession: boundaries.getSession }));
vi.mock("@/lib/journal-finalization-repository", () => ({
  journalFinalizationRepository: {
    retry: boundaries.retry,
    redactNarrative: boundaries.redactNarrative,
    fail: boundaries.fail,
  },
}));
vi.mock("@/lib/queue", () => ({
  queuePublisher: { publish: boundaries.publish },
}));
vi.mock("@/lib/rate-limit-repository", () => ({
  rateLimitRepository: {
    increment: boundaries.increment,
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import {
  redactHistoricalNarrative,
  retryHistoricalJournal,
} from "@/app/journal/history/actions";

describe("journal history actions", () => {
  beforeEach(() => {
    boundaries.getSession
      .mockReset()
      .mockResolvedValue({ user: { id: "user-1" } });
    boundaries.retry
      .mockReset()
      .mockResolvedValue({ timeZone: "UTC", attemptCount: 1 });
    boundaries.redactNarrative.mockReset().mockResolvedValue(undefined);
    boundaries.publish.mockReset().mockResolvedValue(undefined);
    boundaries.fail.mockReset();
    boundaries.increment
      .mockReset()
      .mockImplementation(
        async ({ now, windowMs }: { now: Date; windowMs: number }) => ({
          count: 1,
          windowEndsAt: new Date(now.getTime() + windowMs),
        }),
      );
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
    boundaries.increment.mockResolvedValue({
      count: 99,
      windowEndsAt: new Date(Date.now() + 30 * 60 * 1000),
    });

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
    boundaries.increment.mockResolvedValue({
      count: 99,
      windowEndsAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const result = await redactHistoricalNarrative("2026-08-30");

    expect(result.status).toBe("limited");
    expect(boundaries.redactNarrative).not.toHaveBeenCalled();
  });
});
