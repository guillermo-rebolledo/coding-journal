"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { chooseJournalRequestAdapters } from "@/lib/journal-request-adapters";
import { getRequiredEnv } from "@/lib/env";

import { runConnectExistingGitHubInstallations } from "./connect-existing-installations";
import { runDeleteAccount } from "./delete-account";

export async function connectExistingGitHubAppInstallation() {
  const requestHeaders = await headers();
  const adapters = chooseJournalRequestAdapters(requestHeaders);
  return runConnectExistingGitHubInstallations({
    requestHeaders,
    appSlug: getRequiredEnv("GITHUB_APP_SLUG"),
    getSession: adapters.session,
    getUserAccess: adapters.githubUserAccess,
    createClient: adapters.createGitHubClient,
    store: adapters.installationAssociationStore,
    redirect,
  });
}

export async function deleteAccount(formData: FormData) {
  const requestHeaders = await headers();
  const adapters = chooseJournalRequestAdapters(requestHeaders);
  return runDeleteAccount(formData, {
    requestHeaders,
    getSession: adapters.session,
    guard: (userId) => adapters.guard("account-deletion", userId, new Date()),
    deleteAccount: adapters.deleteAccount,
    redirect,
  });
}
