// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/auth-schema";
import { createQueueLeaseRepository } from "@/lib/queue-lease-repository";
import type { QueueLease } from "@/lib/queue-lease";

const topic = "journal-finalization" as const;
const now = new Date("2026-09-01T12:00:00Z");
const ttlMs = 5 * 60 * 1000;

describe("queue concurrency with Postgres", () => {
  const client = new PGlite();
  const database = drizzle(client, { schema });
  const store = createQueueLeaseRepository(database);

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client.close();
  });

  it("hands out every slot once and then refuses", async () => {
    const limit = 3;

    const leases = await Promise.all(
      Array.from({ length: limit + 4 }, (_, index) =>
        store.acquire({
          topic,
          limit,
          holder: `holder-${index}`,
          now,
          ttlMs,
        }),
      ),
    );

    const held = leases.filter((lease): lease is QueueLease => lease !== null);
    expect(held).toHaveLength(limit);
    expect(new Set(held.map((lease) => lease.slot)).size).toBe(limit);
    expect(await store.activeCount(topic, now)).toBe(limit);
  });

  it("frees a slot when the consumer finishes", async () => {
    const limit = 3;
    const [firstSlot] = await database.query.serviceLease.findMany();
    if (!firstSlot) throw new Error("The fixture holds no lease");

    await store.release({
      id: firstSlot.id,
      topic,
      slot: firstSlot.slot,
      holder: firstSlot.holder,
      expiresAt: firstSlot.expiresAt,
    });

    const reacquired = await store.acquire({
      topic,
      limit,
      holder: "later-holder",
      now,
      ttlMs,
    });

    expect(reacquired).not.toBeNull();
    expect(await store.activeCount(topic, now)).toBe(limit);
  });

  it("does not release a slot another consumer now holds", async () => {
    const [lease] = await database.query.serviceLease.findMany();
    if (!lease) throw new Error("The fixture holds no lease");

    await store.release({
      id: lease.id,
      topic,
      slot: lease.slot,
      holder: "someone-else",
      expiresAt: lease.expiresAt,
    });

    expect(await store.activeCount(topic, now)).toBe(3);
  });

  it("reclaims a slot from an instance that died mid-message", async () => {
    const afterExpiry = new Date(now.getTime() + ttlMs + 1_000);

    const reclaimed = await store.acquire({
      topic,
      limit: 3,
      holder: "next-instance",
      now: afterExpiry,
      ttlMs,
    });

    expect(reclaimed).not.toBeNull();
    expect(await store.activeCount(topic, afterExpiry)).toBe(1);
  });

  it("bounds each topic independently", async () => {
    const other = await store.acquire({
      topic: "github-webhook-deliveries",
      limit: 1,
      holder: "webhook-holder",
      now,
      ttlMs,
    });

    expect(other).not.toBeNull();
    expect(await store.activeCount("github-webhook-deliveries", now)).toBe(1);
    await expect(
      store.acquire({
        topic: "github-webhook-deliveries",
        limit: 1,
        holder: "second-webhook-holder",
        now,
        ttlMs,
      }),
    ).resolves.toBeNull();
  });
});
