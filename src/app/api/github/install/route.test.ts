import { beforeEach, describe, expect, it, vi } from "vitest";

const authBoundary = vi.hoisted(() => ({ getSession: vi.fn() }));
const installationBoundary = vi.hoisted(() => ({ createState: vi.fn() }));

vi.mock("@/lib/session", () => ({
  getJournalSession: authBoundary.getSession,
}));
vi.mock("@/lib/github-installation", () => ({
  createGitHubInstallationState: installationBoundary.createState,
}));
vi.mock("@/lib/env", () => ({
  getRequiredEnv: vi.fn((name: string) => {
    if (name === "GITHUB_APP_SLUG") return "coding-journal-test";
    throw new Error(`Unexpected environment variable: ${name}`);
  }),
}));

import { GET } from "@/app/api/github/install/route";

describe("GitHub App installation start", () => {
  beforeEach(() => {
    authBoundary.getSession.mockReset();
    installationBoundary.createState.mockReset();
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
    expect(installationBoundary.createState).not.toHaveBeenCalled();
  });

  it("binds an opaque state to the user and starts the GitHub install flow", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    installationBoundary.createState.mockResolvedValue("opaque-state");

    const response = await GET(
      new Request("https://journal.example/api/github/install?from=settings"),
    );

    expect(installationBoundary.createState).toHaveBeenCalledWith(
      "user-1",
      "/settings",
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://github.com/apps/coding-journal-test/installations/new?state=opaque-state",
    );
  });
});
