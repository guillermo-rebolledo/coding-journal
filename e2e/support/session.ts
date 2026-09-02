import type { BrowserContext } from "@playwright/test";

import { E2E_SESSION_COOKIE, type E2EMode } from "@/lib/e2e-fixtures";

/**
 * Signing in for real would need GitHub, so the browser tests carry the same
 * fixture session cookie the server recognises under `E2E_AUTH_MODE`. The
 * cookie name and the set of modes are imported rather than restated, so a new
 * fixture mode cannot drift away from the tests that drive it.
 */
export async function signIn(context: BrowserContext, session: E2EMode) {
  await context.addCookies([
    {
      name: E2E_SESSION_COOKIE,
      value: session,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
