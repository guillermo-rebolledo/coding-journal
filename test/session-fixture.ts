import type { JournalSession } from "@/lib/session";

const issuedAt = new Date("2026-08-31T12:00:00.000Z");

/**
 * A signed-in session for a unit test. It carries every member the real
 * session does, so a test never stands a partial object in for one.
 */
export function journalSession(userId: string): JournalSession {
  return {
    session: {
      id: `${userId}-session`,
      token: `${userId}-token`,
      userId,
      expiresAt: new Date("2026-09-30T12:00:00.000Z"),
      createdAt: issuedAt,
      updatedAt: issuedAt,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: userId,
      name: "Ada Lovelace",
      email: "ada@example.com",
      emailVerified: true,
      image: null,
      createdAt: issuedAt,
      updatedAt: issuedAt,
    },
  };
}
