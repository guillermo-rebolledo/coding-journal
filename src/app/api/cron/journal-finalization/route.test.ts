// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const finalizationBoundary = vi.hoisted(() => ({ enqueue: vi.fn() }));
const repositoryBoundary = vi.hoisted(() => ({}));
const queueBoundary = vi.hoisted(() => ({}));

vi.mock("@/lib/journal-finalization", () => ({
  enqueueDueJournalFinalizations: finalizationBoundary.enqueue,
}));
vi.mock("@/lib/journal-finalization-repository", () => ({
  journalFinalizationRepository: repositoryBoundary,
}));
vi.mock("@/lib/queue", () => ({ queuePublisher: queueBoundary }));

import { GET } from "@/app/api/cron/journal-finalization/route";

describe("journal finalization schedule endpoint", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "schedule-secret");
    finalizationBoundary.enqueue.mockReset().mockResolvedValue(2);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects an unauthenticated scheduler request", async () => {
    const response = await GET(
      new Request("https://journal.example/api/cron/journal-finalization"),
    );

    expect(response.status).toBe(401);
    expect(finalizationBoundary.enqueue).not.toHaveBeenCalled();
  });

  it("enqueues due journals for an authenticated scheduler request", async () => {
    const response = await GET(
      new Request("https://journal.example/api/cron/journal-finalization", {
        headers: { authorization: "Bearer schedule-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enqueued: 2 });
    expect(finalizationBoundary.enqueue).toHaveBeenCalledWith(
      repositoryBoundary,
      queueBoundary,
      expect.any(Date),
    );
  });
});
