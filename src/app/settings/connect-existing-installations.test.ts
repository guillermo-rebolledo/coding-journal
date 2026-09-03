// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  runConnectExistingGitHubInstallations,
  type ConnectExistingInstallationsDependencies,
} from "@/app/settings/connect-existing-installations";
import { createInMemoryGitHubReadClient } from "@/lib/github-read-client";
import type { JournalSession } from "@/lib/session";
import { installationStore } from "~test/installation-store";
import { journalSession } from "~test/session-fixture";

describe("existing GitHub App installation connection", () => {
  it("connects a pre-existing installation without asking GitHub to change it", async () => {
    const store = installationStore();
    const github = createInMemoryGitHubReadClient({
      actor: { id: 7, login: "ada" },
      userInstallations: [{ id: 42, app_slug: "coding-journal" }],
      installations: {
        "42": {
          id: 42,
          app_slug: "coding-journal",
          account: { id: 84, login: "example-org", type: "Organization" },
          repository_selection: "selected",
          permissions: { contents: "read", metadata: "read" },
        },
      },
      installationRepositories: { "42": [{ id: 1 }, { id: 2 }] },
    });
    const getSession = vi
      .fn<(headers: Headers) => Promise<JournalSession | null>>()
      .mockResolvedValue(journalSession("user-1"));
    const dependencies: ConnectExistingInstallationsDependencies = {
      requestHeaders: new Headers(),
      appSlug: "coding-journal",
      getSession,
      getUserAccess: async () => ({
        accessToken: "server-token",
        accountId: "7",
      }),
      createClient: () => github,
      store,
      redirect: (destination): never => {
        throw new Error(`NEXT_REDIRECT:${destination}`);
      },
    };

    await expect(
      runConnectExistingGitHubInstallations(dependencies),
    ).rejects.toThrow("NEXT_REDIRECT:/settings?github=connected");
    expect(store.upsertActiveInstallation).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        installationId: "42",
        repositorySelection: "selected",
        repositoryCount: 2,
      }),
    );
    expect(store.setGitHubAccessMode).toHaveBeenCalledWith("user-1");
  });

  it("asks the user to renew GitHub authorization when no user token is available", async () => {
    const store = installationStore();
    const github = createInMemoryGitHubReadClient({
      actor: { id: 7, login: "ada" },
    });

    await expect(
      runConnectExistingGitHubInstallations({
        requestHeaders: new Headers(),
        appSlug: "coding-journal",
        getSession: async () => journalSession("user-1"),
        getUserAccess: async () => null,
        createClient: () => github,
        store,
        redirect: (destination): never => {
          throw new Error(`NEXT_REDIRECT:${destination}`);
        },
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/settings?github=reauthorize");
    expect(store.upsertActiveInstallation).not.toHaveBeenCalled();
  });

  it("does not associate an existing installation with write access", async () => {
    const store = installationStore();
    const github = createInMemoryGitHubReadClient({
      actor: { id: 7, login: "ada" },
      userInstallations: [{ id: 42, app_slug: "coding-journal" }],
      installations: {
        "42": {
          id: 42,
          app_slug: "coding-journal",
          account: { id: 7, login: "ada", type: "User" },
          repository_selection: "all",
          permissions: { contents: "write", metadata: "read" },
        },
      },
    });

    await expect(
      runConnectExistingGitHubInstallations({
        requestHeaders: new Headers(),
        appSlug: "coding-journal",
        getSession: async () => journalSession("user-1"),
        getUserAccess: async () => ({
          accessToken: "server-token",
          accountId: "7",
        }),
        createClient: () => github,
        store,
        redirect: (destination): never => {
          throw new Error(`NEXT_REDIRECT:${destination}`);
        },
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/settings?github=invalid-installation");
    expect(store.upsertActiveInstallation).not.toHaveBeenCalled();
    expect(store.setGitHubAccessMode).not.toHaveBeenCalled();
  });

  it("reports a linked identity mismatch without inspecting installations", async () => {
    const store = installationStore();
    const github = createInMemoryGitHubReadClient({
      actor: { id: 8, login: "grace" },
      userInstallations: [{ id: 42, app_slug: "coding-journal" }],
    });

    await expect(
      runConnectExistingGitHubInstallations({
        requestHeaders: new Headers(),
        appSlug: "coding-journal",
        getSession: async () => journalSession("user-1"),
        getUserAccess: async () => ({
          accessToken: "server-token",
          accountId: "7",
        }),
        createClient: () => github,
        store,
        redirect: (destination): never => {
          throw new Error(`NEXT_REDIRECT:${destination}`);
        },
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/settings?github=identity-mismatch");
    expect(store.upsertActiveInstallation).not.toHaveBeenCalled();
  });

  it("distinguishes a storage failure from GitHub unavailability", async () => {
    const store = installationStore();
    store.upsertActiveInstallation.mockRejectedValue(
      new Error("database down"),
    );
    const github = createInMemoryGitHubReadClient({
      actor: { id: 7, login: "ada" },
      userInstallations: [{ id: 42, app_slug: "coding-journal" }],
      installations: {
        "42": {
          id: 42,
          app_slug: "coding-journal",
          account: { id: 7, login: "ada", type: "User" },
          repository_selection: "all",
          permissions: { contents: "read", metadata: "read" },
        },
      },
    });

    await expect(
      runConnectExistingGitHubInstallations({
        requestHeaders: new Headers(),
        appSlug: "coding-journal",
        getSession: async () => journalSession("user-1"),
        getUserAccess: async () => ({
          accessToken: "server-token",
          accountId: "7",
        }),
        createClient: () => github,
        store,
        redirect: (destination): never => {
          throw new Error(`NEXT_REDIRECT:${destination}`);
        },
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/settings?github=connection-failed");
  });
});
