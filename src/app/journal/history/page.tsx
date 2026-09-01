import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  History,
} from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { JournalFrame } from "@/app/journal/journal-frame";
import { getE2EJournalHistory, isE2EJournalUser } from "@/lib/e2e-fixtures";
import { journalFinalizationRepository } from "@/lib/journal-finalization-repository";
import { getJournalSession } from "@/lib/session";

export const metadata: Metadata = { title: "History" };
export const dynamic = "force-dynamic";

function displayDate(localDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${localDate}T00:00:00Z`));
}

function statusLabel(status: string, correctionCount: number) {
  if (status === "corrected") {
    return `Corrected · ${correctionCount} late ${correctionCount === 1 ? "event" : "events"}`;
  }
  if (status === "recoverable-error") return "Needs retry";
  if (status === "finalizing") return "Finalizing";
  return "Finalized";
}

export default async function JournalHistoryPage() {
  const session = await getJournalSession(await headers());
  if (!session) redirect("/sign-in?next=%2Fjournal%2Fhistory");
  const history = isE2EJournalUser(session.user.id)
    ? getE2EJournalHistory()
    : await journalFinalizationRepository.list(session.user.id);

  return (
    <JournalFrame current="history">
      <div className="flex max-w-3xl items-start gap-4">
        <span className="bg-primary-container grid size-12 shrink-0 place-items-center rounded-m3-lg text-primary">
          <History aria-hidden />
        </span>
        <div>
          <p className="text-m3-label-lg-emphasized text-primary">ARCHIVE</p>
          <h1 className="mt-2 text-m3-headline-lg text-balance">
            Journal history
          </h1>
          <p className="mt-3 text-m3-body-lg text-muted-foreground">
            Stable daily records keep their original metrics and narrative. Late
            GitHub evidence is called out as a correction.
          </p>
        </div>
      </div>

      {history.length ? (
        <ol className="mt-10 grid gap-4 sm:grid-cols-2">
          {history.map((day) => {
            const needsRetry = day.status === "recoverable-error";
            const finalizing = day.status === "finalizing";
            const Icon = needsRetry
              ? AlertTriangle
              : finalizing
                ? Clock3
                : CheckCircle2;
            return (
              <li key={day.localDate}>
                <Link
                  href={`/journal/history/${day.localDate}`}
                  className="group block h-full rounded-m3-xl bg-card p-5 shadow-m3-1 transition-shadow hover:shadow-m3-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:p-6"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-m3-title-lg-emphasized">
                        {displayDate(day.localDate)}
                      </p>
                      <p className="mt-2 flex items-center gap-2 text-m3-body-sm text-muted-foreground">
                        <CalendarDays aria-hidden className="size-4" />
                        {day.timeZone}
                      </p>
                    </div>
                    <Icon
                      aria-hidden
                      className={
                        needsRetry ? "text-destructive" : "text-primary"
                      }
                    />
                  </div>
                  <p
                    className={`text-m3-label-md-emphasized mt-5 w-fit rounded-m3-full px-3 py-1.5 ${
                      needsRetry
                        ? "bg-m3-error-container text-m3-on-error-container"
                        : finalizing
                          ? "bg-secondary-container text-secondary-foreground"
                          : day.status === "corrected"
                            ? "bg-m3-warning-container text-m3-on-warning-container"
                            : "bg-primary-container text-primary"
                    }`}
                  >
                    {statusLabel(day.status, day.correctionCount)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : (
        <section className="mt-10 rounded-m3-2xl bg-m3-surface-container-low px-6 py-14 text-center sm:px-10">
          <CalendarDays aria-hidden className="mx-auto size-10 text-primary" />
          <h2 className="mt-5 text-m3-headline-sm">No finalized days yet</h2>
          <p className="mx-auto mt-3 max-w-lg text-m3-body-md text-muted-foreground">
            A journal moves here after its local day closes and final processing
            finishes.
          </p>
        </section>
      )}
    </JournalFrame>
  );
}
