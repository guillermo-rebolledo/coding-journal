import { describe, expect, it } from "vitest";

import {
  activityIdentity,
  collaborationKinds,
  createActivityRecord,
  operationsKinds,
  projectKinds,
  secondaryKinds,
  type ActivityIdentity,
} from "@/lib/github-activity";
import { getLocalDayWindow } from "@/lib/time-zone";

describe("GitHub activity record constructor", () => {
  it.each([
    [
      "push",
      activityIdentity.push("42", "1111111", "2222222"),
      "github:push:42:1111111:2222222",
    ],
    [
      "commit",
      activityIdentity.commit("42", "2222222"),
      "github:commit:42:2222222",
    ],
    ...collaborationKinds.map((kind) => [
      kind,
      activityIdentity.repository(kind, "42", "subject"),
      `github:${kind}:42:subject`,
    ]),
    ...operationsKinds.map((kind) => [
      kind,
      activityIdentity.repository(kind, "42", "subject"),
      `github:${kind}:42:subject`,
    ]),
    ...secondaryKinds.map((kind) => [
      kind,
      activityIdentity.global(kind, "subject"),
      `github:${kind}:subject`,
    ]),
    ...projectKinds.map((kind) => [
      kind,
      activityIdentity.project(kind, "project", "item", "delivery"),
      `github:${kind}:project:item:delivery`,
    ]),
  ] as Array<[string, ActivityIdentity, string]>)(
    "pins the %s storage key",
    (_kind, identity, expected) => {
      expect(identity.deduplicationKey).toBe(expected);
    },
  );

  it("derives the stable record invariants from domain input", () => {
    const window = getLocalDayWindow(
      new Date("2026-09-02T12:00:00.000Z"),
      "America/Mexico_City",
    );
    const record = createActivityRecord({
      kind: "commit",
      identity: activityIdentity.commit("42", "2222222"),
      evidence: { shape: "commit", sha: "2222222" },
      actor: { id: "7", login: "ada" },
      repository: { id: "42", name: "acme/api", private: true },
      subject: { id: "2222222", number: null, title: null },
      occurredAt: new Date("2026-09-02T04:59:59.000Z"),
      observedAt: new Date("2026-09-02T12:00:00.000Z"),
      source: "github-webhook",
      window,
      installationId: "99",
    });

    expect(record).toEqual(
      expect.objectContaining({
        deduplicationKey: "github:commit:42:2222222",
        evidenceUrl: "https://github.com/acme/api/commit/2222222",
        visibility: "private",
        localDate: "2026-09-02",
        authoredBeforeDay: true,
      }),
    );
  });
});
