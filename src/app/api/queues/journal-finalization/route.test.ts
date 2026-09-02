// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFinalizationConsumer } from "@/app/api/queues/journal-finalization/handler";
import type { JsonObject } from "@/lib/json-payload";
import { QueueSaturatedError, type QueueLeaseStore } from "@/lib/queue-lease";
import {
  ProviderUnavailableError,
  type CircuitStore,
} from "@/lib/service-circuit";

const boundaries = {
  process:
    vi.fn<
      (
        payload: JsonObject | null,
        deliveryCount: number,
        now: Date,
      ) => Promise<void>
    >(),
  acquire: vi.fn<QueueLeaseStore["acquire"]>(),
  release: vi.fn<QueueLeaseStore["release"]>(),
  activeCount: vi.fn<QueueLeaseStore["activeCount"]>(),
  tryEnter: vi.fn<CircuitStore["tryEnter"]>(),
  recordSuccess: vi.fn<CircuitStore["recordSuccess"]>(),
  recordFailure: vi.fn<CircuitStore["recordFailure"]>(),
  readAll: vi.fn<CircuitStore["readAll"]>(),
};

const consumer = createFinalizationConsumer({
  leases: {
    acquire: boundaries.acquire,
    release: boundaries.release,
    activeCount: boundaries.activeCount,
  },
  circuits: {
    tryEnter: boundaries.tryEnter,
    recordSuccess: boundaries.recordSuccess,
    recordFailure: boundaries.recordFailure,
    readAll: boundaries.readAll,
  },
  process: boundaries.process,
});

const message = {
  version: 1,
  userId: "user-1",
  localDate: "2026-09-01",
  timeZone: "UTC",
};

function deliver() {
  return consumer.handle(message, { deliveryCount: 1 });
}

describe("journal finalization consumer", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    boundaries.process.mockReset().mockResolvedValue(undefined);
    boundaries.acquire.mockReset().mockResolvedValue({
      id: "journal-finalization:1",
      topic: "journal-finalization",
      slot: 1,
      holder: "holder",
      expiresAt: new Date("2026-09-01T12:05:00Z"),
    });
    boundaries.release.mockReset().mockResolvedValue(undefined);
    boundaries.tryEnter.mockReset().mockResolvedValue({ allowed: true });
  });

  it("processes a delivery inside a concurrency slot and gives the slot back", async () => {
    await deliver();

    expect(boundaries.acquire).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "journal-finalization", limit: 5 }),
    );
    expect(boundaries.process).toHaveBeenCalledTimes(1);
    expect(boundaries.release).toHaveBeenCalledTimes(1);
  });

  it("stops before GitHub when the provider circuit is open", async () => {
    boundaries.tryEnter.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 120,
    });

    await expect(deliver()).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(boundaries.process).not.toHaveBeenCalled();
    expect(boundaries.release).toHaveBeenCalledTimes(1);
  });

  it("stops before the summary provider when only its circuit is open", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    boundaries.tryEnter.mockImplementation(
      async ({ service }: { service: string }) =>
        service === "openai"
          ? { allowed: false, retryAfterSeconds: 90 }
          : { allowed: true },
    );

    await expect(deliver()).rejects.toMatchObject({ service: "openai" });
    expect(boundaries.process).not.toHaveBeenCalled();
  });

  it("does no work at all when every slot is taken", async () => {
    boundaries.acquire.mockResolvedValue(null);

    await expect(deliver()).rejects.toBeInstanceOf(QueueSaturatedError);
    expect(boundaries.tryEnter).not.toHaveBeenCalled();
    expect(boundaries.process).not.toHaveBeenCalled();
    expect(boundaries.release).not.toHaveBeenCalled();
  });

  it("reschedules a refused delivery instead of failing the journal", () => {
    const retry = consumer.retry;

    expect(retry(new QueueSaturatedError("journal-finalization", 60))).toEqual({
      afterSeconds: 60,
    });
    expect(retry(new ProviderUnavailableError("github", 120))).toEqual({
      afterSeconds: 120,
    });
    // A genuine failure still propagates to the queue's own retry policy.
    expect(
      retry(new Error("Journal access mode is not configured")),
    ).toBeUndefined();
  });
});
