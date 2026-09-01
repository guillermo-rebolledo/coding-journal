import { beforeEach, describe, expect, it, vi } from "vitest";

const authBoundary = vi.hoisted(() => ({ getSession: vi.fn() }));
const journalBoundary = vi.hoisted(() => ({
  saveTimeZone: vi.fn(),
  chooseBestEffort: vi.fn(),
  getOnboarding: vi.fn(),
}));
const installationBoundary = vi.hoisted(() => ({ getInstallations: vi.fn() }));
const activityBoundary = vi.hoisted(() => ({ read: vi.fn() }));
const todayBoundary = vi.hoisted(() => ({ getToday: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/session", () => ({
  getJournalSession: authBoundary.getSession,
}));
vi.mock("@/lib/journal", () => ({
  saveJournalTimeZone: journalBoundary.saveTimeZone,
  chooseBestEffortMode: journalBoundary.chooseBestEffort,
  getJournalOnboarding: journalBoundary.getOnboarding,
}));
vi.mock("@/lib/github-installation", () => ({
  getGitHubInstallations: installationBoundary.getInstallations,
}));
vi.mock("@/lib/github-activity-repository", () => ({
  githubActivityRepository: activityBoundary,
}));
vi.mock("@/lib/today-journal", () => ({
  getTodayJournal: todayBoundary.getToday,
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/navigation", () => ({ redirect: navigation.redirect }));

import {
  confirmTimeZone,
  refreshTodayJournal,
  skipGitHubAppInstallation,
} from "@/app/journal/actions";

describe("journal onboarding actions", () => {
  beforeEach(() => {
    authBoundary.getSession.mockReset();
    journalBoundary.saveTimeZone.mockReset();
    journalBoundary.chooseBestEffort.mockReset();
    journalBoundary.getOnboarding.mockReset();
    installationBoundary.getInstallations.mockReset();
    activityBoundary.read.mockReset();
    todayBoundary.getToday.mockReset();
    navigation.redirect.mockClear();
  });

  it("rejects an invalid time zone without persisting it", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    const formData = new FormData();
    formData.set("timeZone", "Not/A_Time_Zone");

    await expect(confirmTimeZone({ error: null }, formData)).resolves.toEqual({
      error: "Enter a valid IANA time zone.",
    });
    expect(journalBoundary.saveTimeZone).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated mutation before returning validation details", async () => {
    authBoundary.getSession.mockResolvedValue(null);
    const formData = new FormData();
    formData.set("timeZone", "Not/A_Time_Zone");

    await expect(confirmTimeZone({ error: null }, formData)).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?next=%2Fjournal",
    );
    expect(journalBoundary.saveTimeZone).not.toHaveBeenCalled();
  });

  it("persists a valid override for the authenticated user", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    const formData = new FormData();
    formData.set("timeZone", " Pacific/Auckland ");

    await expect(confirmTimeZone({ error: null }, formData)).rejects.toThrow(
      "NEXT_REDIRECT:/journal",
    );
    expect(journalBoundary.saveTimeZone).toHaveBeenCalledWith(
      "user-1",
      "Pacific/Auckland",
    );
  });

  it("persists the decision to continue without repository access", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });

    await expect(skipGitHubAppInstallation()).rejects.toThrow(
      "NEXT_REDIRECT:/journal",
    );
    expect(journalBoundary.chooseBestEffort).toHaveBeenCalledWith("user-1");
  });

  it("reloads stored activity but does not reconcile during cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:10:00Z"));
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });
    activityBoundary.read.mockResolvedValue({
      lastAttemptAt: new Date("2026-08-31T12:00:00Z"),
    });

    await expect(refreshTodayJournal()).resolves.toEqual({
      outcome: "cooldown",
      message: "Stored activity reloaded. GitHub sync is cooling down.",
      nextSyncAt: "2026-08-31T12:15:00.000Z",
    });
    expect(activityBoundary.read).toHaveBeenCalledWith("user-1", "2026-08-31");
    expect(todayBoundary.getToday).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("reconciles when eligible and reports GitHub rate limiting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:20:00Z"));
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-1" } });
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "app",
    });
    installationBoundary.getInstallations.mockResolvedValue([]);
    activityBoundary.read.mockResolvedValue({
      lastAttemptAt: new Date("2026-08-31T12:00:00Z"),
    });
    todayBoundary.getToday.mockResolvedValue({
      rateLimitedUntil: new Date("2026-08-31T12:45:00Z"),
    });

    await expect(refreshTodayJournal()).resolves.toEqual({
      outcome: "rate-limited",
      message: "Stored activity reloaded. GitHub rate limit reached.",
      nextSyncAt: "2026-08-31T12:45:00.000Z",
    });
    expect(todayBoundary.getToday).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
