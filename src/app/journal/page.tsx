import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { refreshTodayJournal } from "@/app/journal/actions";
import { chooseJournalRequestAdapters } from "@/lib/journal-request-adapters";

import { renderJournalPage } from "./journal-page";

export const metadata: Metadata = { title: "Journal" };
export const dynamic = "force-dynamic";

export default async function JournalPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ setup?: string }>;
} = {}) {
  const requestHeaders = await headers();
  const adapters = chooseJournalRequestAdapters(requestHeaders);
  return renderJournalPage(searchParams, {
    requestHeaders,
    getSession: adapters.session,
    getOnboarding: adapters.onboarding.read,
    getInstallations: adapters.installations,
    readToday: adapters.reconciliation.read,
    refresh: refreshTodayJournal,
    redirect,
  });
}
