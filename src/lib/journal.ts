import { eq } from "drizzle-orm";

import { db } from "@/db";
import { journalOnboarding } from "@/db/auth-schema";

export type GitHubAccessMode = "best-effort" | "installed";

export type JournalOnboarding = {
  timeZone: string | null;
  githubAccessMode: GitHubAccessMode | null;
};

const emptyOnboarding: JournalOnboarding = {
  timeZone: null,
  githubAccessMode: null,
};

export async function getJournalOnboarding(
  userId: string,
): Promise<JournalOnboarding> {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_MODE === "true" &&
    userId === "e2e-user"
  ) {
    return {
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    };
  }

  return (
    (await db.query.journalOnboarding.findFirst({
      columns: { timeZone: true, githubAccessMode: true },
      where: eq(journalOnboarding.userId, userId),
    })) ?? emptyOnboarding
  );
}

export async function saveJournalTimeZone(userId: string, timeZone: string) {
  await db
    .insert(journalOnboarding)
    .values({ userId, timeZone })
    .onConflictDoUpdate({
      target: journalOnboarding.userId,
      set: { timeZone, updatedAt: new Date() },
    });
}

export async function chooseBestEffortMode(userId: string) {
  await db
    .insert(journalOnboarding)
    .values({ userId, githubAccessMode: "best-effort" })
    .onConflictDoUpdate({
      target: journalOnboarding.userId,
      set: { githubAccessMode: "best-effort", updatedAt: new Date() },
    });
}
