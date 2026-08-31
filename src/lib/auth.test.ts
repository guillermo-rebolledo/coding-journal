import { describe, expect, it } from "vitest";

import { auth, githubProfileToUser } from "@/lib/auth";

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
});
