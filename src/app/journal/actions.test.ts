import { beforeEach, describe, expect, it, vi } from "vitest";

const authBoundary = vi.hoisted(() => ({ getSession: vi.fn() }));
const journalBoundary = vi.hoisted(() => ({
  saveTimeZone: vi.fn(),
  chooseBestEffort: vi.fn(),
}));
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
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/navigation", () => ({ redirect: navigation.redirect }));

import {
  confirmTimeZone,
  skipGitHubAppInstallation,
} from "@/app/journal/actions";

describe("journal onboarding actions", () => {
  beforeEach(() => {
    authBoundary.getSession.mockReset();
    journalBoundary.saveTimeZone.mockReset();
    journalBoundary.chooseBestEffort.mockReset();
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
});
