import { describe, expect, it } from "vitest";

import {
  createInMemoryPrivacyLedger,
  privacyOperationStaleAfterMs,
  runPrivacyOperation,
} from "@/lib/privacy-ledger";

describe("privacy operation ledger", () => {
  it("runs work between one claim and one completion", async () => {
    const ledger = createInMemoryPrivacyLedger();
    const input = {
      key: "retention:batch",
      kind: "retention" as const,
      now: new Date(0),
    };

    await expect(
      runPrivacyOperation(ledger, input, async () => ({
        deletedActivities: 3,
        hasMore: true,
      })),
    ).resolves.toMatchObject({ status: "completed" });
    expect(ledger.find(input.key)).toMatchObject({
      status: "complete",
      counts: { deletedActivities: 3 },
    });
    expect(ledger.find(input.key)?.counts).not.toHaveProperty("hasMore");
  });

  it("records an opaque failure id and lets the work error through", async () => {
    const ledger = createInMemoryPrivacyLedger();
    const input = {
      key: "deletion:user",
      kind: "account-deletion" as const,
      now: new Date(0),
    };
    const failure = new Error("database unavailable");

    await expect(
      runPrivacyOperation(ledger, input, async () => Promise.reject(failure)),
    ).rejects.toBe(failure);
    expect(ledger.find(input.key)).toMatchObject({
      status: "failed",
      errorId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it("defines stuck once for claims and health", () => {
    expect(privacyOperationStaleAfterMs).toBe(15 * 60 * 1000);
  });
});
