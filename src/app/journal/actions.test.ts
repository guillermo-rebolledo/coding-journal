import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  runConfirmTimeZone,
  runSkipGitHubAppInstallation,
  type OnboardingActionDependencies,
} from "@/app/journal/onboarding-actions";
import type { JournalSession } from "@/lib/session";
import { journalSession } from "~test/session-fixture";

const authBoundary = {
  getSession: vi.fn<(headers: Headers) => Promise<JournalSession | null>>(),
};
const journalBoundary = {
  saveTimeZone: vi.fn<OnboardingActionDependencies["saveTimeZone"]>(),
  chooseBestEffort: vi.fn<OnboardingActionDependencies["chooseBestEffort"]>(),
};
const navigation = {
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
};

function dependencies(): OnboardingActionDependencies {
  return {
    requestHeaders: new Headers(),
    getSession: authBoundary.getSession,
    saveTimeZone: journalBoundary.saveTimeZone,
    chooseBestEffort: journalBoundary.chooseBestEffort,
    redirect: navigation.redirect,
  };
}

function confirmTimeZone(
  _previousState: { error: string | null },
  formData: FormData,
) {
  return runConfirmTimeZone(formData, dependencies());
}

function skipGitHubAppInstallation() {
  return runSkipGitHubAppInstallation(dependencies());
}

describe("journal onboarding actions", () => {
  beforeEach(() => {
    authBoundary.getSession.mockReset();
    journalBoundary.saveTimeZone.mockReset();
    journalBoundary.chooseBestEffort.mockReset();
    navigation.redirect.mockClear();
  });

  it("rejects an invalid time zone without persisting it", async () => {
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
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
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
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
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));

    await expect(skipGitHubAppInstallation()).rejects.toThrow(
      "NEXT_REDIRECT:/journal",
    );
    expect(journalBoundary.chooseBestEffort).toHaveBeenCalledWith("user-1");
  });
});
