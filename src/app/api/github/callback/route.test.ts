import { beforeEach, describe, expect, it, vi } from "vitest";

const authBoundary = vi.hoisted(() => ({ getSession: vi.fn() }));
const installationBoundary = vi.hoisted(() => ({
  consumeState: vi.fn(),
  saveInstallation: vi.fn(),
  savePending: vi.fn(),
}));
const githubBoundary = vi.hoisted(() => ({
  getUserToken: vi.fn(),
  getInstallation: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getJournalSession: authBoundary.getSession,
}));
vi.mock("@/lib/github-installation", () => ({
  consumeGitHubInstallationState: installationBoundary.consumeState,
  saveGitHubInstallation: installationBoundary.saveInstallation,
  savePendingGitHubInstallation: installationBoundary.savePending,
}));
vi.mock("@/lib/github-app", () => ({
  getGitHubUserAccessToken: githubBoundary.getUserToken,
  getUserGitHubInstallation: githubBoundary.getInstallation,
}));

import { GET } from "@/app/api/github/callback/route";

describe("GitHub App installation callback", () => {
  beforeEach(() => {
    authBoundary.getSession.mockReset();
    installationBoundary.consumeState.mockReset();
    installationBoundary.saveInstallation.mockReset();
    installationBoundary.savePending.mockReset();
    githubBoundary.getUserToken.mockReset();
    githubBoundary.getInstallation.mockReset();
  });

  it("rejects a callback whose state is not valid for the signed-in user", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    installationBoundary.consumeState.mockResolvedValue(null);

    const response = await GET(
      new Request(
        "https://journal.example/api/github/callback?state=spoofed&installation_id=42",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://journal.example/journal?github=invalid-state",
    );
    expect(githubBoundary.getUserToken).not.toHaveBeenCalled();
    expect(installationBoundary.saveInstallation).not.toHaveBeenCalled();
  });

  it("rejects an installation the GitHub user cannot access", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    installationBoundary.consumeState.mockResolvedValue({
      returnTo: "/settings",
    });
    githubBoundary.getUserToken.mockResolvedValue("encrypted-at-rest-token");
    githubBoundary.getInstallation.mockResolvedValue(null);

    const response = await GET(
      new Request(
        "https://journal.example/api/github/callback?state=valid&installation_id=42",
      ),
    );

    expect(githubBoundary.getInstallation).toHaveBeenCalledWith(
      "encrypted-at-rest-token",
      "42",
    );
    expect(response.headers.get("location")).toBe(
      "https://journal.example/settings?github=invalid-installation",
    );
    expect(installationBoundary.saveInstallation).not.toHaveBeenCalled();
  });

  it("persists selected-repository installation metadata without repository names", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    installationBoundary.consumeState.mockResolvedValue({
      returnTo: "/journal",
    });
    githubBoundary.getUserToken.mockResolvedValue("server-token");
    githubBoundary.getInstallation.mockResolvedValue({
      installationId: "42",
      accountId: "84",
      accountLogin: "example-org",
      accountType: "Organization",
      repositorySelection: "selected",
      repositoryCount: 3,
      permissions: { contents: "read", metadata: "read" },
    });

    const response = await GET(
      new Request(
        "https://journal.example/api/github/callback?state=valid&installation_id=42",
      ),
    );

    expect(installationBoundary.saveInstallation).toHaveBeenCalledWith(
      "user-1",
      {
        installationId: "42",
        accountId: "84",
        accountLogin: "example-org",
        accountType: "Organization",
        repositorySelection: "selected",
        repositoryCount: 3,
        permissions: { contents: "read", metadata: "read" },
      },
    );
    expect(response.headers.get("location")).toBe(
      "https://journal.example/journal?github=connected",
    );
  });

  it("records an organization approval request explicitly", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    installationBoundary.consumeState.mockResolvedValue({
      returnTo: "/settings",
    });

    const response = await GET(
      new Request(
        "https://journal.example/api/github/callback?state=valid&setup_action=request",
      ),
    );

    expect(installationBoundary.savePending).toHaveBeenCalledWith("user-1");
    expect(response.headers.get("location")).toBe(
      "https://journal.example/settings?github=pending",
    );
    expect(githubBoundary.getUserToken).not.toHaveBeenCalled();
  });

  it("rejects malformed callbacks without changing connection state", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    installationBoundary.consumeState.mockResolvedValue({
      returnTo: "/journal",
    });

    const response = await GET(
      new Request(
        "https://journal.example/api/github/callback?state=valid&installation_id=not-a-number",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://journal.example/journal?github=invalid-callback",
    );
    expect(installationBoundary.saveInstallation).not.toHaveBeenCalled();
  });
});
