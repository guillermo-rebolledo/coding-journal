import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authBoundary = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}));

const journalBoundary = vi.hoisted(() => ({
  getOnboarding: vi.fn(),
  refreshConnections: vi.fn(),
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

vi.mock("@/lib/github-connection", () => ({
  refreshGitHubConnections: journalBoundary.refreshConnections,
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

import SettingsPage from "@/app/settings/page";
import { ThemeProvider } from "@/components/theme-provider";

describe("settings page", () => {
  beforeEach(() => {
    authBoundary.getSession.mockReset();
    journalBoundary.getOnboarding.mockReset();
    journalBoundary.refreshConnections.mockReset();
    authBoundary.getSession.mockResolvedValue({
      session: { id: "session-1", token: "server-only-token" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });
    journalBoundary.refreshConnections.mockResolvedValue([]);
    document.documentElement.classList.remove("light", "dark");
    delete document.documentElement.dataset.palette;
  });

  it("offers the theme palettes alongside GitHub access", async () => {
    render(
      <ThemeProvider storageKey={null} paletteStorageKey={null}>
        {await SettingsPage()}
      </ThemeProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "GitHub access" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Lavender/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Warm ink/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Tide/ })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Moss & clay/ }),
    ).toBeInTheDocument();
  });

  it("applies a chosen theme to the document", async () => {
    render(
      <ThemeProvider storageKey={null} paletteStorageKey={null}>
        {await SettingsPage()}
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("radio", { name: /Warm ink/ }));
    expect(document.documentElement.dataset.palette).toBe("warm-ink");
    expect(screen.getByRole("radio", { name: /Warm ink/ })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /Lavender/ }));
    expect(document.documentElement.dataset.palette).toBeUndefined();
  });

  it("redirects a signed-out visitor to the recoverable sign-in route", async () => {
    authBoundary.getSession.mockResolvedValue(null);

    await expect(SettingsPage()).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?next=%2Fsettings",
    );
  });
});
