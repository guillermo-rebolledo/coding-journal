import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createGitHubCallbackRoute,
  type CallbackDependencies,
} from "@/app/api/github/callback/handler";
import {
  disconnectGitHubInstallation,
  saveGitHubInstallation,
  savePendingGitHubInstallation,
} from "@/lib/github-installation";
import type { JournalSession } from "@/lib/session";
import { installationStore } from "~test/installation-store";
import { journalSession } from "~test/session-fixture";

// The installation writes run through the real operations against a stand-in
// repository, so these assertions cover the production ordering and mapping.
const neonBoundary = installationStore();

const authBoundary = {
  getSession: vi.fn<(headers: Headers) => Promise<JournalSession | null>>(),
};
const githubBoundary = {
  getUserToken: vi.fn<CallbackDependencies["getAccessToken"]>(),
  getInstallation: vi.fn<CallbackDependencies["getInstallation"]>(),
};
const consumeState = vi.fn<CallbackDependencies["consumeState"]>();

const GET = createGitHubCallbackRoute({
  getSession: authBoundary.getSession,
  consumeState,
  getAccessToken: githubBoundary.getUserToken,
  getInstallation: githubBoundary.getInstallation,
  saveInstallation: (userId, details) =>
    saveGitHubInstallation(userId, details, neonBoundary),
  savePendingInstallation: (userId, accountId) =>
    savePendingGitHubInstallation(userId, accountId, neonBoundary),
  disconnectInstallation: (userId, installationId) =>
    disconnectGitHubInstallation(userId, installationId, neonBoundary),
});

describe("GitHub App installation callback", () => {
  beforeEach(() => {
    authBoundary.getSession.mockReset();
    consumeState.mockReset();
    for (const boundary of Object.values(neonBoundary)) boundary.mockReset();
    githubBoundary.getUserToken.mockReset();
    githubBoundary.getInstallation.mockReset();
  });

  it("rejects a callback whose state is not valid for the signed-in user", async () => {
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    consumeState.mockResolvedValue(null);

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
    expect(neonBoundary.upsertActiveInstallation).not.toHaveBeenCalled();
  });

  it("rejects an installation the GitHub user cannot access", async () => {
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    consumeState.mockResolvedValue({
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
    expect(neonBoundary.upsertActiveInstallation).not.toHaveBeenCalled();
    expect(neonBoundary.markInstallationDisconnected).toHaveBeenCalledWith(
      "user-1",
      "42",
    );
  });

  it("persists selected-repository installation metadata without repository names", async () => {
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    consumeState.mockResolvedValue({
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

    expect(neonBoundary.deletePendingInstallation).toHaveBeenCalledWith(
      "user-1",
      "84",
    );
    expect(neonBoundary.upsertActiveInstallation).toHaveBeenCalledWith(
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
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    consumeState.mockResolvedValue({
      returnTo: "/settings",
    });

    const response = await GET(
      new Request(
        "https://journal.example/api/github/callback?state=valid&setup_action=request&target_type=Organization&target_id=84",
      ),
    );

    expect(neonBoundary.deletePendingInstallation).toHaveBeenCalledWith(
      "user-1",
      "84",
    );
    expect(neonBoundary.insertPendingInstallation).toHaveBeenCalledWith(
      "user-1",
      "84",
    );
    expect(response.headers.get("location")).toBe(
      "https://journal.example/settings?github=pending",
    );
    expect(githubBoundary.getUserToken).not.toHaveBeenCalled();
  });

  it("rejects malformed callbacks without changing connection state", async () => {
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    consumeState.mockResolvedValue({
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
    expect(neonBoundary.upsertActiveInstallation).not.toHaveBeenCalled();
  });

  it("rejects a pending callback that does not identify an organization", async () => {
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    consumeState.mockResolvedValue({ returnTo: "/settings" });

    const response = await GET(
      new Request(
        "https://journal.example/api/github/callback?state=valid&setup_action=request",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://journal.example/settings?github=invalid-callback",
    );
    expect(neonBoundary.insertPendingInstallation).not.toHaveBeenCalled();
  });
});
