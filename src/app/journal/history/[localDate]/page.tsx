import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { chooseJournalRequestAdapters } from "@/lib/journal-request-adapters";

import { renderJournalHistoryDetailPage } from "./history-detail-page";

export const metadata: Metadata = { title: "Journal history" };
export const dynamic = "force-dynamic";

export default async function JournalHistoryDetailPage({
  params,
}: {
  params: Promise<{ localDate: string }>;
}) {
  const requestHeaders = await headers();
  const adapters = chooseJournalRequestAdapters(requestHeaders);
  return renderJournalHistoryDetailPage(params, {
    requestHeaders,
    getSession: adapters.session,
    store: adapters.finalization,
    redirect,
    notFound,
  });
}
