import { describe, expect, it, vi } from "vitest";

import type { JsonValue } from "@/lib/json-payload";
import { getUserGitHubInstallation } from "@/lib/github-app";
import { createGitHubHttpReadClient } from "@/lib/github-read-client";

function githubResponse(body: JsonValue, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GitHub installation API boundary", () => {
  it("recognizes a selected-repository organization installation", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        githubResponse({
          id: 42,
          account: { id: 84, login: "example-org", type: "Organization" },
          repository_selection: "selected",
          permissions: { contents: "read", metadata: "read" },
        }),
      )
      .mockResolvedValueOnce(githubResponse({ total_count: 3 }));

    await expect(
      getUserGitHubInstallation(
        "server-token",
        "42",
        createGitHubHttpReadClient("server-token", fetchImplementation),
      ),
    ).resolves.toEqual({
      installationId: "42",
      accountId: "84",
      accountLogin: "example-org",
      accountType: "Organization",
      repositorySelection: "selected",
      repositoryCount: 3,
      permissions: { contents: "read", metadata: "read" },
    });
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/user/installations/42",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer server-token",
        }),
      }),
    );
  });

  it("recognizes all-repository personal installations", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        githubResponse({
          id: 7,
          account: { id: 9, login: "ada", type: "User" },
          repository_selection: "all",
          permissions: { metadata: "read" },
        }),
      )
      .mockResolvedValueOnce(githubResponse({ total_count: 12 }));

    const result = await getUserGitHubInstallation(
      "server-token",
      "7",
      createGitHubHttpReadClient("server-token", fetchImplementation),
    );

    expect(result?.repositorySelection).toBe("all");
    expect(result?.accountType).toBe("User");
  });

  it("does not accept spoofed installation ids or elevated permissions", async () => {
    const mismatchedIdentity = vi.fn<typeof fetch>().mockResolvedValue(
      githubResponse({
        id: 99,
        account: { id: 9, login: "ada", type: "User" },
        repository_selection: "all",
        permissions: { metadata: "read" },
      }),
    );
    const elevatedPermissions = vi.fn<typeof fetch>().mockResolvedValue(
      githubResponse({
        id: 7,
        account: { id: 9, login: "ada", type: "User" },
        repository_selection: "all",
        permissions: { administration: "read", contents: "write" },
      }),
    );

    await expect(
      getUserGitHubInstallation(
        "token",
        "7",
        createGitHubHttpReadClient("token", mismatchedIdentity),
      ),
    ).resolves.toBeNull();
    await expect(
      getUserGitHubInstallation(
        "token",
        "7",
        createGitHubHttpReadClient("token", elevatedPermissions),
      ),
    ).resolves.toBeNull();

    const securityPermissions = vi.fn<typeof fetch>().mockResolvedValue(
      githubResponse({
        id: 7,
        account: { id: 9, login: "ada", type: "User" },
        repository_selection: "all",
        permissions: { metadata: "read", vulnerability_alerts: "read" },
      }),
    );
    await expect(
      getUserGitHubInstallation(
        "token",
        "7",
        createGitHubHttpReadClient("token", securityPermissions),
      ),
    ).resolves.toBeNull();
  });

  it("treats an installation hidden from the user as unavailable", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(githubResponse({ message: "Not Found" }, 404));

    await expect(
      getUserGitHubInstallation(
        "token",
        "7",
        createGitHubHttpReadClient("token", fetchImplementation),
      ),
    ).resolves.toBeNull();
  });
});
