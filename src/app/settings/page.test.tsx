import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authBoundary = vi.hoisted(() => ({ getSession: vi.fn() }));
const journalBoundary = vi.hoisted(() => ({ getOnboarding: vi.fn() }));
const installationBoundary = vi.hoisted(() => ({ getInstallations: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/session", () => ({
  getJournalSession: authBoundary.getSession,
}));
vi.mock("@/lib/journal", () => ({
  getJournalOnboarding: journalBoundary.getOnboarding,
}));
vi.mock("@/lib/github-installation", () => ({
  getGitHubInstallations: installationBoundary.getInstallations,
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: navigation.redirect,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import SettingsPage from "@/app/settings/page";
import { ThemeProvider } from "@/components/theme-provider";

describe("GitHub access Settings", () => {
  beforeEach(() => {
    authBoundary.getSession.mockReset();
    journalBoundary.getOnboarding.mockReset();
    installationBoundary.getInstallations.mockReset();
    authBoundary.getSession.mockResolvedValue({
      user: { id: "user-1", name: "Ada Lovelace" },
    });
  });

  it("shows selected repository access as partial without exposing names", async () => {
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "app",
    });
    installationBoundary.getInstallations.mockResolvedValue([
      {
        installationId: "42",
        accountLogin: "example-org",
        accountType: "Organization",
        repositorySelection: "selected",
        repositoryCount: 3,
        status: "active",
      },
    ]);

    render(
      <ThemeProvider storageKey={null}>{await SettingsPage()}</ThemeProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "GitHub access" }),
    ).toBeVisible();
    expect(screen.getByText("Partial access")).toBeVisible();
    expect(screen.getByText("example-org")).toBeVisible();
    expect(screen.getByText(/3 selected repositories/)).toBeVisible();
    expect(
      screen.queryByText("private-repository-name"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Update repository access" }),
    ).toHaveAttribute("href", "/api/github/install?from=settings");
  });

  it("distinguishes all-repository, pending, and disconnected installations", async () => {
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "app",
    });
    installationBoundary.getInstallations.mockResolvedValue([
      {
        installationId: "10",
        accountLogin: "ada",
        accountType: "User",
        repositorySelection: "all",
        repositoryCount: 8,
        status: "active",
      },
      {
        installationId: null,
        accountLogin: null,
        accountType: null,
        repositorySelection: null,
        repositoryCount: null,
        status: "pending",
      },
      {
        installationId: "11",
        accountLogin: "old-org",
        accountType: "Organization",
        repositorySelection: "selected",
        repositoryCount: 2,
        status: "disconnected",
      },
    ]);

    render(
      <ThemeProvider storageKey={null}>{await SettingsPage()}</ThemeProvider>,
    );

    expect(screen.getByText("Installed")).toBeVisible();
    expect(screen.getByText("Pending approval")).toBeVisible();
    expect(screen.getByText("Disconnected")).toBeVisible();
  });

  it("labels skipped, preview-source, and reconciliation-only coverage", async () => {
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });
    installationBoundary.getInstallations.mockResolvedValue([]);

    render(
      <ThemeProvider storageKey={null}>{await SettingsPage()}</ThemeProvider>,
    );

    expect(screen.getByText("Skipped")).toBeVisible();
    expect(screen.getByText("Preview source")).toBeVisible();
    expect(screen.getByText("Reconciliation only")).toBeVisible();
  });

  it("protects Settings with a recoverable sign-in redirect", async () => {
    authBoundary.getSession.mockResolvedValue(null);

    await expect(SettingsPage()).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?next=%2Fsettings",
    );
  });
});
