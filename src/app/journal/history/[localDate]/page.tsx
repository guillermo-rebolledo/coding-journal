import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { journalFinalizationRepository } from "@/lib/journal-finalization-repository";
import { getJournalSession } from "@/lib/session";

import { renderJournalHistoryDetailPage } from "./history-detail-page";

export const metadata: Metadata = { title: "Journal history" };
export const dynamic = "force-dynamic";

export default async function JournalHistoryDetailPage({
  params,
}: {
  params: Promise<{ localDate: string }>;
}) {
  return renderJournalHistoryDetailPage(params, {
    requestHeaders: await headers(),
    getSession: getJournalSession,
    store: journalFinalizationRepository,
    redirect,
    notFound,
  });
}
