// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const boundaries = vi.hoisted(() => ({
  process: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  activeCount: vi.fn(),
  tryEnter: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  readAll: vi.fn(),
}));

// `handleCallback` is the platform's wrapper; the test needs the handler and
// the retry policy the route hands it.
const registered = vi.hoisted(
  () =>
    ({}) as {
      handler?: (
        message: unknown,
        metadata: { deliveryCount: number },
      ) => Promise<void>;
      options?: {
        retry?: (error: unknown) => { afterSeconds: number } | undefined;
      };
    },
);

vi.mock("@vercel/queue", () => ({
  handleCallback: (
    handler: (
      message: unknown,
      metadata: { deliveryCount: number },
    ) => Promise<void>,
    options?: {
      retry?: (error: unknown) => { afterSeconds: number } | undefined;
    },
  ) => {
    registered.handler = handler;
    registered.options = options;
    return handler;
  },
}));

vi.mock("@/lib/journal-finalization", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/journal-finalization")
  >("@/lib/journal-finalization");
  return { ...actual, processJournalFinalization: boundaries.process };
});
vi.mock("@/lib/journal-finalization-repository", () => ({
  journalFinalizationRepository: {},
}));
vi.mock("@/lib/journal-summary-repository", () => ({
  journalSummaryRepository: {},
}));
vi.mock("@/lib/openai-summary", () => ({ openAiSummaryProvider: vi.fn() }));
vi.mock("@/lib/journal", () => ({ getJournalOnboarding: vi.fn() }));
vi.mock("@/lib/github-installation", () => ({
  getGitHubInstallations: vi.fn(),
}));
vi.mock("@/lib/github-user-token", () => ({
  getGitHubUserAccessTokenForJob: vi.fn(),
}));
vi.mock("@/lib/today-journal", () => ({ getTodayJournal: vi.fn() }));
vi.mock("@/lib/queue-lease-repository", () => ({
  queueLeaseRepository: {
    acquire: boundaries.acquire,
    release: boundaries.release,
    activeCount: boundaries.activeCount,
  },
}));
vi.mock("@/lib/service-circuit-repository", () => ({
  serviceCircuitRepository: {
    tryEnter: boundaries.tryEnter,
    recordSuccess: boundaries.recordSuccess,
    recordFailure: boundaries.recordFailure,
    readAll: boundaries.readAll,
  },
}));

import "@/app/api/queues/journal-finalization/route";
import { ProviderUnavailableError } from "@/lib/service-circuit";
import { QueueSaturatedError } from "@/lib/queue-lease";

const message = {
  version: 1,
  userId: "user-1",
  localDate: "2026-09-01",
  timeZone: "UTC",
};

function deliver() {
  if (!registered.handler) throw new Error("The route registered no handler");
  return registered.handler(message, { deliveryCount: 1 });
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
    const retry = registered.options?.retry;
    if (!retry) throw new Error("The route registered no retry policy");

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
