import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { refreshTodayJournal } from "@/app/journal/actions";
import { getGitHubInstallations } from "@/lib/github-installation";
import { getJournalOnboarding } from "@/lib/journal";
import { journalSummaryRepository } from "@/lib/journal-summary-repository";
import { getJournalSession } from "@/lib/session";
import { getStoredTodayJournal } from "@/lib/today-journal";

import { renderJournalPage } from "./journal-page";

export const metadata: Metadata = { title: "Journal" };
export const dynamic = "force-dynamic";

export default async function JournalPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ setup?: string }>;
} = {}) {
  return renderJournalPage(searchParams, {
    requestHeaders: await headers(),
    getSession: getJournalSession,
    getOnboarding: getJournalOnboarding,
    getInstallations: getGitHubInstallations,
    readStoredJournal: getStoredTodayJournal,
    findSummary: (userId, snapshotHash) =>
      journalSummaryRepository.findBySnapshotHash(userId, snapshotHash),
    refresh: refreshTodayJournal,
    redirect,
  });
}
