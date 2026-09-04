import Link from "next/link";

import { AppShell } from "@/components/journal/app-shell";
import { StateBlock } from "@/components/journal/state-block";
import { StatusChip } from "@/components/journal/status-chip";
import type { JournalOnboarding } from "@/lib/journal";
import type {
  JournalHistoryItem,
  JournalHistoryStore,
} from "@/lib/journal-history";
import type { JournalSession } from "@/lib/session";
import { getLocalDate } from "@/lib/time-zone";

function displayDate(localDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${localDate}T00:00:00Z`));
}

function monthLabel(localDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${localDate}T00:00:00Z`));
}

function statusLabel(day: JournalHistoryItem) {
  if (day.status === "corrected") {
    return `Corrected · ${day.correctionCount} late ${day.correctionCount === 1 ? "event" : "events"}`;
  }
  if (day.status === "recoverable-error") return "Needs retry";
  if (day.status === "finalizing") return "Finalizing";
  return "Finalized";
}

/**
 * The boundaries this page reaches. They are parameters rather than module
 * imports so a test can supply real stand-ins and still render the page it is
 * describing.
 */
export type HistoryPageDependencies = {
  requestHeaders: Headers;
  getSession: (requestHeaders: Headers) => Promise<JournalSession | null>;
  getOnboarding: (
    userId: string,
    requestHeaders: Headers,
  ) => Promise<JournalOnboarding>;
  store: Pick<JournalHistoryStore, "list" | "listPending">;
  redirect: (destination: string) => never;
  now?: () => Date;
};

/**
 * History index — frame 1i of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`).
 *
 * A divided list grouped by month, not a gallery of day cards. Each row states
 * the date, the time zone it was recorded in, and its lifecycle state in
 * words, so nothing about finalization depends on colour.
 */
export async function renderJournalHistoryPage({
  requestHeaders,
  getSession,
  getOnboarding,
  store,
  redirect,
  now = () => new Date(),
}: HistoryPageDependencies) {
  const session = await getSession(requestHeaders);
  if (!session) return redirect("/sign-in?next=%2Fjournal%2Fhistory");
  const [onboarding, history] = await Promise.all([
    getOnboarding(session.user.id, requestHeaders),
    store.list(session.user.id),
  ]);
  const todayLocalDate = onboarding.timeZone
    ? getLocalDate(now(), onboarding.timeZone).iso
    : null;
  const pendingDays = todayLocalDate
    ? await store.listPending(session.user.id, todayLocalDate)
    : [];

  const months = history.reduce<
    Array<{ label: string; days: JournalHistoryItem[] }>
  >((groups, day) => {
    const label = monthLabel(day.localDate);
    const last = groups.at(-1);
    if (last?.label === label) last.days.push(day);
    else groups.push({ label, days: [day] });
    return groups;
  }, []);

  return (
    <AppShell current="history">
      <div className="max-w-[72ch]">
        <h1 className="text-m3-headline-lg text-balance m3-expanded:text-m3-display-sm">
          Journal history
        </h1>
        <p className="mt-3 max-w-[62ch] text-m3-body-lg text-m3-on-surface-variant">
          Finalized days are immutable: they keep the metrics and narrative they
          were recorded with. Late GitHub evidence is appended as a dated
          correction, never merged into the record.
        </p>

        {history.length || pendingDays.length ? (
          <div className="mt-9 grid gap-8">
            {pendingDays.length ? (
              <section aria-label="Waiting for final processing">
                <h2 className="text-m3-title-sm text-m3-on-surface-variant">
                  Waiting for final processing
                </h2>
                <p className="mt-2 text-m3-body-sm text-m3-on-surface-variant">
                  Activity is safely recorded. These days become linkable after
                  final processing completes.
                </p>
                <ol className="mt-3 divide-y divide-m3-outline-variant overflow-hidden rounded-m3-sm bg-m3-surface-container-low">
                  {pendingDays.map((day) => (
                    <li
                      key={day.localDate}
                      className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-5"
                    >
                      <span className="min-w-0">
                        <span className="block text-m3-title-sm text-m3-on-surface">
                          {displayDate(day.localDate)}
                        </span>
                        <span className="block text-m3-body-sm text-m3-on-surface-variant">
                          {day.eventCount}{" "}
                          {day.eventCount === 1 ? "event" : "events"}
                          {day.repositoryCount
                            ? ` · ${day.repositoryCount} ${day.repositoryCount === 1 ? "repository" : "repositories"}`
                            : ""}
                        </span>
                      </span>
                      <StatusChip tone="neutral">Waiting</StatusChip>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            {months.map((month) => (
              <section key={month.label} aria-label={month.label}>
                <h2 className="text-m3-title-sm text-m3-on-surface-variant">
                  {month.label}
                </h2>
                <ol className="mt-2 divide-y divide-m3-outline-variant overflow-hidden rounded-m3-sm bg-m3-surface-container-low">
                  {month.days.map((day) => (
                    <li key={day.localDate}>
                      <Link
                        href={`/journal/history/${day.localDate}`}
                        className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-5"
                      >
                        <span className="min-w-0">
                          <span className="block text-m3-title-sm text-m3-on-surface">
                            {displayDate(day.localDate)}
                          </span>
                          <span className="block text-m3-body-sm wrap-anywhere text-m3-on-surface-variant">
                            {day.timeZone}
                          </span>
                        </span>
                        <StatusChip
                          tone={
                            day.status === "recoverable-error" ||
                            day.status === "corrected"
                              ? "warning"
                              : "neutral"
                          }
                        >
                          {statusLabel(day)}
                        </StatusChip>
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
            <p className="text-m3-body-sm text-m3-on-surface-variant">
              Days older than 30 days are removed by retention, not hidden.
            </p>
          </div>
        ) : (
          <StateBlock
            headingId="empty-history-heading"
            title="No finalized days yet"
            size="expressive"
            className="mt-9"
          >
            History shows closed journals after final processing, not live
            GitHub activity. Today stays on the Today page; a completed day
            appears here after its local day closes and processing finishes.
          </StateBlock>
        )}
      </div>
    </AppShell>
  );
}
