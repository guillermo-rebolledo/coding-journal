import { eq } from "drizzle-orm";

import { db } from "@/db";
import { journalOnboarding } from "@/db/auth-schema";
import { getE2EOnboardingProgress, isE2EJournalUser } from "@/lib/e2e-fixtures";
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
  /**
   * Only read for fixture users, whose onboarding progress lives in a cookie.
   * Required rather than defaulted: a caller that omitted it would silently
   * report a fixture user as not onboarded.
   */
  requestHeaders: Headers | null,
): Promise<JournalOnboarding> {
  if (isE2EJournalUser(userId)) {
    return getE2EOnboardingProgress(userId, requestHeaders);
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
