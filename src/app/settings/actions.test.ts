// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundaries = vi.hoisted(() => ({
  deleteAccount: vi.fn(),
  getSession: vi.fn(),
  getToken: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/account-deletion", () => ({
  deleteJournalAccount: boundaries.deleteAccount,
}));
vi.mock("@/lib/github-user-token", () => ({
  getGitHubUserAccessToken: boundaries.getToken,
}));
vi.mock("@/lib/session", () => ({ getJournalSession: boundaries.getSession }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ redirect: boundaries.redirect }));

import { deleteAccount } from "@/app/settings/actions";

describe("account deletion action", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_CLIENT_ID", "github-client");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "github-secret");
    boundaries.deleteAccount.mockReset().mockResolvedValue({ deleted: true });
    boundaries.getSession.mockReset().mockResolvedValue({
      user: { id: "user-1" },
      session: { id: "session-1" },
    });
    boundaries.getToken.mockReset().mockResolvedValue("provider-token");
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
