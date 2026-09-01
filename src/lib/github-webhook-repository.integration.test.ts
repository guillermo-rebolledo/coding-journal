// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/auth-schema";
import {
  account,
  githubInstallation,
  journalOnboarding,
  user,
} from "@/db/auth-schema";
import { createGitHubActivityRepository } from "@/lib/github-activity-repository";
import { reconcileGitHubActivity } from "@/lib/github-reconciliation";
import { processPushDeliveryMessage } from "@/lib/github-webhook-processing";
import { createGitHubWebhookRepository } from "@/lib/github-webhook-repository";

describe("GitHub webhook repository with Postgres", () => {
  const client = new PGlite();
  const testDatabase = drizzle(client, { schema });
  const repository = createGitHubWebhookRepository(testDatabase);
  const activityRepository = createGitHubActivityRepository(testDatabase);
  const receivedAt = new Date("2026-03-08T15:00:05Z");

  beforeAll(async () => {
    await migrate(testDatabase, { migrationsFolder: "drizzle" });
    await testDatabase.insert(user).values([
      {
        id: "webhook-user",
        name: "Ada Lovelace",
        email: "webhook@example.com",
        emailVerified: true,
      },
      {
        id: "detached-user",
        name: "Grace Hopper",
        email: "detached@example.com",
        emailVerified: true,
      },
    ]);
    await testDatabase.insert(account).values({
      id: "account-1",
      issuer: "https://github.com",
      accountId: "7",
      providerId: "github",
      userId: "webhook-user",
      updatedAt: new Date(),
    });
    await testDatabase.insert(journalOnboarding).values({
      userId: "webhook-user",
      timeZone: "America/New_York",
      githubAccessMode: "app",
    });
    await testDatabase.insert(githubInstallation).values([
      {
        id: "installation-1",
        userId: "webhook-user",
        installationId: "99",
        status: "active",
      },
      {
        id: "installation-2",
        userId: "detached-user",
        installationId: "99",
        status: "disconnected",
      },
    ]);
  });

  afterAll(async () => client.close());

  it("claims each delivery id once and allows retry only after enqueue failure", async () => {
    const receipt = {
      deliveryId: "delivery-claim",
      eventType: "push",
      installationId: "99",
      status: "received" as const,
      receivedAt,
    };

    await expect(repository.claimDelivery(receipt)).resolves.toBe("claimed");
    await expect(repository.claimDelivery(receipt)).resolves.toBe("duplicate");

    await repository.markDeliveryEnqueueFailed("delivery-claim", "error-1");
    await expect(repository.claimDelivery(receipt)).resolves.toBe("claimed");

    await repository.markDeliveryEnqueued("delivery-claim");
    await expect(repository.claimDelivery(receipt)).resolves.toBe("duplicate");
  });

  it("resolves an installation to onboarded users with a linked GitHub account", async () => {
    await expect(repository.findActiveInstallationUsers("99")).resolves.toEqual(
      [
        {
          userId: "webhook-user",
          timeZone: "America/New_York",
          githubAccountId: "7",
        },
      ],
    );
    await expect(
      repository.findActiveInstallationUsers("404"),
    ).resolves.toEqual([]);
  });

  it("keeps one canonical record when reconciliation and the webhook overlap", async () => {
    const now = new Date("2026-03-08T18:00:00Z");
    const jsonResponse = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    const fetchFixture = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/user")) return jsonResponse({ id: 7, login: "ada" });
      if (url.includes("/users/ada/events")) {
        return jsonResponse([
          {
            id: "event-900",
            type: "PushEvent",
            actor: { id: 7, login: "ada" },
            repo: { id: 42, name: "acme/private-engine" },
            public: false,
            created_at: "2026-03-08T15:00:00Z",
            payload: {
              push_id: 900,
              before: "1111111",
              head: "2222222",
              ref: "refs/heads/main",
              size: 1,
              commits: [{ sha: "2222222" }],
            },
          },
        ]);
      }
      if (
        url.includes("/repos/acme/private-engine/compare/1111111...2222222")
      ) {
        return jsonResponse({
          total_commits: 1,
          commits: [
            {
              sha: "2222222",
              author: { id: 7, login: "ada" },
              commit: { author: { date: "2026-03-08T14:30:00Z" } },
            },
          ],
        });
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    });

    // The webhook consumer lands the push first, then reconciliation observes
    // the same push through the events API.
    await processPushDeliveryMessage(
      {
        version: 1,
        deliveryId: "delivery-overlap",
        installationId: "99",
        receivedAt: receivedAt.toISOString(),
        push: {
          repositoryId: "42",
          repositoryName: "acme/private-engine",
          private: true,
          before: "1111111",
          head: "2222222",
          pushedAt: "2026-03-08T15:00:00.000Z",
          senderId: "7",
          senderLogin: "ada",
          commits: [
            {
              sha: "2222222",
              authoredAt: "2026-03-08T14:30:00.000Z",
              authorLogin: "ada",
            },
          ],
        },
      },
      { deliveryCount: 1 },
      repository,
    );
    const journal = await reconcileGitHubActivity({
      userId: "webhook-user",
      timeZone: "America/New_York",
      accessMode: "best-effort",
      installationIds: [],
      accessToken: "fixture-token",
      now,
      fetchImplementation: fetchFixture as typeof fetch,
      store: activityRepository,
    });

    expect(journal.metrics).toEqual({ pushes: 1, commits: 1 });
    expect(journal.activities).toEqual([
      expect.objectContaining({
        deduplicationKey: "github:commit:42:2222222",
        source: "github-webhook",
      }),
      expect.objectContaining({
        deduplicationKey: "github:push:42:1111111:2222222",
        source: "github-webhook",
      }),
    ]);
  });

  it("records webhook activity idempotently under repeated delivery", async () => {
    const record = {
      deduplicationKey: "github:push:43:aaaaaaa:bbbbbbb",
      localDate: "2026-03-08",
      kind: "push" as const,
      actorId: "7",
      actorLogin: "ada",
      repositoryId: "43",
      repositoryName: "acme/other",
      evidenceUrl: "https://github.com/acme/other/compare/aaaaaaa...bbbbbbb",
      visibility: "public" as const,
      source: "github-webhook" as const,
      subjectId: "bbbbbbb",
      occurredAt: new Date("2026-03-08T15:00:00Z"),
      observedAt: receivedAt,
      authoredBeforeDay: false,
      installationId: "99",
    };

    await repository.recordActivity("webhook-user", [record]);
    await repository.recordActivity("webhook-user", [record]);

    const rows = await testDatabase.query.githubActivity.findMany({
      where: (activity, { eq }) =>
        eq(activity.deduplicationKey, record.deduplicationKey),
    });
    expect(rows).toHaveLength(1);
  });
});
