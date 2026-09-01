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
import { processWebhookDeliveryMessage } from "@/lib/github-webhook-processing";
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
    await processWebhookDeliveryMessage(
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

    expect(journal.metrics).toEqual({
      pushes: 1,
      commits: 1,
      refs: 0,
      releases: 0,
      discussions: 0,
      issues: 0,
      pullRequests: 0,
      reviews: 0,
      merges: 0,
      comments: 0,
      workflows: 0,
      deployments: 0,
      packages: 0,
    });
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

  it("keeps one canonical record when reconciliation and the webhook observe the same comment", async () => {
    const jsonResponse = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const fetchFixture = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/user")) return jsonResponse({ id: 7, login: "ada" });
      if (url.includes("/users/ada/events")) {
        return jsonResponse([
          {
            id: "event-901",
            type: "IssueCommentEvent",
            actor: { id: 7, login: "ada" },
            repo: { id: 42, name: "acme/private-engine" },
            public: false,
            created_at: "2026-03-08T15:10:00Z",
            payload: {
              action: "created",
              issue: { number: 41, title: "Reconciliation misses issues" },
              comment: { id: 9001, created_at: "2026-03-08T15:10:00Z" },
            },
          },
        ]);
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    });

    // The webhook consumer lands the comment first, then reconciliation
    // observes the same comment through the events API.
    await processWebhookDeliveryMessage(
      {
        version: 1,
        deliveryId: "delivery-overlap-comment",
        installationId: "99",
        receivedAt: receivedAt.toISOString(),
        collaboration: {
          repositoryId: "42",
          repositoryName: "acme/private-engine",
          private: true,
          senderId: "7",
          senderLogin: "ada",
          subject: {
            kind: "issue-comment",
            deduplicationKey: "github:issue-comment:42:9001",
            subjectId: "9001",
            subjectNumber: 41,
            title: "Reconciliation misses issues",
            evidenceUrl:
              "https://github.com/acme/private-engine/issues/41#issuecomment-9001",
            occurredAt: "2026-03-08T15:10:00.000Z",
          },
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
      now: new Date("2026-03-08T18:20:00Z"),
      fetchImplementation: fetchFixture as typeof fetch,
      store: activityRepository,
    });

    expect(journal.metrics.comments).toBe(1);
    expect(journal.activities).toContainEqual(
      expect.objectContaining({
        deduplicationKey: "github:issue-comment:42:9001",
        kind: "issue-comment",
        source: "github-webhook",
        subjectNumber: 41,
        subjectTitle: "Reconciliation misses issues",
      }),
    );

    const rows = await testDatabase.query.githubActivity.findMany({
      where: (activity, { eq }) =>
        eq(activity.deduplicationKey, "github:issue-comment:42:9001"),
    });
    expect(rows).toHaveLength(1);
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
      subjectNumber: null,
      subjectTitle: null,
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

  it("hides an early automated outcome until its user's approval arrives", async () => {
    const localDate = "2026-03-09";
    const now = new Date("2026-03-09T18:00:00Z");
    if (
      await activityRepository.tryStart(
        "webhook-user",
        localDate,
        now,
        new Date("2026-03-09T17:45:00Z"),
        "America/New_York",
      )
    ) {
      await activityRepository.finish(
        "webhook-user",
        {
          localDate,
          timeZone: "America/New_York",
          status: "complete",
          refreshedAt: now,
        },
        [],
      );
    }
    const operation = {
      kind: "workflow-run" as const,
      deduplicationKey: "github:workflow-run:42:777:1",
      attributionKey: "github:workflow-run:42:777:1",
      repositoryId: "42",
      repositoryName: "acme/private-engine",
      private: true,
      subjectId: "777",
      title: "Deploy production",
      occurredAt: "2026-03-09T15:00:00.000Z",
      evidenceUrl:
        "https://github.com/acme/private-engine/actions/runs/777/attempts/1",
      narrativeEligible: true,
    };

    await processWebhookDeliveryMessage(
      {
        version: 1,
        deliveryId: "workflow-outcome-db",
        installationId: "99",
        receivedAt: "2026-03-09T15:05:00.000Z",
        operation: {
          ...operation,
          attribution: "linked",
          actorId: "15",
          actorLogin: "github-actions[bot]",
          status: "success",
          statusOccurredAt: "2026-03-09T15:04:00.000Z",
        },
      },
      { deliveryCount: 1 },
      repository,
    );

    expect(
      (await activityRepository.read("webhook-user", localDate)).activities,
    ).toEqual([]);

    await processWebhookDeliveryMessage(
      {
        version: 1,
        deliveryId: "workflow-approval-db",
        installationId: "99",
        receivedAt: "2026-03-09T15:03:00.000Z",
        operation: {
          ...operation,
          attribution: "direct",
          actorId: "7",
          actorLogin: "ada",
          status: "approved",
          statusOccurredAt: "2026-03-09T15:02:00.000Z",
        },
      },
      { deliveryCount: 1 },
      repository,
    );

    expect(
      (await activityRepository.read("webhook-user", localDate)).activities,
    ).toEqual([
      expect.objectContaining({
        kind: "workflow-run",
        actorLogin: "ada",
        status: "success",
        attributed: true,
      }),
    ]);

    await processWebhookDeliveryMessage(
      {
        version: 1,
        deliveryId: "workflow-stale-failure-db",
        installationId: "99",
        receivedAt: "2026-03-09T15:06:00.000Z",
        operation: {
          ...operation,
          attribution: "linked",
          actorId: "15",
          actorLogin: "github-actions[bot]",
          status: "failure",
          statusOccurredAt: "2026-03-09T15:01:00.000Z",
        },
      },
      { deliveryCount: 1 },
      repository,
    );

    expect(
      (await activityRepository.read("webhook-user", localDate)).activities,
    ).toEqual([
      expect.objectContaining({ status: "success", actorLogin: "ada" }),
    ]);
  });

  it("reveals only the deployment outcome linked to the user's merge", async () => {
    const localDate = "2026-03-10";
    const now = new Date("2026-03-10T18:00:00Z");
    if (
      await activityRepository.tryStart(
        "webhook-user",
        localDate,
        now,
        new Date("2026-03-10T17:45:00Z"),
        "America/New_York",
      )
    ) {
      await activityRepository.finish(
        "webhook-user",
        {
          localDate,
          timeZone: "America/New_York",
          status: "complete",
          refreshedAt: now,
        },
        [],
      );
    }
    const deployment = (id: string, sha: string) => ({
      version: 1 as const,
      deliveryId: `deployment-${id}`,
      installationId: "99",
      receivedAt: "2026-03-10T15:05:00.000Z",
      operation: {
        kind: "deployment" as const,
        deduplicationKey: `github:deployment:42:${id}`,
        attributionKey: `github:commit:42:${sha}`,
        attributionKeys: [`github:commit:42:${sha}`],
        attribution: "linked" as const,
        repositoryId: "42",
        repositoryName: "acme/private-engine",
        private: true,
        actorId: "15",
        actorLogin: "github-actions[bot]",
        subjectId: id,
        title: "production",
        occurredAt: "2026-03-10T15:00:00.000Z",
        status: "success" as const,
        evidenceUrl: "https://github.com/acme/private-engine/deployments",
        narrativeEligible: true,
      },
    });

    await processWebhookDeliveryMessage(
      deployment("801", "abcdef1234567"),
      { deliveryCount: 1 },
      repository,
    );
    await processWebhookDeliveryMessage(
      deployment("802", "deadbee123456"),
      { deliveryCount: 1 },
      repository,
    );
    await processWebhookDeliveryMessage(
      {
        version: 1,
        deliveryId: "package-803",
        installationId: "99",
        receivedAt: "2026-03-10T15:06:00.000Z",
        operation: {
          kind: "package-published",
          deduplicationKey: "github:package-published:42:803",
          attributionKey: "github:commit:42:abcdef1234567",
          attributionKeys: ["github:commit:42:abcdef1234567"],
          attribution: "linked",
          repositoryId: "42",
          repositoryName: "acme/private-engine",
          private: true,
          actorId: "15",
          actorLogin: "github-actions[bot]",
          subjectId: "803",
          title: "coding-journal · 2.0.0",
          occurredAt: "2026-03-10T15:01:00.000Z",
          status: "success",
          statusOccurredAt: "2026-03-10T15:01:00.000Z",
          evidenceUrl: "https://github.com/acme/private-engine/packages",
          narrativeEligible: true,
        },
      },
      { deliveryCount: 1 },
      repository,
    );
    expect(
      (await activityRepository.read("webhook-user", localDate)).activities,
    ).toEqual([]);

    await processWebhookDeliveryMessage(
      {
        version: 1,
        deliveryId: "merge-origin",
        installationId: "99",
        receivedAt: "2026-03-10T15:04:00.000Z",
        collaboration: {
          repositoryId: "42",
          repositoryName: "acme/private-engine",
          private: true,
          senderId: "7",
          senderLogin: "ada",
          subject: {
            kind: "pull-request-merged",
            deduplicationKey: "github:pull-request-merged:42:52",
            subjectId: "52",
            subjectNumber: 52,
            title: "Ship production",
            evidenceUrl: "https://github.com/acme/private-engine/pull/52",
            occurredAt: "2026-03-10T14:59:00.000Z",
            attributionKeys: ["github:commit:42:abcdef1234567"],
          },
        },
      },
      { deliveryCount: 1 },
      repository,
    );

    const journal = await activityRepository.read("webhook-user", localDate);
    expect(
      journal.activities.filter((activity) => activity.kind === "deployment"),
    ).toEqual([
      expect.objectContaining({
        deduplicationKey: "github:deployment:42:801",
        actorLogin: "ada",
      }),
    ]);
    expect(
      journal.activities.filter(
        (activity) => activity.kind === "package-published",
      ),
    ).toEqual([
      expect.objectContaining({
        deduplicationKey: "github:package-published:42:803",
        actorLogin: "ada",
      }),
    ]);
  });
});
