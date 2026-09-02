// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/auth-schema";
import type { CircuitConfiguration } from "@/lib/service-circuit";
import { createServiceCircuitRepository } from "@/lib/service-circuit-repository";

const configuration: CircuitConfiguration = {
  failureThreshold: 3,
  failureWindowMs: 5 * 60 * 1000,
  cooldownMs: 2 * 60 * 1000,
};

const opened = new Date("2026-09-01T12:00:00Z");

describe("provider circuits with Postgres", () => {
  const client = new PGlite();
  const database = drizzle(client, { schema });
  const store = createServiceCircuitRepository(database);

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client.close();
  });

  it("admits calls while the provider is healthy", async () => {
    await expect(
      store.tryEnter({ service: "github", now: opened, configuration }),
    ).resolves.toEqual({ allowed: true });
  });

  it("opens after the configured number of failures inside the window", async () => {
    for (let attempt = 0; attempt < configuration.failureThreshold; attempt++) {
      await store.recordFailure({
        service: "github",
        now: opened,
        configuration,
      });
    }

    const decision = await store.tryEnter({
      service: "github",
      now: opened,
      configuration,
    });

    expect(decision).toEqual({ allowed: false, retryAfterSeconds: 120 });
  });

  it("keeps refusing until the cooldown has passed", async () => {
    const midCooldown = new Date(opened.getTime() + 60 * 1000);

    await expect(
      store.tryEnter({ service: "github", now: midCooldown, configuration }),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("leaves the other provider alone", async () => {
    await expect(
      store.tryEnter({ service: "openai", now: opened, configuration }),
    ).resolves.toEqual({ allowed: true });
  });

  it("admits calls again once the cooldown has passed", async () => {
    const afterCooldown = new Date(
      opened.getTime() + configuration.cooldownMs + 1_000,
    );

    await expect(
      store.tryEnter({ service: "github", now: afterCooldown, configuration }),
    ).resolves.toEqual({ allowed: true });

    const [circuit] = await store.readAll();
    expect(circuit).toMatchObject({ state: "closed", failureCount: 0 });
  });

  it("forgets failures that fall outside the window", async () => {
    const first = new Date("2026-09-02T12:00:00Z");
    const muchLater = new Date(
      first.getTime() + configuration.failureWindowMs + 1,
    );

    await store.recordFailure({ service: "github", now: first, configuration });
    await store.recordFailure({ service: "github", now: first, configuration });
    await store.recordFailure({
      service: "github",
      now: muchLater,
      configuration,
    });

    await expect(
      store.tryEnter({ service: "github", now: muchLater, configuration }),
    ).resolves.toEqual({ allowed: true });
  });

  it("closes the circuit on the first success", async () => {
    const now = new Date("2026-09-03T12:00:00Z");
    for (let attempt = 0; attempt < configuration.failureThreshold; attempt++) {
      await store.recordFailure({ service: "openai", now, configuration });
    }
    await expect(
      store.tryEnter({ service: "openai", now, configuration }),
    ).resolves.toMatchObject({ allowed: false });

    await store.recordSuccess("openai", now);

    await expect(
      store.tryEnter({ service: "openai", now, configuration }),
    ).resolves.toEqual({ allowed: true });
  });
});
