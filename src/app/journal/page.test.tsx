import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authBoundary = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}));

const journalBoundary = vi.hoisted(() => ({
  getOnboarding: vi.fn(),
}));

const installationBoundary = vi.hoisted(() => ({
  getInstallations: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getJournalSession: authBoundary.getSession,
}));

vi.mock("@/lib/journal", () => ({
  getJournalOnboarding: journalBoundary.getOnboarding,
}));

vi.mock("@/lib/github-installation-repository", () => ({
  findInstallations: installationBoundary.getInstallations,
  consumeInstallationState: vi.fn(),
  deletePendingInstallation: vi.fn(),
  insertInstallationState: vi.fn(),
  insertPendingInstallation: vi.fn(),
  markInstallationDisconnected: vi.fn(),
  setGitHubAccessMode: vi.fn(),
  upsertActiveInstallation: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: authBoundary.signOut },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/navigation", () => ({
  redirect: navigation.redirect,
  useRouter: () => ({
    replace: navigation.replace,
    refresh: navigation.refresh,
  }),
}));

import JournalPage from "@/app/journal/page";
import { ThemeProvider } from "@/components/theme-provider";

describe("protected journal boundary", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    authBoundary.getSession.mockReset();
    authBoundary.signOut.mockReset();
    navigation.replace.mockReset();
    navigation.refresh.mockReset();
    journalBoundary.getOnboarding.mockReset();
    installationBoundary.getInstallations.mockReset();
    installationBoundary.getInstallations.mockResolvedValue([]);
  });

  it("shows a first-time user the browser-detected time zone", async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "en-US",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "America/Mexico_City",
    });
    authBoundary.getSession.mockResolvedValue({
      session: { id: "session-1", token: "server-only-token" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: null,
      githubAccessMode: null,
    });

    render(
      <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Start with your local day" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Your time zone")).toHaveValue(
        "America/Mexico_City",
      ),
    );
    expect(screen.getByText(/Detected from this browser/)).toBeInTheDocument();
    expect(screen.queryByText("server-only-token")).not.toBeInTheDocument();
  });

  it("resumes at repository access after the time zone is saved", async () => {
    authBoundary.getSession.mockResolvedValue({
      session: { id: "session-1", token: "server-only-token" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: null,
    });

    render(
      <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Choose what your journal can see" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/sign-in proves who you are/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Install GitHub App" }),
    ).toHaveAttribute("href", "/api/github/install?from=onboarding");
    expect(
      screen.getByRole("button", { name: "Continue in best-effort mode" }),
    ).toBeEnabled();
  });

  it("renders an empty Today journal with its local date and completeness", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    authBoundary.getSession.mockResolvedValue({
      session: { id: "session-1", token: "server-only-token" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });

    render(
      <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Today, Monday, August 31" }),
    ).toBeInTheDocument();
    expect(screen.getByText("America/Mexico_City")).toBeInTheDocument();
    expect(screen.getByText("Best-effort journal")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Your day is ready to take shape" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Review repository access" }),
    ).toBeInTheDocument();
  });

  it("labels selected GitHub App coverage as partial on Today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    authBoundary.getSession.mockResolvedValue({
      session: { id: "session-1", token: "server-only-token" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
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
      <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>,
    );

    expect(screen.getByText("Partial access")).toBeInTheDocument();
    expect(screen.getByText("3 selected repositories")).toBeInTheDocument();
  });

  it("keeps sign-out available after onboarding", async () => {
    authBoundary.getSession.mockResolvedValue({
      session: { id: "session-1", token: "server-only-token" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });

    render(
      <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>,
    );

    authBoundary.signOut.mockResolvedValue({
      data: { success: true },
      error: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(authBoundary.signOut).toHaveBeenCalledOnce());
    expect(navigation.replace).toHaveBeenCalledWith("/");
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("redirects a signed-out visitor to the recoverable sign-in route", async () => {
    authBoundary.getSession.mockResolvedValue(null);

    await expect(JournalPage()).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?next=%2Fjournal",
    );
  });
});
