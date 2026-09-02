import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  renderSettingsPage,
  type SettingsPageDependencies,
} from "@/app/settings/settings-page";
import {
  AppServicesProvider,
  type AppServices,
} from "@/components/app-services";
import { ThemeProvider } from "@/components/theme-provider";
import type { JournalSession } from "@/lib/session";
import { journalSession } from "~test/session-fixture";

const authBoundary = {
  getSession: vi.fn<(headers: Headers) => Promise<JournalSession | null>>(),
  signOut: vi.fn<AppServices["session"]["signOut"]>(),
};
const journalBoundary = {
  getOnboarding: vi.fn<SettingsPageDependencies["getOnboarding"]>(),
  refreshConnections: vi.fn<SettingsPageDependencies["refreshConnections"]>(),
};
const navigation = {
  replace: vi.fn<(href: string) => void>(),
  refresh: vi.fn<() => void>(),
};

const services: AppServices = {
  navigation,
  session: { signOut: authBoundary.signOut },
};

function SettingsPage(
  options: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  } = {},
) {
  return renderSettingsPage(options.searchParams, {
    requestHeaders: new Headers(),
    getSession: authBoundary.getSession,
    getOnboarding: journalBoundary.getOnboarding,
    refreshConnections: journalBoundary.refreshConnections,
    redirect: (destination: string): never => {
      throw new Error(`NEXT_REDIRECT:${destination}`);
    },
  });
}

describe("settings page", () => {
  beforeEach(() => {
    authBoundary.getSession.mockReset();
    journalBoundary.getOnboarding.mockReset();
    journalBoundary.refreshConnections.mockReset();
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
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
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null} paletteStorageKey={null}>
          {await SettingsPage()}
        </ThemeProvider>
      </AppServicesProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "GitHub access" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Appearance" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Access and retention" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/retained for 30 days/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /choice is fixed after onboarding because changing it would move activity/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "GitHub App settings" }),
    ).toHaveAttribute("href", "https://github.com/settings/installations");
    expect(
      screen.getByRole("link", { name: "GitHub application settings" }),
    ).toHaveAttribute("href", "https://github.com/settings/applications");
    expect(
      screen.getByText(
        /permanently deletes your journal, summaries, settings/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /Type DELETE to confirm/i }),
    ).toBeRequired();
    expect(
      screen.getByRole("button", { name: "Delete my account" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Lavender/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Warm ink/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Tide/ })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Moss & clay/ }),
    ).toBeInTheDocument();
  });

  it("states a refused deletion in the destructive zone without hiding the action", async () => {
    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null} paletteStorageKey={null}>
          {await SettingsPage({
            searchParams: Promise.resolve({ limited: "deletion" }),
          })}
        </ThemeProvider>
      </AppServicesProvider>,
    );

    expect(
      screen.getByText("Request limit reached.", { selector: "p" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Settings and the journal stay available/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete my account" }),
    ).toBeInTheDocument();
  });

  it("applies a chosen theme to the document", async () => {
    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null} paletteStorageKey={null}>
          {await SettingsPage()}
        </ThemeProvider>
      </AppServicesProvider>,
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
