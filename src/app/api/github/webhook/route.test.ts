// @vitest-environment node

import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const neonBoundary = vi.hoisted(() => ({
  applyAccessChange: vi.fn(),
  restoreAccess: vi.fn(),
  claimDelivery: vi.fn(),
  markDeliveryEnqueued: vi.fn(),
  markDeliveryEnqueueFailed: vi.fn(),
}));
const queueBoundary = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock("@/lib/github-webhook-repository", () => ({
  githubWebhookRepository: neonBoundary,
}));
vi.mock("@/lib/queue", () => ({ queuePublisher: queueBoundary }));

import { POST } from "@/app/api/github/webhook/route";

const secret = "webhook-secret";

function pushBody() {
  return JSON.stringify({
    ref: "refs/heads/main",
    before: "1111111",
    after: "2222222",
    repository: {
      id: 42,
      full_name: "acme/private-engine",
      private: true,
      pushed_at: Math.floor(Date.now() / 1000),
    },
    sender: { id: 7, login: "ada" },
    installation: { id: 99 },
    commits: [],
  });
}

function webhookRequest({
  body = pushBody(),
  event = "push",
  deliveryId = "d0b74ba1-575e-4a52-9c1c-b8f2f4b0a111",
  signature,
}: {
  body?: string;
  event?: string;
  deliveryId?: string;
  signature?: string;
} = {}) {
  return new Request("https://journal.example/api/github/webhook", {
    method: "POST",
    body,
    headers: {
      "x-github-event": event,
      "x-github-delivery": deliveryId,
      "x-hub-signature-256":
        signature ??
        `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    },
  });
}

describe("GitHub webhook endpoint", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", secret);
    neonBoundary.claimDelivery.mockReset().mockResolvedValue("claimed");
    neonBoundary.applyAccessChange.mockReset().mockResolvedValue({
      affectedUsers: 1,
      redactedJournals: 2,
      deletedActivities: 3,
    });
    neonBoundary.restoreAccess.mockReset().mockResolvedValue(undefined);
    neonBoundary.markDeliveryEnqueued.mockReset().mockResolvedValue(undefined);
    neonBoundary.markDeliveryEnqueueFailed
      .mockReset()
      .mockResolvedValue(undefined);
    queueBoundary.publish.mockReset().mockResolvedValue(undefined);
  });

  it("rejects an invalid signature before touching storage or the queue", async () => {
    const response = await POST(
      webhookRequest({ signature: `sha256=${"0".repeat(64)}` }),
    );

    expect(response.status).toBe(401);
    expect(neonBoundary.claimDelivery).not.toHaveBeenCalled();
    expect(queueBoundary.publish).not.toHaveBeenCalled();
  });

  it("acknowledges a verified push and enqueues it under its delivery id", async () => {
    const response = await POST(webhookRequest());

    expect(response.status).toBe(202);
    expect(neonBoundary.claimDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: "d0b74ba1-575e-4a52-9c1c-b8f2f4b0a111",
        eventType: "push",
        installationId: "99",
        status: "received",
      }),
    );
    expect(queueBoundary.publish).toHaveBeenCalledWith(
      "github-webhook-deliveries",
      expect.objectContaining({
        version: 1,
        deliveryId: "d0b74ba1-575e-4a52-9c1c-b8f2f4b0a111",
        push: expect.objectContaining({ head: "2222222" }),
      }),
      "d0b74ba1-575e-4a52-9c1c-b8f2f4b0a111",
    );
    expect(neonBoundary.markDeliveryEnqueued).toHaveBeenCalledWith(
      "d0b74ba1-575e-4a52-9c1c-b8f2f4b0a111",
    );
  });

  it("immediately blocks and redacts a suspended installation without queueing private metadata", async () => {
    const body = JSON.stringify({
      action: "suspend",
      installation: { id: 99, account: { id: 84 } },
      sender: { id: 7, login: "ada" },
      suspension_reason: "PRIVATE-BILLING-DISPUTE",
    });

    const response = await POST(
      webhookRequest({ body, event: "installation" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "redacted" });
    expect(neonBoundary.applyAccessChange).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: "d0b74ba1-575e-4a52-9c1c-b8f2f4b0a111",
        kind: "installation-suspended",
        installationId: "99",
      }),
    );
    expect(
      JSON.stringify(neonBoundary.applyAccessChange.mock.calls),
    ).not.toContain("PRIVATE-BILLING-DISPUTE");
    expect(queueBoundary.publish).not.toHaveBeenCalled();
  });

  it.each([
    {
      event: "installation",
      body: {
        action: "deleted",
        installation: { id: 99, account: { id: 84 } },
        sender: { id: 7, login: "ada" },
      },
      kind: "installation-removed",
    },
    {
      event: "installation_repositories",
      body: {
        action: "removed",
        installation: { id: 99, account: { id: 84 } },
        repositories_removed: [{ id: 42, full_name: "acme/private-engine" }],
        sender: { id: 7, login: "ada" },
      },
      kind: "repositories-removed",
    },
    {
      event: "github_app_authorization",
      body: {
        action: "revoked",
        sender: { id: 7, login: "ada" },
      },
      kind: "authorization-revoked",
    },
  ])(
    "handles $kind synchronously at the signed webhook boundary",
    async (fixture) => {
      const response = await POST(
        webhookRequest({
          body: JSON.stringify(fixture.body),
          event: fixture.event,
        }),
      );

      expect(response.status).toBe(200);
      expect(neonBoundary.applyAccessChange).toHaveBeenCalledWith(
        expect.objectContaining({ kind: fixture.kind }),
      );
      expect(queueBoundary.publish).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      event: "installation",
      body: { action: "unsuspend", installation: { id: 99 } },
      kind: "installation-unsuspended",
      repositoryIds: [],
    },
    {
      event: "installation_repositories",
      body: {
        action: "added",
        installation: { id: 99 },
        repositories_added: [{ id: 42, full_name: "acme/private-engine" }],
      },
      kind: "repositories-added",
      repositoryIds: ["42"],
    },
  ])("restores $body.action access synchronously", async (fixture) => {
    const response = await POST(
      webhookRequest({
        body: JSON.stringify(fixture.body),
        event: fixture.event,
      }),
    );

    await expect(response.json()).resolves.toEqual({ status: "restored" });
    expect(neonBoundary.restoreAccess).toHaveBeenCalledWith({
      kind: fixture.kind,
      installationId: "99",
      repositoryIds: fixture.repositoryIds,
    });
    expect(queueBoundary.publish).not.toHaveBeenCalled();
  });

  it("acknowledges a duplicated delivery id without publishing again", async () => {
    neonBoundary.claimDelivery.mockResolvedValue("duplicate");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "duplicate" });
    expect(queueBoundary.publish).not.toHaveBeenCalled();
  });

  it("acknowledges a verified issue action and enqueues it under its delivery id", async () => {
    const body = JSON.stringify({
      action: "opened",
      issue: {
        number: 41,
        title: "Reconciliation misses reopened issues",
        created_at: new Date().toISOString(),
      },
      repository: { id: 42, full_name: "acme/private-engine", private: true },
      sender: { id: 7, login: "ada", type: "User" },
      installation: { id: 99 },
    });

    const response = await POST(webhookRequest({ body, event: "issues" }));

    expect(response.status).toBe(202);
    expect(neonBoundary.claimDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "issues",
        installationId: "99",
        status: "received",
      }),
    );
    expect(queueBoundary.publish).toHaveBeenCalledWith(
      "github-webhook-deliveries",
      expect.objectContaining({
        version: 1,
        collaboration: expect.objectContaining({
          subject: expect.objectContaining({
            kind: "issue-opened",
            deduplicationKey: "github:issue-opened:42:41",
          }),
        }),
      }),
      "d0b74ba1-575e-4a52-9c1c-b8f2f4b0a111",
    );
    expect(neonBoundary.markDeliveryEnqueued).toHaveBeenCalled();
  });

  it("accepts organization Projects preview events through the isolated contract", async () => {
    const body = JSON.stringify({
      action: "edited",
      organization: { id: 84, login: "acme" },
      sender: { id: 7, login: "ada", type: "User" },
      installation: { id: 99 },
      projects_v2: {
        id: 501,
        node_id: "PVT_kwDOA1",
        number: 12,
        title: "Engineering roadmap",
        html_url: "https://github.com/orgs/acme/projects/12",
      },
      changes: { title: { from: "PRIVATE ROADMAP" } },
    });

    const response = await POST(webhookRequest({ body, event: "projects_v2" }));

    expect(response.status).toBe(202);
    const queued = queueBoundary.publish.mock.calls[0]?.[1];
    expect(queued).toEqual(
      expect.objectContaining({
        project: expect.objectContaining({
          kind: "project-updated",
          completeness: "best-effort",
        }),
      }),
    );
    expect(JSON.stringify(queued)).not.toContain("PRIVATE ROADMAP");
  });

  it("acknowledges a verified branch creation and enqueues only bounded metadata", async () => {
    const body = JSON.stringify({
      ref: "feature/private-roadmap",
      ref_type: "branch",
      pusher_type: "user",
      description: "PRIVATE-REPOSITORY-DESCRIPTION",
      repository: { id: 42, full_name: "acme/private-engine", private: true },
      sender: { id: 7, login: "ada", type: "User" },
      installation: { id: 99 },
    });

    const response = await POST(webhookRequest({ body, event: "create" }));

    expect(response.status).toBe(202);
    const message = queueBoundary.publish.mock.calls[0]?.[1];
    expect(message).toEqual(
      expect.objectContaining({
        collaboration: expect.objectContaining({
          subject: expect.objectContaining({
            kind: "branch-created",
            subjectId: "feature/private-roadmap",
            subjectNumber: null,
          }),
        }),
      }),
    );
    expect(JSON.stringify(message)).not.toContain("PRIVATE");
  });

  it.each([
    {
      event: "delete",
      expectedKind: "tag-deleted",
      activity: { ref: "v1.0.0", ref_type: "tag", pusher_type: "user" },
    },
    {
      event: "release",
      expectedKind: "release-published",
      activity: {
        action: "published",
        release: {
          id: 501,
          tag_name: "v2.0.0",
          name: "Version 2",
          draft: false,
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
    },
    {
      event: "release",
      expectedKind: "release-updated",
      activity: {
        action: "edited",
        release: {
          id: 501,
          tag_name: "v2.0.0",
          name: "Version 2",
          draft: false,
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
    },
    {
      event: "discussion",
      expectedKind: "discussion-created",
      activity: {
        action: "created",
        discussion: {
          number: 73,
          title: "Public design question",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
    },
    {
      event: "discussion_comment",
      expectedKind: "discussion-comment",
      activity: {
        action: "created",
        discussion: { number: 73, title: "Public design question" },
        comment: { id: 8801, created_at: new Date().toISOString() },
      },
    },
    {
      event: "discussion",
      expectedKind: "discussion-answered",
      activity: {
        action: "answered",
        discussion: {
          number: 73,
          title: "Public design question",
          updated_at: new Date().toISOString(),
        },
        answer: { id: 8801 },
      },
    },
  ])(
    "enqueues $expectedKind activity at the webhook boundary",
    async (testCase) => {
      const body = JSON.stringify({
        ...testCase.activity,
        repository: {
          id: 42,
          full_name: "acme/open-engine",
          private: false,
        },
        sender: { id: 7, login: "ada", type: "User" },
        installation: { id: 99 },
      });

      const response = await POST(
        webhookRequest({ body, event: testCase.event }),
      );

      expect(response.status).toBe(202);
      expect(queueBoundary.publish).toHaveBeenCalledWith(
        "github-webhook-deliveries",
        expect.objectContaining({
          collaboration: expect.objectContaining({
            private: false,
            subject: expect.objectContaining({ kind: testCase.expectedKind }),
          }),
        }),
        "d0b74ba1-575e-4a52-9c1c-b8f2f4b0a111",
      );
    },
  );

  it("excludes reaction deliveries before queueing", async () => {
    const body = JSON.stringify({
      action: "created",
      reaction: { id: 901, content: "+1" },
      repository: { id: 42, full_name: "acme/private-engine", private: true },
      sender: { id: 7, login: "ada", type: "User" },
      installation: { id: 99 },
    });

    const response = await POST(webhookRequest({ body, event: "reaction" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ignored" });
    expect(queueBoundary.publish).not.toHaveBeenCalled();
  });

  it("records unsupported collaboration actions as ignored without enqueueing them", async () => {
    const body = JSON.stringify({
      action: "synchronize",
      pull_request: {
        number: 52,
        title: "Sync",
        updated_at: new Date().toISOString(),
      },
      repository: { id: 42, full_name: "acme/private-engine", private: true },
      sender: { id: 7, login: "ada", type: "User" },
      installation: { id: 99 },
    });

    const response = await POST(
      webhookRequest({ body, event: "pull_request" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "no-activity" });
    expect(neonBoundary.claimDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "pull_request", status: "ignored" }),
    );
    expect(queueBoundary.publish).not.toHaveBeenCalled();
  });

  it("enqueues a verified manual workflow run with bounded fields", async () => {
    const body = JSON.stringify({
      action: "completed",
      repository: {
        id: 42,
        full_name: "acme/private-engine",
        private: true,
      },
      sender: { id: 7, login: "ada", type: "User" },
      installation: { id: 99 },
      workflow_run: {
        id: 501,
        run_attempt: 1,
        name: "Deploy production",
        event: "workflow_dispatch",
        conclusion: "success",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        triggering_actor: { id: 7, login: "ada", type: "User" },
        logs_url: "https://api.github.com/private-logs",
      },
    });

    const response = await POST(
      webhookRequest({ body, event: "workflow_run" }),
    );

    expect(response.status).toBe(202);
    expect(queueBoundary.publish).toHaveBeenCalledWith(
      "github-webhook-deliveries",
      expect.objectContaining({
        operation: expect.objectContaining({
          kind: "workflow-run",
          status: "success",
        }),
      }),
      "d0b74ba1-575e-4a52-9c1c-b8f2f4b0a111",
    );
    expect(
      JSON.stringify(queueBoundary.publish.mock.calls[0]?.[1]),
    ).not.toContain("private-logs");
  });

  it("records unsupported events as ignored without enqueueing them", async () => {
    const response = await POST(webhookRequest({ event: "status" }));

    expect(response.status).toBe(200);
    expect(neonBoundary.claimDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "status", status: "ignored" }),
    );
    expect(queueBoundary.publish).not.toHaveBeenCalled();
  });

  it("rejects malformed push payloads without enqueueing them", async () => {
    const response = await POST(webhookRequest({ body: '{"broken":' }));

    expect(response.status).toBe(400);
    expect(neonBoundary.claimDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ignored" }),
    );
    expect(queueBoundary.publish).not.toHaveBeenCalled();
  });

  it("rejects deliveries without a usable delivery id", async () => {
    const response = await POST(webhookRequest({ deliveryId: "bad id!" }));

    expect(response.status).toBe(400);
    expect(neonBoundary.claimDelivery).not.toHaveBeenCalled();
  });

  it("surfaces enqueue failures so GitHub redelivers", async () => {
    queueBoundary.publish.mockRejectedValue(new Error("queue unavailable"));

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(neonBoundary.markDeliveryEnqueueFailed).toHaveBeenCalledWith(
      "d0b74ba1-575e-4a52-9c1c-b8f2f4b0a111",
      expect.any(String),
    );
    expect(neonBoundary.markDeliveryEnqueued).not.toHaveBeenCalled();
  });
});
