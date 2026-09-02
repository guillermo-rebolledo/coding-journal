import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { journalFinalizationRepository } from "@/lib/journal-finalization-repository";
import { getJournalSession } from "@/lib/session";

import { renderJournalHistoryPage } from "./history-page";

export const metadata: Metadata = { title: "History" };
export const dynamic = "force-dynamic";

export default async function JournalHistoryPage() {
  return renderJournalHistoryPage({
    requestHeaders: await headers(),
    getSession: getJournalSession,
    store: journalFinalizationRepository,
    redirect,
  });
}
