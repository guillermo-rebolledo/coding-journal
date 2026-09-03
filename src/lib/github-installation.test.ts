import { describe, expect, it } from "vitest";

import { associateExistingGitHubInstallations } from "@/lib/github-installation";
import { createInMemoryGitHubReadClient } from "@/lib/github-read-client";
import { installationStore } from "~test/installation-store";

describe("existing GitHub App installation association", () => {
  it("associates an existing read-only installation without changing its repository selection", async () => {
    const store = installationStore();
    const github = createInMemoryGitHubReadClient({
      actor: { id: 7, login: "ada" },
      userInstallations: [
        { id: 42, app_slug: "coding-journal" },
        { id: 43, app_slug: "another-app" },
        { id: 44, app_slug: "coding-journal" },
      ],
      installations: {
        "42": {
          id: 42,
          app_slug: "coding-journal",
          account: { id: 84, login: "example-org", type: "Organization" },
          repository_selection: "selected",
          permissions: { contents: "read", metadata: "read" },
        },
        "44": {
          id: 44,
          app_slug: "coding-journal",
          account: { id: 7, login: "ada", type: "User" },
          repository_selection: "all",
          permissions: { contents: "write", metadata: "read" },
        },
      },
      installationRepositories: {
        "42": [{ id: 1 }, { id: 2 }, { id: 3 }],
      },
    });

    await expect(
      associateExistingGitHubInstallations(
        "user-1",
        { accessToken: "server-token", accountId: "7" },
        "coding-journal",
        github,
        store,
      ),
    ).resolves.toEqual({
      identityVerified: true,
      connectedCount: 1,
      rejectedCount: 1,
    });
    expect(store.upsertActiveInstallation).toHaveBeenCalledTimes(1);
    expect(store.upsertActiveInstallation).toHaveBeenCalledWith("user-1", {
      installationId: "42",
      accountId: "84",
      accountLogin: "example-org",
      accountType: "Organization",
      repositorySelection: "selected",
      repositoryCount: 3,
      permissions: { contents: "read", metadata: "read" },
    });
    expect(store.setGitHubAccessMode).toHaveBeenCalledWith("user-1");
  });

  it("does not inspect or save installations for a different linked GitHub identity", async () => {
    const store = installationStore();
    const github = createInMemoryGitHubReadClient({
      actor: { id: 8, login: "grace" },
      userInstallations: [{ id: 42, app_slug: "coding-journal" }],
    });

    await expect(
      associateExistingGitHubInstallations(
        "user-1",
        { accessToken: "server-token", accountId: "7" },
        "coding-journal",
        github,
        store,
      ),
    ).resolves.toEqual({
      identityVerified: false,
      connectedCount: 0,
      rejectedCount: 0,
    });
    expect(store.upsertActiveInstallation).not.toHaveBeenCalled();
    expect(store.setGitHubAccessMode).not.toHaveBeenCalled();
  });
});
