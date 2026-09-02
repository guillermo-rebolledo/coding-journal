import { describe, expect, it } from "vitest";

import type { ActivityRecord } from "@/lib/github-activity";
import { githubRedactionPolicy } from "@/lib/github-redaction";

describe("GitHub access-change redaction policy", () => {
  it("redacts only private activities in repositories removed from access", () => {
    const privateActivity = {
      visibility: "private",
      repositoryId: "42",
      installationId: "9",
    } as ActivityRecord;

    const policy = githubRedactionPolicy({
      deliveryId: "delivery-1",
      kind: "repositories-removed",
      installationId: "9",
      accountId: null,
      repositoryIds: ["42"],
      occurredAt: new Date("2026-09-02T12:00:00.000Z"),
    });

    expect(policy.disconnectInstallation).toBe(false);
    expect(policy.revokeAuthorization).toBe(false);
    expect(policy.activityIsInaccessible(privateActivity)).toBe(true);
    expect(
      policy.activityIsInaccessible({
        ...privateActivity,
        visibility: "public",
      }),
    ).toBe(false);
  });
});
