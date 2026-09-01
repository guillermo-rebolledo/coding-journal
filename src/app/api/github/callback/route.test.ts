import { beforeEach, describe, expect, it, vi } from "vitest";

const authBoundary = vi.hoisted(() => ({ getSession: vi.fn() }));
const neonBoundary = vi.hoisted(() => ({
  consumeState: vi.fn(),
  deletePending: vi.fn(),
  upsertActive: vi.fn(),
  setAccessMode: vi.fn(),
  insertPending: vi.fn(),
  markDisconnected: vi.fn(),
}));
const githubBoundary = vi.hoisted(() => ({
  getUserToken: vi.fn(),
  getInstallation: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getJournalSession: authBoundary.getSession,
}));
vi.mock("@/lib/github-installation-repository", () => ({
  consumeInstallationState: neonBoundary.consumeState,
  deletePendingInstallation: neonBoundary.deletePending,
  upsertActiveInstallation: neonBoundary.upsertActive,
  setGitHubAccessMode: neonBoundary.setAccessMode,
  insertPendingInstallation: neonBoundary.insertPending,
  markInstallationDisconnected: neonBoundary.markDisconnected,
  insertInstallationState: vi.fn(),
  findInstallations: vi.fn(),
}));
vi.mock("@/lib/github-app", () => ({
  getUserGitHubInstallation: githubBoundary.getInstallation,
}));
vi.mock("@/lib/github-user-token", () => ({
  getGitHubUserAccessToken: githubBoundary.getUserToken,
}));

import { GET } from "@/app/api/github/callback/route";

describe("GitHub App installation callback", () => {
  beforeEach(() => {
    authBoundary.getSession.mockReset();
    for (const boundary of Object.values(neonBoundary)) boundary.mockReset();
    githubBoundary.getUserToken.mockReset();
    githubBoundary.getInstallation.mockReset();
  });

  it("rejects a callback whose state is not valid for the signed-in user", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    neonBoundary.consumeState.mockResolvedValue(null);

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
    expect(neonBoundary.upsertActive).not.toHaveBeenCalled();
  });

  it("rejects an installation the GitHub user cannot access", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    neonBoundary.consumeState.mockResolvedValue({
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
    expect(neonBoundary.upsertActive).not.toHaveBeenCalled();
    expect(neonBoundary.markDisconnected).toHaveBeenCalledWith("user-1", "42");
  });

  it("persists selected-repository installation metadata without repository names", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    neonBoundary.consumeState.mockResolvedValue({
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

    expect(neonBoundary.deletePending).toHaveBeenCalledWith("user-1", "84");
    expect(neonBoundary.upsertActive).toHaveBeenCalledWith("user-1", {
      installationId: "42",
      accountId: "84",
      accountLogin: "example-org",
      accountType: "Organization",
      repositorySelection: "selected",
      repositoryCount: 3,
      permissions: { contents: "read", metadata: "read" },
    });
    expect(response.headers.get("location")).toBe(
      "https://journal.example/journal?github=connected",
    );
  });

  it("records an organization approval request explicitly", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    neonBoundary.consumeState.mockResolvedValue({
      returnTo: "/settings",
    });

    const response = await GET(
      new Request(
        "https://journal.example/api/github/callback?state=valid&setup_action=request&target_type=Organization&target_id=84",
      ),
    );

    expect(neonBoundary.deletePending).toHaveBeenCalledWith("user-1", "84");
    expect(neonBoundary.insertPending).toHaveBeenCalledWith("user-1", "84");
    expect(response.headers.get("location")).toBe(
      "https://journal.example/settings?github=pending",
    );
    expect(githubBoundary.getUserToken).not.toHaveBeenCalled();
  });

  it("rejects malformed callbacks without changing connection state", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    neonBoundary.consumeState.mockResolvedValue({
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
    expect(neonBoundary.upsertActive).not.toHaveBeenCalled();
  });

  it("rejects a pending callback that does not identify an organization", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    neonBoundary.consumeState.mockResolvedValue({ returnTo: "/settings" });

    const response = await GET(
      new Request(
        "https://journal.example/api/github/callback?state=valid&setup_action=request",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://journal.example/settings?github=invalid-callback",
    );
    expect(neonBoundary.insertPending).not.toHaveBeenCalled();
  });
});
