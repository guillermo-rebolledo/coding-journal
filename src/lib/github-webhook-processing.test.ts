// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ActivityRecord } from "@/lib/github-activity";
import type { PushDeliveryMessage } from "@/lib/github-webhook";
import {
  processWebhookDeliveryMessage,
  type WebhookDeliveryStore,
} from "@/lib/github-webhook-processing";
import type { WebhookInstallationUser } from "@/lib/github-webhook-repository";

class MemoryStore implements WebhookDeliveryStore {
  activities = new Map<string, ActivityRecord>();
  deliveryStatuses = new Map<string, string>();
  users: WebhookInstallationUser[] = [
    { userId: "user-1", timeZone: "America/New_York", githubAccountId: "7" },
  ];
  failRecordActivity = 0;

  async findActiveInstallationUsers(installationId: string) {
    return installationId === "99" ? this.users : [];
  }

  async recordActivity(userId: string, records: ActivityRecord[]) {
    if (this.failRecordActivity > 0) {
      this.failRecordActivity -= 1;
      throw new Error("Postgres is unavailable");
    }
    for (const record of records) {
      const key = `${userId}:${record.deduplicationKey}`;
      const existing = this.activities.get(key);
      if (!existing) {
        this.activities.set(key, record);
        continue;
      }
      const statusRank = {
        pending: 0,
        approved: 1,
        success: 2,
        failure: 2,
        cancelled: 2,
      } as const;
      const keepExistingStatus =
        existing.status &&
        (!record.status ||
          statusRank[existing.status] > statusRank[record.status]);
      const merged: ActivityRecord = { ...existing, ...record };
      // A concluded status is never walked back by a later pending delivery.
      if (keepExistingStatus) merged.status = existing.status;
      // An unattributed observation keeps the actor the attributed one named.
      if (!record.attributed) {
        merged.actorId = existing.actorId;
        merged.actorLogin = existing.actorLogin;
      }
      merged.attributed = Boolean(existing.attributed || record.attributed);
      this.activities.set(key, merged);
    }
  }

  async markDeliveryProcessed(deliveryId: string, outcome: string) {
    this.deliveryStatuses.set(deliveryId, outcome);
  }

  async markDeliveryFailed(deliveryId: string, status: string) {
    this.deliveryStatuses.set(deliveryId, status);
  }
}

function message(
  overrides: Partial<PushDeliveryMessage> = {},
): PushDeliveryMessage {
  return {
    version: 1,
    deliveryId: "delivery-1",
    installationId: "99",
    receivedAt: "2026-03-08T15:00:05.000Z",
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
    ...overrides,
  };
}

describe("GitHub webhook queue processing", () => {
  it("persists one canonical push and commit for an installed user", async () => {
    const store = new MemoryStore();

    await processWebhookDeliveryMessage(message(), { deliveryCount: 1 }, store);

    expect([...store.activities.keys()]).toEqual([
      "user-1:github:push:42:1111111:2222222",
      "user-1:github:commit:42:2222222",
    ]);
    expect(store.deliveryStatuses.get("delivery-1")).toBe("processed");
  });

  it("persists one canonical collaboration record for an installed user", async () => {
    const store = new MemoryStore();
    const collaborationMessage = {
      version: 1 as const,
      deliveryId: "delivery-9",
      installationId: "99",
      receivedAt: "2026-03-08T15:00:05.000Z",
      collaboration: {
        repositoryId: "42",
        repositoryName: "acme/private-engine",
        private: true,
        senderId: "7",
        senderLogin: "ada",
        subject: {
          kind: "pull-request-review" as const,
          deduplicationKey: "github:pull-request-review:42:7001",
          subjectId: "7001",
          subjectNumber: 52,
          title: "Track issue and pull-request collaboration",
          evidenceUrl:
            "https://github.com/acme/private-engine/pull/52#pullrequestreview-7001",
          occurredAt: "2026-03-08T14:36:00.000Z",
        },
      },
    };

    await processWebhookDeliveryMessage(
      collaborationMessage,
      { deliveryCount: 1 },
      store,
    );
    await processWebhookDeliveryMessage(
      { ...collaborationMessage, deliveryId: "delivery-10" },
      { deliveryCount: 1 },
      store,
    );

    expect([...store.activities.keys()]).toEqual([
      "user-1:github:pull-request-review:42:7001",
    ]);
    expect(
      store.activities.get("user-1:github:pull-request-review:42:7001"),
    ).toMatchObject({
      kind: "pull-request-review",
      subjectNumber: 52,
      subjectTitle: "Track issue and pull-request collaboration",
      source: "github-webhook",
    });
    expect(store.deliveryStatuses.get("delivery-9")).toBe("processed");
    expect(store.deliveryStatuses.get("delivery-10")).toBe("processed");
  });

  it("persists attributable organization Project activity from a preview message", async () => {
    const store = new MemoryStore();

    await processWebhookDeliveryMessage(
      {
        version: 1,
        deliveryId: "project-delivery-1",
        installationId: "99",
        receivedAt: "2026-03-08T15:00:05.000Z",
        project: {
          kind: "project-item-archived",
          deduplicationKey:
            "github:project-item-archived:PVT_kwDOA1:PVTI_kwDOB2:project-delivery-1",
          organizationId: "84",
          organizationLogin: "acme",
          senderId: "7",
          senderLogin: "ada",
          projectId: "PVT_kwDOA1",
          subjectId: "PVTI_kwDOB2",
          subjectNumber: null,
          title: null,
          evidenceUrl: "https://github.com/orgs/acme/projects",
          occurredAt: "2026-03-08T15:00:05.000Z",
          completeness: "best-effort",
        },
      },
      { deliveryCount: 1 },
      store,
    );

    expect([...store.activities.values()]).toEqual([
      expect.objectContaining({
        kind: "project-item-archived",
        repositoryName: "acme/Projects",
        source: "github-projects-preview",
      }),
    ]);
    expect(store.deliveryStatuses.get("project-delivery-1")).toBe("processed");
  });

  it("persists a manual workflow outcome through the operations contract", async () => {
    const store = new MemoryStore();

    await processWebhookDeliveryMessage(
      {
        version: 1,
        deliveryId: "workflow-delivery-1",
        installationId: "99",
        receivedAt: "2026-03-08T15:05:00.000Z",
        operation: {
          kind: "workflow-run",
          deduplicationKey: "github:workflow-run:42:501:1",
          attributionKey: "github:workflow-run:42:501:1",
          attribution: "direct",
          repositoryId: "42",
          repositoryName: "acme/private-engine",
          private: true,
          actorId: "7",
          actorLogin: "ada",
          subjectId: "501",
          title: "Deploy production",
          occurredAt: "2026-03-08T15:00:00.000Z",
          status: "success",
          evidenceUrl:
            "https://github.com/acme/private-engine/actions/runs/501/attempts/1",
          narrativeEligible: true,
        },
      },
      { deliveryCount: 1 },
      store,
    );

    expect(
      store.activities.get("user-1:github:workflow-run:42:501:1"),
    ).toMatchObject({
      kind: "workflow-run",
      status: "success",
      attributed: true,
    });
  });

  it("attaches an out-of-order automated outcome to its user's approval", async () => {
    const store = new MemoryStore();
    const operation = {
      kind: "workflow-run" as const,
      deduplicationKey: "github:workflow-run:42:501:1",
      attributionKey: "github:workflow-run:42:501:1",
      repositoryId: "42",
      repositoryName: "acme/private-engine",
      private: true,
      subjectId: "501",
      title: "Deploy production",
      occurredAt: "2026-03-08T15:00:00.000Z",
      evidenceUrl:
        "https://github.com/acme/private-engine/actions/runs/501/attempts/1",
      narrativeEligible: true,
    };

    await processWebhookDeliveryMessage(
      {
        version: 1,
        deliveryId: "workflow-outcome-1",
        installationId: "99",
        receivedAt: "2026-03-08T15:05:00.000Z",
        operation: {
          ...operation,
          attribution: "linked",
          actorId: "15",
          actorLogin: "github-actions[bot]",
          status: "success",
        },
      },
      { deliveryCount: 1 },
      store,
    );
    await processWebhookDeliveryMessage(
      {
        version: 1,
        deliveryId: "workflow-approval-1",
        installationId: "99",
        receivedAt: "2026-03-08T15:03:00.000Z",
        operation: {
          ...operation,
          attribution: "direct",
          actorId: "7",
          actorLogin: "ada",
          status: "approved",
        },
      },
      { deliveryCount: 1 },
      store,
    );

    expect(store.activities.size).toBe(1);
    expect(
      store.activities.get("user-1:github:workflow-run:42:501:1"),
    ).toMatchObject({
      actorId: "7",
      actorLogin: "ada",
      status: "success",
      attributed: true,
    });
  });

  it("persists a private discussion comment without its body", async () => {
    const store = new MemoryStore();

    await processWebhookDeliveryMessage(
      {
        version: 1,
        deliveryId: "delivery-discussion",
        installationId: "99",
        receivedAt: "2026-03-08T15:00:05.000Z",
        collaboration: {
          repositoryId: "42",
          repositoryName: "acme/private-engine",
          private: true,
          senderId: "7",
          senderLogin: "ada",
          subject: {
            kind: "discussion-comment",
            deduplicationKey: "github:discussion-comment:42:8801",
            subjectId: "8801",
            subjectNumber: 73,
            title: "How should reconciliation report gaps?",
            evidenceUrl:
              "https://github.com/acme/private-engine/discussions/73#discussioncomment-8801",
            occurredAt: "2026-03-08T14:30:00.000Z",
          },
        },
      },
      { deliveryCount: 1 },
      store,
    );

    expect(
      store.activities.get("user-1:github:discussion-comment:42:8801"),
    ).toMatchObject({
      kind: "discussion-comment",
      visibility: "private",
      subjectNumber: 73,
      subjectTitle: "How should reconciliation report gaps?",
    });
  });

  it("skips collaboration actions from participants who are not the journal user", async () => {
    const store = new MemoryStore();

    await processWebhookDeliveryMessage(
      {
        version: 1,
        deliveryId: "delivery-11",
        installationId: "99",
        receivedAt: "2026-03-08T15:00:05.000Z",
        collaboration: {
          repositoryId: "42",
          repositoryName: "acme/private-engine",
          private: true,
          senderId: "8",
          senderLogin: "mallory",
          subject: {
            kind: "issue-comment",
            deduplicationKey: "github:issue-comment:42:9001",
            subjectId: "9001",
            subjectNumber: 41,
            title: null,
            evidenceUrl:
              "https://github.com/acme/private-engine/issues/41#issuecomment-9001",
            occurredAt: "2026-03-08T14:35:00.000Z",
          },
        },
      },
      { deliveryCount: 1 },
      store,
    );

    expect(store.activities.size).toBe(0);
    expect(store.deliveryStatuses.get("delivery-11")).toBe("skipped");
  });

  it("keeps duplicated, reordered, and concurrent deliveries at one effect", async () => {
    const store = new MemoryStore();
    const first = message();
    const second = message({
      deliveryId: "delivery-2",
      push: {
        ...message().push,
        before: "2222222",
        head: "3333333",
        commits: [
          {
            sha: "3333333",
            authoredAt: "2026-03-08T16:00:00.000Z",
            authorLogin: "ada",
          },
        ],
      },
    });

    // The second push arrives first, the first is retried and duplicated, and
    // one retry races a duplicate concurrently.
    await processWebhookDeliveryMessage(second, { deliveryCount: 1 }, store);
    await processWebhookDeliveryMessage(first, { deliveryCount: 1 }, store);
    await Promise.all([
      processWebhookDeliveryMessage(first, { deliveryCount: 2 }, store),
      processWebhookDeliveryMessage(first, { deliveryCount: 3 }, store),
    ]);

    const kinds = [...store.activities.values()].map((record) => record.kind);
    expect(kinds.filter((kind) => kind === "push")).toHaveLength(2);
    expect(kinds.filter((kind) => kind === "commit")).toHaveLength(2);
  });

  it("skips pushes from collaborators who are not the journal user", async () => {
    const store = new MemoryStore();

    await processWebhookDeliveryMessage(
      message({
        push: { ...message().push, senderId: "8", senderLogin: "mallory" },
      }),
      { deliveryCount: 1 },
      store,
    );

    expect(store.activities.size).toBe(0);
    expect(store.deliveryStatuses.get("delivery-1")).toBe("skipped");
  });

  it("retries transient failures and succeeds without duplicating records", async () => {
    const store = new MemoryStore();
    store.failRecordActivity = 1;

    await expect(
      processWebhookDeliveryMessage(message(), { deliveryCount: 1 }, store),
    ).rejects.toThrow("Postgres is unavailable");
    expect(store.deliveryStatuses.get("delivery-1")).toBe("failed");

    await processWebhookDeliveryMessage(message(), { deliveryCount: 2 }, store);

    expect(store.activities.size).toBe(2);
    expect(store.deliveryStatuses.get("delivery-1")).toBe("processed");
  });

  it("acknowledges a poisoned message after the final attempt", async () => {
    const store = new MemoryStore();
    store.failRecordActivity = Number.POSITIVE_INFINITY;

    await expect(
      processWebhookDeliveryMessage(message(), { deliveryCount: 5 }, store),
    ).resolves.toBeUndefined();
    expect(store.deliveryStatuses.get("delivery-1")).toBe("poisoned");
    expect(store.activities.size).toBe(0);
  });

  it("acknowledges messages from an incompatible deployment without effects", async () => {
    const store = new MemoryStore();

    await expect(
      processWebhookDeliveryMessage(
        { version: 99, deliveryId: "delivery-9" },
        { deliveryCount: 1 },
        store,
      ),
    ).resolves.toBeUndefined();
    expect(store.activities.size).toBe(0);
    expect(store.deliveryStatuses.get("delivery-9")).toBe("poisoned");
  });
});
