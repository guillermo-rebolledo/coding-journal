// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { JsonObject } from "@/lib/json-payload";
import {
  extractProjectsDelivery,
  normalizeProjectsMessage,
  parseProjectsDeliveryMessage,
} from "@/lib/github-projects";

const receivedAt = new Date("2026-08-31T12:05:00.000Z");

/**
 * A preview Projects payload. `omit` drops a member entirely, which is how the
 * preview schema differs between deliveries — an absent member is not the same
 * as one present and empty.
 */
function projectPayload(
  overrides: JsonObject = {},
  omit: readonly string[] = [],
): JsonObject {
  const payload: JsonObject = {
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
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => !omit.includes(key)),
  );
}

describe("GitHub organization Projects preview contract", () => {
  it("normalizes supported organization project changes as best-effort metadata", () => {
    const extraction = extractProjectsDelivery({
      eventType: "projects_v2",
      payload: projectPayload(),
      deliveryId: "project-delivery-1",
      receivedAt,
    });

    expect(extraction).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.objectContaining({
          project: expect.objectContaining({
            kind: "project-updated",
            organizationLogin: "acme",
            title: "Engineering roadmap",
            evidenceUrl: "https://github.com/orgs/acme/projects/12",
            completeness: "best-effort",
          }),
        }),
      }),
    );
    expect(JSON.stringify(extraction)).not.toContain("PRIVATE ROADMAP");

    if (!extraction.ok) throw new Error("Expected extraction to succeed");
    expect(
      normalizeProjectsMessage(extraction.message, {
        githubAccountId: "7",
        timeZone: "America/Mexico_City",
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "project-updated",
        repositoryName: "acme/Projects",
        subjectId: "PVT_kwDOA1",
        subjectNumber: 12,
        subjectTitle: "Engineering roadmap",
        source: "github-projects-preview",
      }),
    ]);
  });

  it("absorbs a preview object rename without changing the canonical message", () => {
    const extraction = extractProjectsDelivery({
      eventType: "projects_v2",
      payload: projectPayload(
        {
          project_v2: {
            id: 501,
            nodeId: "PVT_kwDOA1",
            number: 12,
            title: "Engineering roadmap",
            htmlUrl: "https://github.com/orgs/acme/projects/12",
          },
        },
        ["projects_v2"],
      ),
      deliveryId: "project-delivery-2",
      receivedAt,
    });

    expect(extraction).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.objectContaining({
          project: expect.objectContaining({
            subjectId: "PVT_kwDOA1",
            evidenceUrl: "https://github.com/orgs/acme/projects/12",
          }),
        }),
      }),
    );
  });

  it("normalizes the documented item create/delete actions and excludes personal Projects", () => {
    const addedItem = extractProjectsDelivery({
      eventType: "projects_v2_item",
      payload: {
        action: "created",
        organization: { id: 84, login: "acme" },
        sender: { id: 7, login: "ada", type: "User" },
        installation: { id: 99 },
        projects_v2_item: {
          id: 601,
          node_id: "PVTI_kwDOB2",
          project_node_id: "PVT_kwDOA1",
        },
        content: { body: "PRIVATE PROJECT NOTE" },
      },
      deliveryId: "project-item-delivery-1",
      receivedAt,
    });
    // A personal project carries a `user` boundary where an organization
    // project carries `organization`.
    const personal = extractProjectsDelivery({
      eventType: "projects_v2",
      payload: {
        ...projectPayload({}, ["organization"]),
        user: { id: 7, login: "ada" },
      },
      deliveryId: "personal-project-delivery-1",
      receivedAt,
    });

    const deletedItem = extractProjectsDelivery({
      eventType: "projects_v2_item",
      payload: {
        action: "deleted",
        organization: { id: 84, login: "acme" },
        sender: { id: 7, login: "ada", type: "User" },
        installation: { id: 99 },
        projects_v2_item: {
          id: 602,
          node_id: "PVTI_kwDOB3",
          project_node_id: "PVT_kwDOA1",
        },
      },
      deliveryId: "project-item-delivery-2",
      receivedAt,
    });

    expect(addedItem).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.objectContaining({
          project: expect.objectContaining({ kind: "project-item-added" }),
        }),
      }),
    );
    expect(deletedItem).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.objectContaining({
          project: expect.objectContaining({ kind: "project-item-deleted" }),
        }),
      }),
    );
    expect(JSON.stringify(addedItem)).not.toContain("PRIVATE PROJECT NOTE");
    expect(personal).toEqual({ ok: false, reason: "no-activity" });
  });

  it("rejects unknown preview actions and incompatible queued messages", () => {
    expect(
      extractProjectsDelivery({
        eventType: "projects_v2_item",
        payload: {
          ...projectPayload(),
          action: "future_action",
          projects_v2_item: { id: 601, node_id: "PVTI_kwDOB2" },
        },
        deliveryId: "project-future-1",
        receivedAt,
      }),
    ).toEqual({ ok: false, reason: "no-activity" });
    expect(parseProjectsDeliveryMessage({ version: 999 })).toBeNull();
  });
});
