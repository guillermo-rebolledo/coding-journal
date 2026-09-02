import type { BrowserContext } from "@playwright/test";

export type FixtureSession =
  | "onboarding"
  | "valid"
  | "all"
  | "partial"
  | "pending"
  | "disconnected";

/**
 * Signing in for real would need GitHub, so the browser tests carry the same
 * fixture session cookie the server recognises under `E2E_AUTH_MODE`. Every
 * route, action, guard and redirect below it is the production path.
 */
export async function signIn(context: BrowserContext, session: FixtureSession) {
  await context.addCookies([
    {
      name: "coding-journal-e2e-session",
      value: session,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
