// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repositoryBoundary = vi.hoisted(() => ({
  findDueCandidates: vi.fn(),
  schedule: vi.fn(),
  fail: vi.fn(),
}));
const queueBoundary = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock("@/lib/journal-finalization-repository", () => ({
  journalFinalizationRepository: repositoryBoundary,
}));
vi.mock("@/lib/queue", () => ({ queuePublisher: queueBoundary }));

import { GET } from "@/app/api/cron/journal-finalization/route";

describe("journal finalization schedule endpoint", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "schedule-secret");
    repositoryBoundary.findDueCandidates.mockReset().mockResolvedValue([
      {
        userId: "user-1",
        localDate: "2026-08-31",
        timeZone: "America/Mexico_City",
      },
    ]);
    repositoryBoundary.schedule.mockReset().mockResolvedValue(true);
    repositoryBoundary.fail.mockReset().mockResolvedValue(undefined);
    queueBoundary.publish.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects an unauthenticated scheduler request", async () => {
    const response = await GET(
      new Request("https://journal.example/api/cron/journal-finalization"),
    );

    expect(response.status).toBe(401);
    expect(repositoryBoundary.findDueCandidates).not.toHaveBeenCalled();
  });

  it("enqueues due journals for an authenticated scheduler request", async () => {
    const response = await GET(
      new Request("https://journal.example/api/cron/journal-finalization", {
        headers: { authorization: "Bearer schedule-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enqueued: 1 });
    expect(queueBoundary.publish).toHaveBeenCalledWith(
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
});
