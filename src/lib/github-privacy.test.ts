import { describe, expect, it } from "vitest";

import {
  extractGitHubAccessChange,
  extractGitHubAccessRestoration,
} from "@/lib/github-privacy";
import type { JsonObject } from "@/lib/json-payload";

const occurredAt = new Date("2026-09-01T12:00:00Z");

type AccessChangeCase = {
  eventType: string;
  payload: JsonObject;
  kind: string;
  installationId: string | null;
  repositoryIds: string[];
};

type RestorationCase = {
  eventType: string;
  payload: JsonObject;
  expected: {
    kind: string;
    installationId: string;
    repositoryIds: string[];
  };
};

const accessChangeCases: AccessChangeCase[] = [
  {
    eventType: "installation",
    payload: {
      action: "suspend",
      installation: { id: 99, account: { id: 7 } },
    },
    kind: "installation-suspended",
    installationId: "99",
    repositoryIds: [],
  },
  {
    eventType: "installation",
    payload: {
      action: "deleted",
      installation: { id: 99, account: { id: 7 } },
    },
    kind: "installation-removed",
    installationId: "99",
    repositoryIds: [],
  },
  {
    eventType: "installation_repositories",
    payload: {
      action: "removed",
      installation: { id: 99, account: { id: 7 } },
      repositories_removed: [{ id: 42, full_name: "PRIVATE/NAME" }],
    },
    kind: "repositories-removed",
    installationId: "99",
    repositoryIds: ["42"],
  },
  {
    eventType: "github_app_authorization",
    payload: { action: "revoked", sender: { id: 7, login: "PRIVATE" } },
    kind: "authorization-revoked",
    installationId: null,
    repositoryIds: [],
  },
];

describe("GitHub access change extraction", () => {
  it.each(accessChangeCases)(
    "extracts $kind using only bounded identifiers",
    (fixture) => {
      expect(
        extractGitHubAccessChange({
          eventType: fixture.eventType,
          payload: fixture.payload,
          deliveryId: "delivery-1",
          occurredAt,
        }),
      ).toEqual(
        expect.objectContaining({
          kind: fixture.kind,
          installationId: fixture.installationId,
          repositoryIds: fixture.repositoryIds,
        }),
      );
    },
  );
});

const restorationCases: RestorationCase[] = [
  {
    eventType: "installation",
    payload: { action: "unsuspend", installation: { id: 99 } },
    expected: {
      kind: "installation-unsuspended",
      installationId: "99",
      repositoryIds: [],
    },
  },
  {
    eventType: "installation_repositories",
    payload: {
      action: "added",
      installation: { id: 99 },
      repositories_added: [{ id: 42, full_name: "PRIVATE/NAME" }],
    },
    expected: {
      kind: "repositories-added",
      installationId: "99",
      repositoryIds: ["42"],
    },
  },
];

describe("GitHub access restoration extraction", () => {
  it.each(restorationCases)(
    "extracts $payload.action without repository metadata",
    (fixture) => {
      expect(extractGitHubAccessRestoration(fixture)).toEqual(fixture.expected);
    },
  );

  it("rejects an empty repositories-added event", () => {
    expect(
      extractGitHubAccessRestoration({
        eventType: "installation_repositories",
        payload: {
          action: "added",
          installation: { id: 99 },
          repositories_added: [],
        },
      }),
    ).toBeNull();
  });
});
