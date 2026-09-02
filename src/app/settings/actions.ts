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

import { runDeleteAccount } from "./delete-account";

export async function deleteAccount(formData: FormData) {
  return runDeleteAccount(formData, {
    requestHeaders: await headers(),
    getSession: getJournalSession,
    spendBudget: (userId) =>
      spendRequestBudget({
        policy: "account-deletion",
        userId,
        event: "account-deletion-limited",
      }),
    isFixtureUser: isE2EJournalUser,
    endFixtureSession: async () => {
      const store = await cookies();
      store.delete(E2E_SESSION_COOKIE);
      store.delete(E2E_ONBOARDING_COOKIE);
    },
    getAccessToken: getGitHubUserAccessToken,
    deleteAccount: deleteJournalAccount,
    credentials: {
      clientId: getRequiredEnv("GITHUB_CLIENT_ID"),
      clientSecret: getRequiredEnv("GITHUB_CLIENT_SECRET"),
    },
    redirect,
  });
}
