import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import JournalDayError from "@/app/journal/history/[localDate]/error";
import JournalDayNotFound from "@/app/journal/history/[localDate]/not-found";
import {
  AppServicesProvider,
  type AppServices,
} from "@/components/app-services";
import { ThemeProvider } from "@/components/theme-provider";

const retry = vi.fn();
const services: AppServices = {
  navigation: { replace: vi.fn(), refresh: vi.fn() },
  session: { signOut: vi.fn(async () => ({})) },
};

function renderBoundary(boundary: React.ReactNode) {
  return render(
    <AppServicesProvider services={services}>
      <ThemeProvider storageKey={null}>{boundary}</ThemeProvider>
    </AppServicesProvider>,
  );
}

describe("journal day route boundaries", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    retry.mockReset();
  });

  it("turns a missing day into a themed journal recovery route", () => {
    renderBoundary(<JournalDayNotFound />);

    expect(
      screen.getByRole("heading", {
        name: "This journal day is no longer here",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to History" }),
    ).toHaveAttribute("href", "/journal/history");
    expect(screen.getByRole("link", { name: "Go to Today" })).toHaveAttribute(
      "href",
      "/journal",
    );
    expect(document.title).toBe("Journal day unavailable · Coding Journal");
  });

  it("offers retry and the same navigation after an unexpected error", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderBoundary(
      <JournalDayError error={new Error("render failed")} retry={retry} />,
    );

    expect(
      screen.getByRole("heading", { name: "This journal day could not open" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("link", { name: "Back to History" }),
    ).toHaveAttribute("href", "/journal/history");
    expect(screen.getByRole("link", { name: "Go to Today" })).toHaveAttribute(
      "href",
      "/journal",
    );
  });
});
