"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { deleteJournalAccount } from "@/lib/account-deletion";
import {
  E2E_ONBOARDING_COOKIE,
  E2E_SESSION_COOKIE,
  isE2EJournalUser,
} from "@/lib/e2e-fixtures";
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

  // A fixture user has nothing in the database to delete and no GitHub grant
  // to revoke. Ending the session is the observable outcome the smoke run
  // checks, and it is the same outcome a real deletion produces.
  if (isE2EJournalUser(session.user.id)) {
    const store = await cookies();
    store.delete(E2E_SESSION_COOKIE);
    store.delete(E2E_ONBOARDING_COOKIE);
    redirect("/?account=deleted");
  }

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
