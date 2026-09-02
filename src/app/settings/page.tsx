import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { chooseJournalRequestAdapters } from "@/lib/journal-request-adapters";

import { renderSettingsPage } from "./settings-page";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const requestHeaders = await headers();
  const adapters = chooseJournalRequestAdapters(requestHeaders);
  return renderSettingsPage(searchParams, {
    requestHeaders,
    getSession: adapters.session,
    getOnboarding: adapters.onboarding.read,
    refreshConnections: adapters.refreshConnections,
    redirect,
  });
}
