// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { JsonObject } from "@/lib/json-payload";
import { computeActivityMetrics } from "@/lib/github-activity";
import {
  extractOperationsDelivery,
  normalizeOperationsMessage,
  parseOperationsDeliveryMessage,
} from "@/lib/github-operations";

const receivedAt = new Date("2026-08-31T12:05:00.000Z");

function workflowPayload(overrides: JsonObject = {}) {
  return {
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
      status: "completed",
      conclusion: "success",
      created_at: "2026-08-31T12:00:00.000Z",
      updated_at: "2026-08-31T12:04:00.000Z",
      triggering_actor: { id: 7, login: "ada", type: "User" },
      logs_url: "https://api.github.com/private-logs",
      ...overrides,
    },
    secret: "DO-NOT-RETAIN",
  };
}

describe("GitHub operations webhook contract", () => {
  it("normalizes a user-dispatched workflow and its outcome without sensitive fields", () => {
    const extraction = extractOperationsDelivery({
      eventType: "workflow_run",
      payload: workflowPayload(),
      deliveryId: "workflow-delivery-1",
      receivedAt,
    });

    expect(extraction).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.objectContaining({
          operation: expect.objectContaining({
            kind: "workflow-run",
            status: "success",
            attribution: "direct",
            deduplicationKey: "github:workflow-run:42:501:1",
          }),
        }),
      }),
    );
    expect(JSON.stringify(extraction)).not.toContain("DO-NOT-RETAIN");
    expect(JSON.stringify(extraction)).not.toContain("private-logs");

    if (!extraction.ok) throw new Error("Expected extraction to succeed");
    expect(
      normalizeOperationsMessage(extraction.message, {
        githubAccountId: "7",
        timeZone: "America/Mexico_City",
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "workflow-run",
        actorId: "7",
        subjectTitle: "Deploy production",
        status: "success",
        evidenceUrl:
          "https://github.com/acme/private-engine/actions/runs/501/attempts/1",
      }),
    ]);
  });

  it("excludes autonomous starts but attributes a user's manual rerun", () => {
    const scheduled = extractOperationsDelivery({
      eventType: "workflow_run",
      payload: {
        ...workflowPayload({ event: "schedule" }),
        action: "requested",
      },
      deliveryId: "workflow-delivery-2",
      receivedAt,
    });
    const rerun = extractOperationsDelivery({
      eventType: "workflow_run",
      payload: workflowPayload({ event: "schedule", run_attempt: 2 }),
      deliveryId: "workflow-delivery-3",
      receivedAt,
    });

    expect(scheduled).toEqual({ ok: false, reason: "no-activity" });
    expect(rerun).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.objectContaining({
          operation: expect.objectContaining({
            deduplicationKey: "github:workflow-run:42:501:2",
          }),
        }),
      }),
    );
  });

  it("links a user's approval to the autonomous run's later outcome", () => {
    const approval = extractOperationsDelivery({
      eventType: "deployment_review",
      payload: {
        action: "approved",
        repository: {
          id: 42,
          full_name: "acme/private-engine",
          private: true,
        },
        sender: { id: 15, login: "github-actions[bot]", type: "Bot" },
        approver: { id: 7, login: "ada", type: "User" },
        installation: { id: 99 },
        since: "2026-08-31T12:02:00.000Z",
        workflow_run: {
          id: 501,
          run_attempt: 1,
          name: "Deploy production",
          event: "schedule",
          created_at: "2026-08-31T12:00:00.000Z",
        },
        comment: "PRIVATE-APPROVAL-COMMENT",
      },
      deliveryId: "workflow-approval-1",
      receivedAt,
    });
    const outcome = extractOperationsDelivery({
      eventType: "workflow_run",
      payload: workflowPayload({
        event: "schedule",
        triggering_actor: {
          id: 496_993_33,
          login: "dependabot[bot]",
          type: "Bot",
        },
      }),
      deliveryId: "workflow-outcome-1",
      receivedAt,
    });

    expect(approval).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.objectContaining({
          operation: expect.objectContaining({
            status: "approved",
            attribution: "direct",
            deduplicationKey: "github:workflow-run:42:501:1",
          }),
        }),
      }),
    );
    expect(outcome).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.objectContaining({
          operation: expect.objectContaining({
            status: "success",
            attribution: "linked",
            deduplicationKey: "github:workflow-run:42:501:1",
          }),
        }),
      }),
    );
    expect(JSON.stringify(approval)).not.toContain("PRIVATE");
  });

  it("links a bot-produced package through its target commit", () => {
    const extraction = extractOperationsDelivery({
      eventType: "registry_package",
      payload: {
        action: "published",
        repository: {
          id: 42,
          full_name: "acme/private-engine",
          private: true,
        },
        sender: { id: 15, login: "github-actions[bot]", type: "Bot" },
        installation: { id: 99 },
        registry_package: {
          id: 601,
          name: "coding-journal",
          package_type: "container",
          package_version: {
            id: 701,
            version: "sha256:abcdef",
            created_at: "2026-08-31T12:01:00.000Z",
            updated_at: "2026-08-31T12:03:00.000Z",
            target_oid: "abcdef1234567",
            target_commitish: "v2.0.0",
          },
        },
      },
      deliveryId: "package-bot-published-1",
      receivedAt,
    });

    expect(extraction).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.objectContaining({
          operation: expect.objectContaining({
            attribution: "linked",
            attributionKeys: [
              "github:commit:42:abcdef1234567",
              "github:ref:42:v2.0.0",
            ],
          }),
        }),
      }),
    );
  });

  it.each([
    ["published", "package-published", true],
    ["updated", "package-updated", true],
    ["deleted", "package-deleted", false],
    ["restored", "package-restored", false],
  ])(
    "normalizes a %s package lifecycle event with its narrative policy",
    (action, expectedKind, narrativeEligible) => {
      const extraction = extractOperationsDelivery({
        eventType:
          action === "published" || action === "updated"
            ? "registry_package"
            : "package",
        payload: {
          action,
          repository: {
            id: 42,
            full_name: "acme/private-engine",
            private: true,
          },
          sender: { id: 7, login: "ada", type: "User" },
          installation: { id: 99 },
          [action === "published" || action === "updated"
            ? "registry_package"
            : "package"]: {
            id: 601,
            name: "coding-journal",
            package_type: "container",
            package_version: {
              id: 701,
              version: "sha256:abcdef",
              created_at: "2026-08-31T12:01:00.000Z",
              updated_at: "2026-08-31T12:03:00.000Z",
              metadata: { container: { tags: ["PRIVATE-TAG"] } },
              manifest: "PRIVATE-MANIFEST",
            },
          },
        },
        deliveryId: `package-${action}-1`,
        receivedAt,
      });

      expect(extraction).toEqual(
        expect.objectContaining({
          ok: true,
          message: expect.objectContaining({
            operation: expect.objectContaining({
              kind: expectedKind,
              narrativeEligible,
              subjectId: "701",
              title: "coding-journal · sha256:abcdef",
            }),
          }),
        }),
      );
      expect(JSON.stringify(extraction)).not.toContain("PRIVATE");

      if (!extraction.ok) throw new Error("Expected extraction to succeed");
      expect(
        normalizeOperationsMessage(extraction.message, {
          githubAccountId: "7",
          timeZone: "America/Mexico_City",
        }),
      ).toEqual([
        expect.objectContaining({
          kind: expectedKind,
          narrativeEligible,
          evidenceUrl: "https://github.com/acme/private-engine/packages",
        }),
      ]);
    },
  );

  it("keeps only an attributable deployment outcome and drops operational URLs", () => {
    const extraction = extractOperationsDelivery({
      eventType: "deployment_status",
      payload: {
        action: "created",
        repository: {
          id: 42,
          full_name: "acme/private-engine",
          private: true,
        },
        sender: { id: 15, login: "github-actions[bot]", type: "Bot" },
        installation: { id: 99 },
        deployment: {
          id: 801,
          sha: "abcdef1234567",
          ref: "main",
          created_at: "2026-08-31T12:00:00.000Z",
          environment: "production",
          payload: { secret: "PRIVATE-DEPLOYMENT-PAYLOAD" },
        },
        deployment_status: {
          id: 901,
          state: "success",
          created_at: "2026-08-31T12:04:00.000Z",
          environment_url: "https://production.example/private",
          log_url: "https://logs.example/private",
        },
        workflow_run: {
          id: 501,
          run_attempt: 1,
          name: "Deploy production",
          event: "workflow_dispatch",
          created_at: "2026-08-31T12:00:00.000Z",
          triggering_actor: { id: 7, login: "ada", type: "User" },
        },
      },
      deliveryId: "deployment-status-1",
      receivedAt,
    });

    expect(extraction).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.objectContaining({
          operation: expect.objectContaining({
            kind: "deployment",
            status: "success",
            attribution: "direct",
            actorId: "7",
            attributionKeys: ["github:workflow-run:42:501:1"],
            evidenceUrl: "https://github.com/acme/private-engine/deployments",
          }),
        }),
      }),
    );
    expect(JSON.stringify(extraction)).not.toContain("production.example");
    expect(JSON.stringify(extraction)).not.toContain("logs.example");
    expect(JSON.stringify(extraction)).not.toContain("PRIVATE");
  });

  it("counts workflows, deployments, and only narrative package changes", () => {
    expect(
      computeActivityMetrics([
        { kind: "workflow-run" },
        { kind: "deployment" },
        { kind: "package-published" },
        { kind: "package-updated" },
        { kind: "package-deleted" },
        { kind: "package-restored" },
      ]),
    ).toMatchObject({ workflows: 1, deployments: 1, packages: 2 });
  });

  it("rejects queue messages with unsafe evidence or unsupported lifecycle data", () => {
    const extraction = extractOperationsDelivery({
      eventType: "workflow_run",
      payload: workflowPayload(),
      deliveryId: "workflow-contract-1",
      receivedAt,
    });
    if (!extraction.ok) throw new Error("Expected extraction to succeed");
    const encoded = JSON.parse(JSON.stringify(extraction.message));

    expect(parseOperationsDeliveryMessage(encoded)).toEqual(extraction.message);
    expect(
      parseOperationsDeliveryMessage({
        ...encoded,
        operation: {
          ...encoded.operation,
          evidenceUrl: "https://logs.example/private",
          status: "unknown",
          title: "x".repeat(500),
        },
      }),
    ).toBeNull();
  });
});
