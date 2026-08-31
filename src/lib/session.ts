import { auth } from "@/lib/auth";

const E2E_SESSION_COOKIE = "coding-journal-e2e-session=valid";

function hasE2ESession(requestHeaders: Headers) {
  return requestHeaders
    .get("cookie")
    ?.split(";")
    .map((cookie) => cookie.trim())
    .includes(E2E_SESSION_COOKIE);
}

export async function getJournalSession(requestHeaders: Headers) {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_MODE === "true" &&
    hasE2ESession(requestHeaders)
  ) {
    const now = new Date("2026-08-31T12:00:00.000Z");

    return {
      session: {
        id: "e2e-session",
        token: "e2e-token",
        userId: "e2e-user",
        expiresAt: new Date("2026-09-30T12:00:00.000Z"),
        createdAt: now,
        updatedAt: now,
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: "e2e-user",
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
