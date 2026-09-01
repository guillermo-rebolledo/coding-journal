import { auth } from "@/lib/auth";

const E2E_SESSION_COOKIE = "coding-journal-e2e-session";
const e2eSessionModes = new Set([
  "valid",
  "all",
  "partial",
  "pending",
  "disconnected",
]);

function getE2ESessionMode(requestHeaders: Headers) {
  const value = requestHeaders
    .get("cookie")
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${E2E_SESSION_COOKIE}=`))
    ?.slice(E2E_SESSION_COOKIE.length + 1);

  return value && e2eSessionModes.has(value) ? value : null;
}

export async function getJournalSession(requestHeaders: Headers) {
  const e2eMode = getE2ESessionMode(requestHeaders);
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_MODE === "true" &&
    e2eMode
  ) {
    const now = new Date("2026-08-31T12:00:00.000Z");

    return {
      session: {
        id: "e2e-session",
        token: "e2e-token",
        userId: e2eMode === "valid" ? "e2e-user" : `e2e-${e2eMode}`,
        expiresAt: new Date("2026-09-30T12:00:00.000Z"),
        createdAt: now,
        updatedAt: now,
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: e2eMode === "valid" ? "e2e-user" : `e2e-${e2eMode}`,
        name: "Ada Lovelace",
        email: "ada@example.com",
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  return auth.api.getSession({ headers: requestHeaders });
}
