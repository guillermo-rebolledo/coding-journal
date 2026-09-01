import { auth } from "@/lib/auth";
import { getE2ESessionMode, getE2EUserId } from "@/lib/e2e-fixtures";

export async function getJournalSession(requestHeaders: Headers) {
  const e2eMode = getE2ESessionMode(requestHeaders);
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_MODE === "true" &&
    e2eMode
  ) {
    const now = new Date("2026-08-31T12:00:00.000Z");

    const userId = getE2EUserId(e2eMode);
    return {
      session: {
        id: "e2e-session",
        token: "e2e-token",
        userId,
        expiresAt: new Date("2026-09-30T12:00:00.000Z"),
        createdAt: now,
        updatedAt: now,
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: userId,
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
