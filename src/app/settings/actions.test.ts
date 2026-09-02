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
  guard: vi.fn<DeleteAccountDependencies["guard"]>(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
};

function dependencies(): DeleteAccountDependencies {
  return {
    requestHeaders: new Headers(),
    getSession: boundaries.getSession,
    guard: boundaries.guard,
    deleteAccount: boundaries.deleteAccount,
    redirect: boundaries.redirect,
  };
}

function deleteAccount(formData: FormData) {
  return runDeleteAccount(formData, dependencies());
}

describe("account deletion action", () => {
  beforeEach(() => {
    boundaries.deleteAccount.mockReset().mockResolvedValue(undefined);
    boundaries.getSession
      .mockReset()
      .mockResolvedValue(journalSession("user-1"));
    boundaries.guard.mockReset().mockResolvedValue({ proceed: true });
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

  it("does not call the account adapter for an unconfirmed submit", async () => {
    const formData = new FormData();
    formData.set("confirmation", "delete");

    await expect(
      runDeleteAccount(formData, {
        ...dependencies(),
        deleteAccount: () =>
          Promise.reject(
            new Error("GITHUB_CLIENT_ID is required. See .env.example."),
          ),
      }),
    ).resolves.toBeUndefined();
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
    boundaries.guard.mockResolvedValue({
      proceed: false,
      refusal: {
        outcome: "limited",
        message: "Request limit reached.",
        resumeAt: new Date("2026-09-01T13:00:00Z"),
      },
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
    expect(boundaries.deleteAccount).toHaveBeenCalledWith(
      expect.any(Headers),
      "user-1",
    );
  });
});
