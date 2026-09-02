"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { deleteJournalAccount } from "@/lib/account-deletion";
import { getRequiredEnv } from "@/lib/env";
import { getGitHubUserAccessToken } from "@/lib/github-user-token";
import { spendRequestBudget } from "@/lib/request-budget";
import { getJournalSession } from "@/lib/session";
import { logServiceEvent } from "@/lib/telemetry";

export async function deleteAccount(formData: FormData) {
  if (formData.get("confirmation") !== "DELETE") return;
  const requestHeaders = await headers();
  const session = await getJournalSession(requestHeaders);
  if (!session) redirect("/sign-in?next=%2Fsettings");
  // Deletion revokes a GitHub grant and rewrites every table the account
  // touches, so it is bounded like any other costly boundary. A refusal
  // returns to Settings, which states the limit in the destructive zone.
  const budget = await spendRequestBudget({
    policy: "account-deletion",
    userId: session.user.id,
    event: "account-deletion-limited",
  });
  if (budget && !budget.allowed) redirect("/settings?limited=deletion");

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
  logServiceEvent({
    category: "privacy",
    event: "account-deleted",
    outcome: "ok",
    userId: session.user.id,
  });
  redirect("/?account=deleted");
}
