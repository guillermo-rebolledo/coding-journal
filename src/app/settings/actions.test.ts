// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runDeleteAccount,
  type DeleteAccountDependencies,
} from "@/app/settings/delete-account";
import type { JournalSession } from "@/lib/session";
import { journalSession } from "~test/session-fixture";

const boundaries = {
  deleteAccount: vi.fn<DeleteAccountDependencies["deleteAccount"]>(),
  getSession: vi.fn<(headers: Headers) => Promise<JournalSession | null>>(),
  getToken: vi.fn<DeleteAccountDependencies["getAccessToken"]>(),
  spendBudget: vi.fn<DeleteAccountDependencies["spendBudget"]>(),
  endFixtureSession: vi.fn<() => Promise<void>>(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
};

function deleteAccount(formData: FormData) {
  return runDeleteAccount(formData, {
    requestHeaders: new Headers(),
    getSession: boundaries.getSession,
    spendBudget: boundaries.spendBudget,
    isFixtureUser: () => false,
    endFixtureSession: boundaries.endFixtureSession,
    getAccessToken: boundaries.getToken,
    deleteAccount: boundaries.deleteAccount,
    credentials: {
      clientId: "github-client",
      clientSecret: "github-secret",
    },
    redirect: boundaries.redirect,
  });
}

describe("account deletion action", () => {
  beforeEach(() => {
    boundaries.deleteAccount
      .mockReset()
      .mockResolvedValue({ deleted: true, providerRevoked: true });
    boundaries.getSession
      .mockReset()
      .mockResolvedValue(journalSession("user-1"));
    boundaries.getToken.mockReset().mockResolvedValue("provider-token");
    boundaries.endFixtureSession.mockReset().mockResolvedValue(undefined);
    boundaries.spendBudget.mockReset().mockResolvedValue(null);
    boundaries.redirect.mockClear();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("requires the exact destructive confirmation before authenticating", async () => {
    const formData = new FormData();
    formData.set("confirmation", "delete");

    await expect(deleteAccount(formData)).resolves.toBeUndefined();
    expect(boundaries.getSession).not.toHaveBeenCalled();
    expect(boundaries.deleteAccount).not.toHaveBeenCalled();
  });

  it("rejects a signed-out deletion request", async () => {
    boundaries.getSession.mockResolvedValue(null);
    const formData = new FormData();
    formData.set("confirmation", "DELETE");

    await expect(deleteAccount(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?next=%2Fsettings",
    );
    expect(boundaries.deleteAccount).not.toHaveBeenCalled();
  });

  it("refuses a repeated deletion request without touching the account", async () => {
    boundaries.spendBudget.mockResolvedValue({
      allowed: false,
      policy: "account-deletion",
      limit: 3,
      remaining: 0,
      retryAfterSeconds: 3600,
      resetAt: new Date("2026-09-01T13:00:00Z"),
    });
    const formData = new FormData();
    formData.set("confirmation", "DELETE");

    await expect(deleteAccount(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/settings?limited=deletion",
    );
    expect(boundaries.deleteAccount).not.toHaveBeenCalled();
  });

  it("derives identity from the session and removes the account", async () => {
    const formData = new FormData();
    formData.set("confirmation", "DELETE");

    await expect(deleteAccount(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/?account=deleted",
    );
    expect(boundaries.deleteAccount).toHaveBeenCalledWith({
      userId: "user-1",
      accessToken: "provider-token",
      clientId: "github-client",
      clientSecret: "github-secret",
    });
  });
});
