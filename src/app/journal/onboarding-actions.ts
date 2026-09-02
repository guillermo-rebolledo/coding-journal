import type { E2EOnboardingStage } from "@/lib/e2e-fixtures";
import type { JournalSession } from "@/lib/session";
import { normalizeTimeZone, type IanaTimeZone } from "@/lib/time-zone";

export type TimeZoneActionState = { error: string | null };

/**
 * The boundaries the onboarding actions reach. They are parameters rather
 * than module imports so a test can supply real stand-ins and still exercise
 * the validation, fixture branch and redirects these actions own.
 */
export type OnboardingActionDependencies = {
  requestHeaders: Headers;
  getSession: (requestHeaders: Headers) => Promise<JournalSession | null>;
  isFixtureUser: (userId: string) => boolean;
  recordFixtureStage: (stage: E2EOnboardingStage) => Promise<void>;
  saveTimeZone: (userId: string, timeZone: IanaTimeZone) => Promise<void>;
  chooseBestEffort: (userId: string) => Promise<void>;
  redirect: (destination: string) => never;
};

async function requireUser({
  requestHeaders,
  getSession,
  redirect,
}: OnboardingActionDependencies) {
  const session = await getSession(requestHeaders);
  if (!session) return redirect("/sign-in?next=%2Fjournal");
  return session.user;
}

export async function runConfirmTimeZone(
  formData: FormData,
  dependencies: OnboardingActionDependencies,
): Promise<TimeZoneActionState> {
  const currentUser = await requireUser(dependencies);
  // A submitted field is text or an upload; only text can name a time zone.
  const submitted = formData.get("timeZone");
  const timeZone = normalizeTimeZone(
    submitted instanceof File ? null : submitted,
  );
  if (!timeZone) return { error: "Enter a valid IANA time zone." };

  if (dependencies.isFixtureUser(currentUser.id)) {
    await dependencies.recordFixtureStage("time-zone");
  } else {
    await dependencies.saveTimeZone(currentUser.id, timeZone);
  }
  return dependencies.redirect("/journal");
}

export async function runSkipGitHubAppInstallation(
  dependencies: OnboardingActionDependencies,
): Promise<void> {
  const currentUser = await requireUser(dependencies);
  if (dependencies.isFixtureUser(currentUser.id)) {
    await dependencies.recordFixtureStage("complete");
  } else {
    await dependencies.chooseBestEffort(currentUser.id);
  }
  return dependencies.redirect("/journal");
}
