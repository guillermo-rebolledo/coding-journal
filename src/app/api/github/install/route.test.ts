import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authBoundary = vi.hoisted(() => ({ getSession: vi.fn() }));
const neonBoundary = vi.hoisted(() => ({ insertState: vi.fn() }));

vi.mock("@/lib/session", () => ({
  getJournalSession: authBoundary.getSession,
}));
vi.mock("@/lib/github-installation-repository", () => ({
  insertInstallationState: neonBoundary.insertState,
  consumeInstallationState: vi.fn(),
  deletePendingInstallation: vi.fn(),
  findInstallations: vi.fn(),
  insertPendingInstallation: vi.fn(),
  markInstallationDisconnected: vi.fn(),
  setGitHubAccessMode: vi.fn(),
  upsertActiveInstallation: vi.fn(),
}));

import { GET } from "@/app/api/github/install/route";

describe("GitHub App installation start", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    authBoundary.getSession.mockReset();
    neonBoundary.insertState.mockReset();
    neonBoundary.insertState.mockResolvedValue(undefined);
    vi.stubEnv("GITHUB_APP_SLUG", "coding-journal-test");
  });

  it("returns signed-out users to the same authenticated Settings flow", async () => {
    authBoundary.getSession.mockResolvedValue(null);

    const response = await GET(
      new Request("https://journal.example/api/github/install?from=settings"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://journal.example/sign-in?next=%2Fsettings",
    );
    expect(neonBoundary.insertState).not.toHaveBeenCalled();
  });

  it("binds an opaque state to the user and starts the GitHub install flow", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    const response = await GET(
      new Request("https://journal.example/api/github/install?from=settings"),
    );

    expect(neonBoundary.insertState).toHaveBeenCalledWith(
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
    expect(neonBoundary.insertState.mock.calls[0]?.[0].tokenHash).not.toBe(
      location.searchParams.get("state"),
    );
  });
});
