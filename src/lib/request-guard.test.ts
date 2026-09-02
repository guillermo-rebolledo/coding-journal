import { describe, expect, it, vi } from "vitest";

import { guardAction, guardTelemetryEvent } from "@/lib/request-guard";

describe("guarded actions", () => {
  it.each([
    ["journal-refresh", "journal-refresh-limited"],
    ["github-sync-daily", "github-sync-budget-exhausted"],
    ["finalization-retry", "finalization-retry-limited"],
    ["narrative-redaction", "narrative-redaction-limited"],
    ["account-deletion", "account-deletion-limited"],
  ] as const)(
    "keeps the %s telemetry event byte-identical",
    (policy, event) => {
      expect(guardTelemetryEvent(policy)).toBe(event);
    },
  );

  it("returns one refusal carrying prose and resume time", async () => {
    const resetAt = new Date("2026-09-02T12:15:00.000Z");
    const result = await guardAction({
      policy: "journal-refresh",
      userId: "user-1",
      now: new Date("2026-09-02T12:00:00.000Z"),
      rateStore: {
        increment: vi
          .fn()
          .mockResolvedValue({ count: 13, windowEndsAt: resetAt }),
      },
    });

    expect(result).toEqual({
      proceed: false,
      refusal: {
        outcome: "limited",
        message:
          "Request limit reached. Everything already recorded stays on screen. Try again in about 15 minutes.",
        resumeAt: resetAt,
      },
    });
  });
});
