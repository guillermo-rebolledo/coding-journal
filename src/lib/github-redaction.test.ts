import { describe, expect, it, vi } from "vitest";

import type { ActivityRecord } from "@/lib/github-activity";
import { runGitHubRedaction } from "@/lib/github-redaction";
import type { PrivacyLedger } from "@/lib/privacy-ledger";

describe("GitHub access-change redaction policy", () => {
  it("redacts only private activities in repositories removed from access", async () => {
    const claim = { id: "1", operationHash: "hash", claimToken: "token" };
    const ledger: PrivacyLedger = {
      claim: vi.fn().mockResolvedValue(claim),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const privateActivity = {
      visibility: "private",
      repositoryId: "42",
      installationId: "9",
    } as ActivityRecord;

    const result = await runGitHubRedaction(
      {
        deliveryId: "delivery-1",
        kind: "repositories-removed",
        installationId: "9",
        accountId: null,
        repositoryIds: ["42"],
        occurredAt: new Date("2026-09-02T12:00:00.000Z"),
      },
      ledger,
      async (policy) => {
        expect(policy.disconnectInstallation).toBe(false);
        expect(policy.revokeAuthorization).toBe(false);
        expect(policy.activityIsInaccessible(privateActivity)).toBe(true);
        expect(
          policy.activityIsInaccessible({
            ...privateActivity,
            visibility: "public",
          }),
        ).toBe(false);
        return { affectedUsers: 1, deletedActivities: 1 };
      },
      new Date("2026-09-02T12:05:00.000Z"),
    );

    expect(result).toEqual({
      status: "completed",
      value: { affectedUsers: 1, deletedActivities: 1 },
    });
    expect(ledger.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        now: new Date("2026-09-02T12:05:00.000Z"),
      }),
    );
  });
});
