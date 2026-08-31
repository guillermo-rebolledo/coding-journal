"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { chooseBestEffortMode, saveJournalTimeZone } from "@/lib/journal";
import { getJournalSession } from "@/lib/session";
import { normalizeTimeZone } from "@/lib/time-zone";

export type TimeZoneActionState = { error: string | null };

async function requireUser() {
  const session = await getJournalSession(await headers());
  if (!session) redirect("/sign-in?next=%2Fjournal");
  return session.user;
}

export async function confirmTimeZone(
  _previousState: TimeZoneActionState,
  formData: FormData,
): Promise<TimeZoneActionState> {
  const currentUser = await requireUser();
  const timeZone = normalizeTimeZone(formData.get("timeZone"));
  if (!timeZone) return { error: "Enter a valid IANA time zone." };

  await saveJournalTimeZone(currentUser.id, timeZone);
  redirect("/journal");
}

export async function skipGitHubAppInstallation() {
  const currentUser = await requireUser();
  await chooseBestEffortMode(currentUser.id);
  redirect("/journal");
}
