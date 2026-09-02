// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/auth-schema";
import { consumeRateLimit, rateLimitPolicies } from "@/lib/rate-limit";
import { createRateLimitRepository } from "@/lib/rate-limit-repository";

describe("request budgets with Postgres", () => {
  const client = new PGlite();
  const database = drizzle(client, { schema });
  const store = createRateLimitRepository(database);

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client.close();
  });

  it("holds the limit when a burst of requests arrives at once", async () => {
    const limit = rateLimitPolicies()["journal-refresh"].limit;
    const now = new Date("2026-09-01T12:00:00Z");
    const attempts = limit * 8;

    const decisions = await Promise.all(
      Array.from({ length: attempts }, () =>
        consumeRateLimit({
          store,
          policy: "journal-refresh",
          userId: "burst-user",
          now,
        }),
      ),
    );

    // Every request was counted exactly once, so exactly `limit` of them are
    // allowed no matter how they interleaved.
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(
      limit,
    );
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(
      attempts - limit,
    );
  });

  it("keeps one row per subject instead of one per window", async () => {
    const rows = await database.query.rateLimitCounter.findMany();

    expect(
      rows.filter((row) => row.scope === "journal-refresh" && row.count > 0),
    ).toHaveLength(1);
  });

  it("counts each user separately", async () => {
    const now = new Date("2026-09-01T12:00:00Z");

    const other = await consumeRateLimit({
      store,
      policy: "journal-refresh",
      userId: "quiet-user",
      now,
    });

    expect(other.allowed).toBe(true);
    expect(other.remaining).toBe(
      rateLimitPolicies()["journal-refresh"].limit - 1,
    );
  });

  it("rolls the window in place once it has expired", async () => {
    const windowMs = rateLimitPolicies()["journal-refresh"].windowMs;
    const later = new Date(
      new Date("2026-09-01T12:00:00Z").getTime() + windowMs + 1_000,
    );

    const decision = await consumeRateLimit({
      store,
      policy: "journal-refresh",
      userId: "burst-user",
      now: later,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.resetAt.getTime()).toBe(later.getTime() + windowMs);
  });

  it("counts a product budget once for every user together", async () => {
    const now = new Date("2026-09-02T00:00:00Z");

    const first = await consumeRateLimit({
      store,
      policy: "github-sync-daily",
      now,
    });
    const second = await consumeRateLimit({
      store,
      policy: "github-sync-daily",
      now,
    });

    expect(first.remaining).toBe(second.remaining + 1);
  });

  it("stores no user identifier a deleted account could be recovered from", async () => {
    const rows = await database.query.rateLimitCounter.findMany();

    expect(rows.map((row) => row.subject)).not.toContain("burst-user");
    for (const row of rows) {
      expect(row.subject).toMatch(/^(?:sub_[0-9a-f]{16}|global)$/);
    }
  });
});
