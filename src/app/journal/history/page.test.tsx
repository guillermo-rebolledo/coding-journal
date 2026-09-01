import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeActivityMetrics,
  type ActivityRecord,
} from "@/lib/github-activity";

const authBoundary = vi.hoisted(() => ({ getSession: vi.fn() }));
const historyBoundary = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getJournalSession: authBoundary.getSession,
}));
vi.mock("@/lib/journal-finalization-repository", () => ({
  journalFinalizationRepository: historyBoundary,
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/navigation", () => ({
  ...navigation,
  useRouter: () => ({
    replace: navigation.replace,
    refresh: navigation.refresh,
  }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));

import JournalHistoryPage from "@/app/journal/history/page";
import JournalHistoryDetailPage from "@/app/journal/history/[localDate]/page";
import { ThemeProvider } from "@/components/theme-provider";

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
    authBoundary.getSession.mockReset().mockResolvedValue({
      user: { id: "user-1", name: "Ada Lovelace" },
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
      <ThemeProvider storageKey={null}>
        {await JournalHistoryPage()}
      </ThemeProvider>,
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

  it("opens a frozen day with completeness, narrative, evidence, and corrections", async () => {
    render(
      <ThemeProvider storageKey={null}>
        {await JournalHistoryDetailPage({
          params: Promise.resolve({ localDate: "2026-08-31" }),
        })}
      </ThemeProvider>,
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
    expect(
      screen.getByRole("button", { name: "Redact narrative" }),
    ).toBeInTheDocument();
  });
});
