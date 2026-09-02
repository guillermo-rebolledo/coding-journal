// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFinalizationScheduleRoute } from "@/app/api/cron/journal-finalization/handler";
import type { FinalizationStore } from "@/lib/journal-finalization";
import type { QueuePublisher } from "@/lib/queue";

const findDueCandidates = vi.fn<FinalizationStore["findDueCandidates"]>();
const schedule = vi.fn<FinalizationStore["schedule"]>();
const fail = vi.fn<FinalizationStore["fail"]>();
const publish = vi.fn<QueuePublisher["publish"]>();

// Only the scheduling path is reachable from this route; the remaining store
// members refuse rather than pretend, so an unexpected call fails the test.
const store: FinalizationStore = {
  findDueCandidates,
  schedule,
  fail,
  claim: () => Promise.reject(new Error("claim is not part of scheduling")),
  finalize: () =>
    Promise.reject(new Error("finalize is not part of scheduling")),
};

const GET = createFinalizationScheduleRoute({ store, queue: { publish } });

describe("journal finalization schedule endpoint", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "schedule-secret");
    findDueCandidates.mockReset().mockResolvedValue([
      {
        userId: "user-1",
        localDate: "2026-08-31",
        timeZone: "America/Mexico_City",
      },
    ]);
    schedule.mockReset().mockResolvedValue(true);
    fail.mockReset().mockResolvedValue(undefined);
    publish.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects an unauthenticated scheduler request", async () => {
    const response = await GET(
      new Request("https://journal.example/api/cron/journal-finalization"),
    );

    expect(response.status).toBe(401);
    expect(findDueCandidates).not.toHaveBeenCalled();
  });

  it("enqueues due journals for an authenticated scheduler request", async () => {
    const response = await GET(
      new Request("https://journal.example/api/cron/journal-finalization", {
        headers: { authorization: "Bearer schedule-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enqueued: 1 });
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
});
