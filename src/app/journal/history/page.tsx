import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { chooseJournalRequestAdapters } from "@/lib/journal-request-adapters";

import { renderJournalHistoryPage } from "./history-page";

export const metadata: Metadata = { title: "History" };
export const dynamic = "force-dynamic";

export default async function JournalHistoryPage() {
  const requestHeaders = await headers();
  const adapters = chooseJournalRequestAdapters(requestHeaders);
  return renderJournalHistoryPage({
    requestHeaders,
    getSession: adapters.session,
    store: adapters.finalization,
    redirect,
  });
}
