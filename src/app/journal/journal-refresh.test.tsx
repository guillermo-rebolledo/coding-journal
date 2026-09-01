import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshBoundary = vi.hoisted(() => ({
  manualRefresh: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock("@/app/journal/actions", () => ({
  refreshTodayJournal: refreshBoundary.manualRefresh,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshBoundary.routerRefresh }),
}));

import { JournalRefresh } from "@/app/journal/journal-refresh";

describe("Today refresh controls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshBoundary.manualRefresh.mockReset();
    refreshBoundary.routerRefresh.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("reloads stored data every 30 minutes while visible without reconciling", () => {
    render(<JournalRefresh nextSyncAt={null} timeZone="America/Mexico_City" />);

    act(() => vi.advanceTimersByTime(30 * 60 * 1000));

    expect(refreshBoundary.routerRefresh).toHaveBeenCalledOnce();
    expect(refreshBoundary.manualRefresh).not.toHaveBeenCalled();
  });

  it("always reloads after a manual cooldown response and announces availability", async () => {
    vi.useRealTimers();
    refreshBoundary.manualRefresh.mockResolvedValue({
      outcome: "cooldown",
      message: "Stored activity reloaded. GitHub sync is cooling down.",
      nextSyncAt: "2026-08-31T12:15:00.000Z",
    });
    render(<JournalRefresh nextSyncAt={null} timeZone="America/Mexico_City" />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh Today" }));
    await waitFor(() =>
      expect(refreshBoundary.routerRefresh).toHaveBeenCalled(),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Stored activity reloaded. GitHub sync is cooling down.",
    );
    expect(screen.getByText(/Next GitHub sync/)).toBeInTheDocument();
  });

  it("still reloads stored activity when GitHub reconciliation fails", async () => {
    vi.useRealTimers();
    refreshBoundary.manualRefresh.mockRejectedValue(new Error("offline"));
    render(<JournalRefresh nextSyncAt={null} timeZone="America/Mexico_City" />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh Today" }));
    await waitFor(() =>
      expect(refreshBoundary.routerRefresh).toHaveBeenCalled(),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Stored activity is reloading. GitHub sync could not start.",
    );
  });
});
