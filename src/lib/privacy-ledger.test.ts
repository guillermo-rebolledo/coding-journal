import { describe, expect, it, vi } from "vitest";

import {
  privacyOperationStaleAfterMs,
  runPrivacyOperation,
  type PrivacyLedger,
} from "@/lib/privacy-ledger";

describe("privacy operation ledger", () => {
  it("runs work between one claim and one completion", async () => {
    const claim = {
      id: "operation-1",
      operationHash: "hash",
      claimToken: "token",
    };
    const ledger: PrivacyLedger = {
      claim: vi.fn().mockResolvedValue(claim),
      complete: vi.fn(),
      fail: vi.fn(),
    };

    await expect(
      runPrivacyOperation(
        ledger,
        { key: "retention:batch", kind: "retention", now: new Date(0) },
        async () => ({ deletedActivities: 3 }),
      ),
    ).resolves.toEqual({
      status: "completed",
      value: { deletedActivities: 3 },
    });
    expect(ledger.complete).toHaveBeenCalledWith(
      claim,
      { deletedActivities: 3 },
      new Date(0),
    );
    expect(ledger.fail).not.toHaveBeenCalled();
  });

  it("records an opaque failure id and lets the work error through", async () => {
    const claim = {
      id: "operation-1",
      operationHash: "hash",
      claimToken: "token",
    };
    const ledger: PrivacyLedger = {
      claim: vi.fn().mockResolvedValue(claim),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const failure = new Error("database unavailable");

    await expect(
      runPrivacyOperation(
        ledger,
        { key: "deletion:user", kind: "account-deletion", now: new Date(0) },
        async () => Promise.reject(failure),
      ),
    ).rejects.toBe(failure);
    expect(ledger.fail).toHaveBeenCalledWith(
      claim,
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      new Date(0),
    );
  });

  it("defines stuck once for claims and health", () => {
    expect(privacyOperationStaleAfterMs).toBe(15 * 60 * 1000);
  });
});
