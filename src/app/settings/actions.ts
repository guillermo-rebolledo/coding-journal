"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { chooseJournalRequestAdapters } from "@/lib/journal-request-adapters";

import { runDeleteAccount } from "./delete-account";

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
