// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/auth-schema";
import {
  githubWebhookDelivery,
  journalFinalization,
  journalReconciliation,
  privacyOperation,
  serviceCircuit,
  serviceLease,
  user,
} from "@/db/auth-schema";
import { createServiceHealthReport } from "@/lib/service-health";

const now = new Date("2026-09-01T12:00:00Z");
const recently = new Date("2026-09-01T11:00:00Z");

describe("the operational view", () => {
  const client = new PGlite();
  const database = drizzle(client, { schema });
  const report = createServiceHealthReport(database);

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: "drizzle" });
    await database.insert(user).values({
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      emailVerified: true,
    });
    await database.insert(journalReconciliation).values([
      {
        id: "reconciliation-1",
        userId: "user-1",
        localDate: "2026-09-01",
        timeZone: "UTC",
        status: "complete",
        lastAttemptAt: recently,
        updatedAt: recently,
      },
      {
        id: "reconciliation-2",
        userId: "user-1",
        localDate: "2026-08-31",
        timeZone: "UTC",
        status: "error",
        lastAttemptAt: recently,
        updatedAt: recently,
      },
    ]);
    await database.insert(githubWebhookDelivery).values([
      {
        id: "delivery-1",
        deliveryId: "a1",
        eventType: "push",
        status: "processed",
        receivedAt: recently,
      },
      {
        id: "delivery-2",
        deliveryId: "a2",
        eventType: "push",
        status: "poisoned",
        receivedAt: recently,
      },
    ]);
    await database.insert(serviceLease).values({
      id: "journal-finalization:1",
      topic: "journal-finalization",
      slot: 1,
      holder: "holder",
      acquiredAt: recently,
      expiresAt: new Date("2026-09-01T12:05:00Z"),
    });
    await database.insert(serviceCircuit).values({
      service: "openai",
      state: "open",
      failureCount: 5,
      windowStartedAt: recently,
      openedAt: recently,
      retryAt: new Date("2026-09-01T12:02:00Z"),
      updatedAt: recently,
    });
    await database.insert(journalFinalization).values({
      id: "finalization-1",
      userId: "user-1",
      localDate: "2026-08-31",
      timeZone: "UTC",
      status: "recoverable-error",
      lastFailure: "summary-failed",
      attemptCount: 2,
      scheduledAt: recently,
    });
    await database.insert(privacyOperation).values({
      id: "privacy-1",
      operationHash: "hash-1",
      kind: "retention",
      status: "failed",
      startedAt: recently,
      updatedAt: recently,
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it("names every failing surface without Sentry", async () => {
    const health = await report(now);

    expect(health.sync).toMatchObject({ complete: 1, error: 1 });
    expect(health.queue.webhookDeliveries).toMatchObject({
      processed: 1,
      poisoned: 1,
    });
    expect(health.queue.activeSlots["journal-finalization"]).toEqual({
      active: 1,
      limit: 5,
    });
    expect(health.provider.circuits).toEqual([
      expect.objectContaining({ service: "openai", state: "open" }),
    ]);
    expect(health.finalization.byStatus).toMatchObject({
      "recoverable-error": 1,
    });
    expect(health.finalization.recoverableErrors).toBe(1);
    expect(health.privacy.failedOperations).toBe(1);
    expect(health.budget.githubSyncDaily.limit).toBeGreaterThan(0);
  });

  it("reports counts only, with nothing about anyone's journal in it", async () => {
    const serialized = JSON.stringify(await report(now));

    expect(serialized).not.toContain("user-1");
    expect(serialized).not.toContain("ada@example.com");
    expect(serialized).not.toContain("2026-08-31");
    expect(serialized).not.toContain("a1");
  });
});
