"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { deleteJournalAccount } from "@/lib/account-deletion";
import { getRequiredEnv } from "@/lib/env";
import { getGitHubUserAccessToken } from "@/lib/github-user-token";
import { getJournalSession } from "@/lib/session";

export async function deleteAccount(formData: FormData) {
  if (formData.get("confirmation") !== "DELETE") return;
  const requestHeaders = await headers();
  const session = await getJournalSession(requestHeaders);
  if (!session) redirect("/sign-in?next=%2Fsettings");
  const accessToken = await getGitHubUserAccessToken(
    requestHeaders,
    session.user.id,
  ).catch(() => null);
  await deleteJournalAccount({
    userId: session.user.id,
    accessToken,
    clientId: getRequiredEnv("GITHUB_CLIENT_ID"),
    clientSecret: getRequiredEnv("GITHUB_CLIENT_SECRET"),
  });
  redirect("/?account=deleted");
}
