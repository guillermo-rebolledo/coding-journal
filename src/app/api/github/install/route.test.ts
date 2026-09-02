import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInstallStartRoute } from "@/app/api/github/install/handler";
import { createGitHubInstallationState } from "@/lib/github-installation";
import type { JournalSession } from "@/lib/session";
import { installationStore } from "~test/installation-store";
import { journalSession } from "~test/session-fixture";

const getSession =
  vi.fn<(headers: Headers) => Promise<JournalSession | null>>();
const store = installationStore();
const insertState = store.insertInstallationState;

// The real state builder runs against a stand-in store, so the token hashing
// this test asserts on is the production implementation.
const GET = createInstallStartRoute({
  getSession,
  createState: (userId, returnTo) =>
    createGitHubInstallationState(userId, returnTo, store),
});

describe("GitHub App installation start", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    getSession.mockReset();
    insertState.mockReset();
    insertState.mockResolvedValue(undefined);
    vi.stubEnv("GITHUB_APP_SLUG", "coding-journal-test");
  });

  it("returns signed-out users to the same authenticated Settings flow", async () => {
    getSession.mockResolvedValue(null);

    const response = await GET(
      new Request("https://journal.example/api/github/install?from=settings"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://journal.example/sign-in?next=%2Fsettings",
    );
    expect(insertState).not.toHaveBeenCalled();
  });

  it("binds an opaque state to the user and starts the GitHub install flow", async () => {
    getSession.mockResolvedValue(journalSession("user-1"));
    const response = await GET(
      new Request("https://journal.example/api/github/install?from=settings"),
    );

    expect(insertState).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        returnTo: "/settings",
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expiresAt: expect.any(Date),
      }),
    );
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(
      "https://github.com/apps/coding-journal-test/installations/new",
    );
    expect(location.searchParams.get("state")).toMatch(/^[\w-]{40,}$/);
    expect(insertState.mock.calls[0]?.[0].tokenHash).not.toBe(
      location.searchParams.get("state"),
    );
  });
});
