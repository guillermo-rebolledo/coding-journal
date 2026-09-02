import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { refreshGitHubConnections } from "@/lib/github-connection";
import { getJournalOnboarding } from "@/lib/journal";
import { getJournalSession } from "@/lib/session";

import { renderSettingsPage } from "./settings-page";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  return renderSettingsPage(searchParams, {
    requestHeaders: await headers(),
    getSession: getJournalSession,
    getOnboarding: getJournalOnboarding,
    refreshConnections: refreshGitHubConnections,
    redirect,
  });
}
