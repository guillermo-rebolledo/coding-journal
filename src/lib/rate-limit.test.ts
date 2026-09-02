// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  consumeRateLimit,
  rateLimitMessage,
  rateLimitPolicies,
  rateLimitPolicyMessage,
  rateLimitSubject,
  type RateLimitCount,
  type RateLimitStore,
} from "@/lib/rate-limit";

function storeReturning(counts: RateLimitCount[]): RateLimitStore {
  const queue = [...counts];
  return {
    async increment() {
      const next = queue.shift();
      if (!next) throw new Error("The fixture ran out of counts");
      return next;
    },
  };
}

const now = new Date("2026-09-01T12:00:00Z");

describe("request budgets", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows a request up to the configured limit and refuses the one after it", async () => {
    const limit = rateLimitPolicies()["journal-refresh"].limit;
    const windowEndsAt = new Date("2026-09-01T12:10:00Z");
    const store = storeReturning([
      { count: limit, windowEndsAt },
      { count: limit + 1, windowEndsAt },
    ]);

    const last = await consumeRateLimit({
      store,
      policy: "journal-refresh",
      userId: "user-1",
      now,
    });
    const refused = await consumeRateLimit({
      store,
      policy: "journal-refresh",
      userId: "user-1",
      now,
    });

    expect(last.allowed).toBe(true);
    expect(last.remaining).toBe(0);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(600);
    expect(refused.resetAt).toEqual(windowEndsAt);
  });

  it("takes its limits from configuration so a deployment can tighten them", async () => {
    vi.stubEnv("RATE_LIMIT_JOURNAL_REFRESH", "2");

    expect(rateLimitPolicies()["journal-refresh"].limit).toBe(2);
  });

  it("ignores a configured limit that is not a positive integer", () => {
    vi.stubEnv("RATE_LIMIT_JOURNAL_REFRESH", "-3");

    expect(rateLimitPolicies()["journal-refresh"].limit).toBe(12);
  });

  it("counts a user policy by an opaque subject and a product policy globally", () => {
    const policies = rateLimitPolicies();
    const user = rateLimitSubject(policies["journal-refresh"], "user-1");

    expect(user).toMatch(/^sub_[0-9a-f]{16}$/);
    expect(user).not.toContain("user-1");
    expect(rateLimitSubject(policies["github-sync-daily"], "user-1")).toBe(
      "global",
    );
  });

  it("says what happened, what still works, and when it returns", () => {
    const message = rateLimitMessage(
      {
        allowed: false,
        policy: "journal-refresh",
        limit: 12,
        remaining: 0,
        resetAt: new Date("2026-09-01T12:07:00Z"),
        retryAfterSeconds: 420,
      },
      now,
    );

    expect(message).toBe(
      "Request limit reached. Everything already recorded stays on screen. Try again in about 7 minutes.",
    );
  });

  it("says the same thing for a boundary that only knows the policy", () => {
    expect(rateLimitPolicyMessage("account-deletion")).toBe(
      "Request limit reached. Settings and the journal stay available. Try again in up to an hour.",
    );
  });
});
