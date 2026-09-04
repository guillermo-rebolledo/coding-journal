import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeActivityMetrics,
  type ActivityRecord,
} from "@/lib/github-activity";

import { renderJournalHistoryDetailPage } from "@/app/journal/history/[localDate]/history-detail-page";
import { renderJournalHistoryPage } from "@/app/journal/history/history-page";
import {
  AppServicesProvider,
  type AppServices,
} from "@/components/app-services";
import { ThemeProvider } from "@/components/theme-provider";
import type { JournalFinalizationRepository } from "@/lib/journal-finalization-repository";
import type { JournalSession } from "@/lib/session";
import { journalSession } from "~test/session-fixture";

const authBoundary = {
  getSession: vi.fn<(headers: Headers) => Promise<JournalSession | null>>(),
};
const onboardingBoundary = {
  read: vi.fn().mockResolvedValue({
    timeZone: "America/Mexico_City",
    githubAccessMode: "best-effort" as const,
  }),
};
const historyBoundary = {
  list: vi.fn<JournalFinalizationRepository["list"]>(),
  listPending: vi.fn<JournalFinalizationRepository["listPending"]>(),
  read: vi.fn<JournalFinalizationRepository["read"]>(),
};
const navigation = {
  replace: vi.fn<(href: string) => void>(),
  refresh: vi.fn<() => void>(),
};

const services: AppServices = {
  navigation,
  session: { signOut: () => Promise.resolve({}) },
};

function redirect(destination: string): never {
  throw new Error(`NEXT_REDIRECT:${destination}`);
}

function notFound(): never {
  throw new Error("NEXT_NOT_FOUND");
}

function JournalHistoryPage() {
  return renderJournalHistoryPage({
    requestHeaders: new Headers(),
    getSession: authBoundary.getSession,
    getOnboarding: onboardingBoundary.read,
    store: historyBoundary,
    redirect,
    now: () => new Date("2026-09-03T12:00:00Z"),
  });
}

function JournalHistoryDetailPage({
  params,
}: {
  params: Promise<{ localDate: string }>;
}) {
  return renderJournalHistoryDetailPage(params, {
    requestHeaders: new Headers(),
    getSession: authBoundary.getSession,
    store: historyBoundary,
    redirect,
    notFound,
  });
}

const evidence: ActivityRecord = {
  deduplicationKey: "github:issue:42:7",
  localDate: "2026-08-31",
  kind: "issue-opened",
  actorId: "7",
  actorLogin: "ada",
  repositoryId: "42",
  repositoryName: "acme/journal",
  evidenceUrl: "https://github.com/acme/journal/issues/7",
  visibility: "private",
  source: "github-webhook",
  subjectId: "7",
  subjectNumber: 7,
  subjectTitle: "Journal history",
  occurredAt: new Date("2026-08-31T15:00:00Z"),
  observedAt: new Date("2026-09-01T05:00:00Z"),
  authoredBeforeDay: false,
  installationId: "9",
};

describe("journal history browsing", () => {
  beforeEach(() => {
    authBoundary.getSession
      .mockReset()
      .mockResolvedValue(journalSession("user-1"));
    onboardingBoundary.read.mockReset().mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });
    historyBoundary.list.mockReset().mockResolvedValue([
      {
        localDate: "2026-08-31",
        timeZone: "America/Mexico_City",
        status: "corrected",
        completeness: "partial",
        finalizedAt: new Date("2026-09-01T12:00:00Z"),
        correctionCount: 1,
      },
    ]);
    historyBoundary.listPending.mockReset().mockResolvedValue([]);
    historyBoundary.read.mockReset().mockResolvedValue({
      localDate: "2026-08-31",
      timeZone: "America/Mexico_City",
      status: "corrected",
      completeness: "partial",
      finalizedAt: new Date("2026-09-01T12:00:00Z"),
      correctionCount: 1,
      metrics: computeActivityMetrics([evidence]),
      narrative: {
        overview: "Opened the journal history issue.",
        overviewEvidenceIds: ["evidence-1"],
        accomplishments: [],
        collaboration: [],
        inProgress: [],
      },
      evidence: [evidence],
      corrections: [
        {
          ...evidence,
          deduplicationKey: "github:issue-comment:42:7:99",
          kind: "issue-comment",
          subjectTitle: "Late review note",
          observedAt: new Date("2026-09-01T13:00:00Z"),
        },
      ],
      failure: null,
    });
  });

  it("lists prior days with timezone and correction status", async () => {
    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>
          {await JournalHistoryPage()}
        </ThemeProvider>
      </AppServicesProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Journal history" }),
    ).toBeInTheDocument();
    expect(screen.getByText("America/Mexico_City")).toBeInTheDocument();
    expect(screen.getByText("Corrected · 1 late event")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Monday, August 31/ }),
    ).toHaveAttribute("href", "/journal/history/2026-08-31");
  });

  it("shows recorded closed-day activity while finalization is pending", async () => {
    historyBoundary.list.mockResolvedValue([]);
    historyBoundary.listPending.mockResolvedValue([
      {
        localDate: "2026-09-02",
        eventCount: 12,
        repositoryCount: 3,
      },
    ]);

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>
          {await JournalHistoryPage()}
        </ThemeProvider>
      </AppServicesProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Waiting for final processing" }),
    ).toBeInTheDocument();
    expect(screen.getByText("12 events · 3 repositories")).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.queryByText("No finalized days yet")).not.toBeInTheDocument();
  });

  it("opens a frozen day with completeness, narrative, evidence, and corrections", async () => {
    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>
          {await JournalHistoryDetailPage({
            params: Promise.resolve({ localDate: "2026-08-31" }),
          })}
        </ThemeProvider>
      </AppServicesProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Monday, August 31" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Partial coverage")).toBeInTheDocument();
    expect(
      screen.getByText("Opened the journal history issue."),
    ).toBeInTheDocument();
    expect(screen.getByText("Journal history")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Late corrections" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Late review note")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Redact narrative" }));
    expect(
      screen.getByRole("textbox", { name: "Type REDACT to confirm" }),
    ).toHaveFocus();
    expect(
      screen.getByText(/Recorded facts, aggregate metrics, evidence/),
    ).toBeInTheDocument();

    const finalLayout = screen.getByRole("group", {
      name: "Final evidence layout",
    });
    expect(
      screen.getByRole("group", { name: "Late corrections layout" }),
    ).toBeInTheDocument();
    for (const name of [
      "Final evidence filters: Repository",
      "Final evidence filters: Activity type",
      "Late corrections filters: Repository",
      "Late corrections filters: Activity type",
    ]) {
      expect(screen.getByRole("combobox", { name })).toBeInTheDocument();
    }

    fireEvent.click(
      within(finalLayout).getByRole("button", {
        name: "Group by repository",
      }),
    );
    expect(
      screen.queryByRole("region", { name: "acme/journal" }),
    ).not.toBeInTheDocument();
  });

  it.each(["not-a-date", "2026-08-01"])(
    "routes an unavailable day through the not-found boundary (%s)",
    async (localDate) => {
      if (localDate === "2026-08-01")
        historyBoundary.read.mockResolvedValue(null);

      await expect(
        JournalHistoryDetailPage({
          params: Promise.resolve({ localDate }),
        }),
      ).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );
});
