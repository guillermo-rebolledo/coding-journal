// @vitest-environment node

import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const neonBoundary = vi.hoisted(() => ({
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

  it("records unsupported events as ignored without enqueueing them", async () => {
    const response = await POST(webhookRequest({ event: "workflow_run" }));

    expect(response.status).toBe(200);
    expect(neonBoundary.claimDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "workflow_run", status: "ignored" }),
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
