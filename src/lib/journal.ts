import { eq } from "drizzle-orm";

import { db } from "@/db";
import { journalOnboarding } from "@/db/auth-schema";
import type { IanaTimeZone } from "@/lib/time-zone";

export type GitHubAccessMode = "best-effort" | "app";

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

type OnboardingPatch = Partial<
  Pick<typeof journalOnboarding.$inferInsert, "timeZone" | "githubAccessMode">
>;

async function upsertJournalOnboarding(userId: string, patch: OnboardingPatch) {
  await db
    .insert(journalOnboarding)
    .values({ userId, ...patch })
    .onConflictDoUpdate({
      target: journalOnboarding.userId,
      set: { ...patch, updatedAt: new Date() },
    });
}

export async function saveJournalTimeZone(
  userId: string,
  timeZone: IanaTimeZone,
) {
  await upsertJournalOnboarding(userId, { timeZone });
}

export async function chooseBestEffortMode(userId: string) {
  await upsertJournalOnboarding(userId, {
    githubAccessMode: "best-effort",
  });
}
