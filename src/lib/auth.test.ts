import { describe, expect, it } from "vitest";

import { auth, getTrustedOrigins, githubProfileToUser } from "@/lib/auth";

describe("GitHub authentication boundary", () => {
  it("creates a non-routable identity when GitHub keeps the email private", () => {
    expect(githubProfileToUser({ id: 4382, email: null })).toEqual({
      email: "4382@github.placeholder.invalid",
    });
  });

  it("encrypts provider tokens before storing an account", () => {
    expect(auth.options.account?.encryptOAuthTokens).toBe(true);
  });

  it("does not expose provider-token endpoints to the browser", () => {
    expect(auth.options.disabledPaths).toEqual(
      expect.arrayContaining([
        "/get-access-token",
        "/refresh-token",
        "/account-info",
      ]),
    );
  });

  it("trusts only the exact Vercel deployment origins", () => {
    expect(
      getTrustedOrigins({
        BETTER_AUTH_URL: "https://coding-journal.vercel.app/",
        VERCEL_URL:
          "coding-journal-4m9g89bve-guillermo-ortizs-projects.vercel.app",
        VERCEL_BRANCH_URL:
          "coding-journal-git-main-guillermo-ortizs-projects.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "coding-journal.vercel.app",
      }),
    ).toEqual([
      "https://coding-journal.vercel.app",
      "https://coding-journal-4m9g89bve-guillermo-ortizs-projects.vercel.app",
      "https://coding-journal-git-main-guillermo-ortizs-projects.vercel.app",
    ]);
  });

  it("rejects malformed and non-Vercel deployment hosts", () => {
    expect(
      getTrustedOrigins({
        BETTER_AUTH_URL: "https://coding-journal.vercel.app",
        VERCEL_URL: "attacker.example.com",
        VERCEL_BRANCH_URL: "https://coding-journal.vercel.app/redirect",
        VERCEL_PROJECT_PRODUCTION_URL: "coding-journal.vercel.app:444",
      }),
    ).toEqual(["https://coding-journal.vercel.app"]);
    expect(
      getTrustedOrigins({
        BETTER_AUTH_URL: "https://coding-journal.vercel.app",
        VERCEL_URL: "*.vercel.app",
      }),
    ).toEqual(["https://coding-journal.vercel.app"]);
  });
});
