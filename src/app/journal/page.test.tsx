import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeActivityMetrics,
  type ActivityRecord,
  type TodayJournal,
} from "@/lib/github-reconciliation";

const authBoundary = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}));

const journalBoundary = vi.hoisted(() => ({
  getOnboarding: vi.fn(),
}));

const installationBoundary = vi.hoisted(() => ({
  getInstallations: vi.fn(),
}));

const activityRepositoryBoundary = vi.hoisted(() => ({
  tryStart: vi.fn(),
  finish: vi.fn(),
  read: vi.fn(),
}));

const githubBoundary = vi.hoisted(() => ({
  getToken: vi.fn(),
  fetch: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getJournalSession: authBoundary.getSession,
}));

vi.mock("@/lib/journal", () => ({
  getJournalOnboarding: journalBoundary.getOnboarding,
}));

vi.mock("@/lib/github-activity-repository", () => ({
  githubActivityRepository: activityRepositoryBoundary,
}));

vi.mock("@/lib/github-user-token", () => ({
  getGitHubUserAccessToken: githubBoundary.getToken,
}));

vi.mock("@/lib/github-installation-repository", () => ({
  findInstallations: installationBoundary.getInstallations,
  consumeInstallationState: vi.fn(),
  deletePendingInstallation: vi.fn(),
  insertInstallationState: vi.fn(),
  insertPendingInstallation: vi.fn(),
  markInstallationDisconnected: vi.fn(),
  setGitHubAccessMode: vi.fn(),
  upsertActiveInstallation: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: authBoundary.signOut },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/navigation", () => ({
  redirect: navigation.redirect,
  useRouter: () => ({
    replace: navigation.replace,
    refresh: navigation.refresh,
  }),
}));

import JournalPage from "@/app/journal/page";
import { ThemeProvider } from "@/components/theme-provider";

let storedJournal: Omit<TodayJournal, "activities" | "metrics"> | null;
let storedActivities: Map<string, ActivityRecord>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("protected journal boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    authBoundary.getSession.mockReset();
    authBoundary.signOut.mockReset();
    navigation.replace.mockReset();
    navigation.refresh.mockReset();
    journalBoundary.getOnboarding.mockReset();
    installationBoundary.getInstallations.mockReset();
    installationBoundary.getInstallations.mockResolvedValue([]);
    githubBoundary.getToken.mockReset();
    githubBoundary.getToken.mockResolvedValue("fixture-token");
    githubBoundary.fetch.mockReset();
    githubBoundary.fetch.mockImplementation(
      async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/user")) {
          return jsonResponse({ id: 7, login: "ada" });
        }
        if (url.includes("/users/ada/events")) return jsonResponse([]);
        if (url.includes("/user/installations/")) {
          return jsonResponse({ total_count: 0, repositories: [] });
        }
        throw new Error(`Unexpected fixture request: ${url}`);
      },
    );
    vi.stubGlobal("fetch", githubBoundary.fetch);

    storedJournal = null;
    storedActivities = new Map();
    activityRepositoryBoundary.tryStart.mockReset();
    activityRepositoryBoundary.tryStart.mockResolvedValue(true);
    activityRepositoryBoundary.finish.mockReset();
    activityRepositoryBoundary.finish.mockImplementation(
      async (
        _userId: string,
        journal: Omit<TodayJournal, "activities" | "metrics">,
        records: ActivityRecord[],
      ) => {
        storedJournal = journal;
        for (const record of records) {
          storedActivities.set(record.deduplicationKey, record);
        }
      },
    );
    activityRepositoryBoundary.read.mockReset();
    activityRepositoryBoundary.read.mockImplementation(
      async (_userId: string, localDate: string): Promise<TodayJournal> => {
        if (!storedJournal) throw new Error("Reconciliation was not finished");
        const activities = [...storedActivities.values()].sort(
          (left, right) =>
            left.occurredAt.getTime() - right.occurredAt.getTime(),
        );
        return {
          ...storedJournal,
          localDate,
          activities,
          metrics: computeActivityMetrics(activities),
        };
      },
    );
  });

  it("shows a first-time user the browser-detected time zone", async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "en-US",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "America/Mexico_City",
    });
    authBoundary.getSession.mockResolvedValue({
      session: { id: "session-1", token: "server-only-token" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: null,
      githubAccessMode: null,
    });

    render(
      <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Start with your local day" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Your time zone")).toHaveValue(
        "America/Mexico_City",
      ),
    );
    expect(screen.getByText(/Detected from this browser/)).toBeInTheDocument();
    expect(screen.queryByText("server-only-token")).not.toBeInTheDocument();
  });

  it("resumes at repository access after the time zone is saved", async () => {
    authBoundary.getSession.mockResolvedValue({
      session: { id: "session-1", token: "server-only-token" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: null,
    });

    render(
      <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Choose what your journal can see" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/sign-in proves who you are/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Install GitHub App" }),
    ).toHaveAttribute("href", "/api/github/install?from=onboarding");
    expect(
      screen.getByRole("button", { name: "Continue in best-effort mode" }),
    ).toBeEnabled();
  });

  it("renders an empty Today journal with its local date and completeness", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    authBoundary.getSession.mockResolvedValue({
      session: { id: "session-1", token: "server-only-token" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });

    render(
      <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Today, Monday, August 31" }),
    ).toBeInTheDocument();
    expect(screen.getByText("America/Mexico_City")).toBeInTheDocument();
    expect(screen.getByText("Best-effort journal")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Your day is ready to take shape" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Review repository access" }),
    ).toBeInTheDocument();
  });

  it("labels selected GitHub App coverage as partial on Today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    authBoundary.getSession.mockResolvedValue({
      session: { id: "session-1", token: "server-only-token" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "app",
    });
    installationBoundary.getInstallations.mockResolvedValue([
      {
        installationId: "42",
        accountLogin: "example-org",
        accountType: "Organization",
        repositorySelection: "selected",
        repositoryCount: 3,
        status: "active",
      },
    ]);

    render(
      <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>,
    );

    expect(screen.getByText("Partial access")).toBeInTheDocument();
    expect(screen.getByText("3 selected repositories")).toBeInTheDocument();
  });

  it("shows trustworthy metrics and chronological evidence for today's activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    authBoundary.getSession.mockResolvedValue({
      session: { id: "session-1", token: "server-only-token" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "app",
    });
    installationBoundary.getInstallations.mockResolvedValue([
      {
        installationId: "99",
        accountLogin: "acme",
        accountType: "Organization",
        repositorySelection: "selected",
        repositoryCount: 1,
        status: "active",
      },
    ]);
    githubBoundary.fetch.mockImplementation(
      async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/user")) {
          return jsonResponse({ id: 7, login: "ada" });
        }
        if (url.includes("/users/ada/events")) {
          return jsonResponse([
            {
              id: "event-1",
              type: "PushEvent",
              actor: { id: 7, login: "ada" },
              repo: { id: 42, name: "acme/private-engine" },
              public: false,
              created_at: "2026-08-31T11:00:00Z",
              payload: {
                before: "1111111",
                head: "abcdef1",
                ref: "refs/heads/main",
              },
            },
          ]);
        }
        if (
          url.includes("/repos/acme/private-engine/compare/1111111...abcdef1")
        ) {
          return jsonResponse({
            total_commits: 1,
            commits: [
              {
                sha: "abcdef1",
                author: { id: 7, login: "ada" },
                commit: { author: { date: "2026-08-30T20:00:00Z" } },
              },
            ],
          });
        }
        if (url.includes("/user/installations/99/repositories")) {
          return jsonResponse({}, 502);
        }
        throw new Error(`Unexpected fixture request: ${url}`);
      },
    );

    render(
      <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>,
    );

    expect(screen.getByText("1 push")).toBeInTheDocument();
    expect(screen.getByText("1 commit")).toBeInTheDocument();
    expect(screen.getByText("Partial GitHub response")).toBeInTheDocument();
    expect(screen.getByText("Authored before today")).toBeInTheDocument();
    expect(screen.getAllByText("acme/private-engine")).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "View commit evidence" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/acme/private-engine/commit/abcdef1",
    );
    expect(
      screen.getByRole("link", { name: "View push evidence" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/acme/private-engine/compare/1111111...abcdef1",
    );
  });

  it("distinguishes issues, pull requests, reviews, merges, and comments on Today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    authBoundary.getSession.mockResolvedValue({
      session: { id: "session-1", token: "server-only-token" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });
    installationBoundary.getInstallations.mockResolvedValue([]);
    const pullRequest = {
      number: 52,
      title: "Track issue and pull-request collaboration",
      body: "PRIVATE-PR-BODY",
      merged: true,
      created_at: "2026-08-31T10:00:00Z",
      closed_at: "2026-08-31T11:30:00Z",
      merged_at: "2026-08-31T11:30:00Z",
      updated_at: "2026-08-31T11:30:00Z",
    };
    githubBoundary.fetch.mockImplementation(
      async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/user")) {
          return jsonResponse({ id: 7, login: "ada" });
        }
        if (url.includes("/users/ada/events")) {
          return jsonResponse([
            {
              id: "event-1",
              type: "IssuesEvent",
              actor: { id: 7, login: "ada" },
              repo: { id: 42, name: "acme/private-engine" },
              public: false,
              created_at: "2026-08-31T11:00:00Z",
              payload: {
                action: "opened",
                issue: {
                  number: 41,
                  title: "Reconciliation misses reopened issues",
                  body: "PRIVATE-ISSUE-BODY",
                  created_at: "2026-08-31T11:00:00Z",
                },
              },
            },
            {
              id: "event-2",
              type: "IssueCommentEvent",
              actor: { id: 7, login: "ada" },
              repo: { id: 42, name: "acme/private-engine" },
              public: false,
              created_at: "2026-08-31T11:05:00Z",
              payload: {
                action: "created",
                issue: {
                  number: 41,
                  title: "Reconciliation misses reopened issues",
                },
                comment: {
                  id: 9001,
                  body: "PRIVATE-COMMENT-BODY",
                  created_at: "2026-08-31T11:05:00Z",
                },
              },
            },
            {
              id: "event-3",
              type: "PullRequestReviewEvent",
              actor: { id: 7, login: "ada" },
              repo: { id: 42, name: "acme/private-engine" },
              public: false,
              created_at: "2026-08-31T11:10:00Z",
              payload: {
                action: "created",
                pull_request: pullRequest,
                review: {
                  id: 7001,
                  state: "approved",
                  body: "PRIVATE-REVIEW-BODY",
                  submitted_at: "2026-08-31T11:10:00Z",
                },
              },
            },
            {
              id: "event-4",
              type: "PullRequestEvent",
              actor: { id: 7, login: "ada" },
              repo: { id: 42, name: "acme/private-engine" },
              public: false,
              created_at: "2026-08-31T11:30:00Z",
              payload: { action: "closed", pull_request: pullRequest },
            },
          ]);
        }
        throw new Error(`Unexpected fixture request: ${url}`);
      },
    );

    render(
      <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>,
    );

    expect(screen.getByText("1 issue update")).toBeInTheDocument();
    expect(screen.getByText("0 pull request updates")).toBeInTheDocument();
    expect(screen.getByText("1 review")).toBeInTheDocument();
    expect(screen.getByText("1 merge")).toBeInTheDocument();
    expect(screen.getByText("1 comment")).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: "Opened issue #41" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Commented on issue #41" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Reviewed pull request #52" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Merged pull request #52" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Reconciliation misses reopened issues"),
    ).toHaveLength(2);
    expect(screen.getAllByText("Private repository")).toHaveLength(4);
    expect(
      screen.getByRole("link", { name: "View issue evidence" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/acme/private-engine/issues/41",
    );
    expect(
      screen.getByRole("link", { name: "View review evidence" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/acme/private-engine/pull/52#pullrequestreview-7001",
    );

    // Bodies and diffs never reach the page.
    expect(document.body.textContent).not.toContain("PRIVATE");
  });

  it("presents refs, releases, and Discussions as distinct private activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    authBoundary.getSession.mockResolvedValue({
      session: { id: "session-1", token: "server-only-token" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });
    storedJournal = {
      localDate: "2026-08-31",
      timeZone: "America/Mexico_City",
      status: "complete",
      refreshedAt: new Date("2026-08-31T12:00:00Z"),
    };
    const common = {
      localDate: "2026-08-31",
      actorId: "7",
      actorLogin: "ada",
      repositoryId: "42",
      repositoryName: "acme/private-engine",
      visibility: "private" as const,
      source: "github-webhook" as const,
      subjectNumber: null,
      observedAt: new Date("2026-08-31T11:30:01Z"),
      authoredBeforeDay: false,
      installationId: "99",
    };
    const activities: ActivityRecord[] = [
      {
        ...common,
        kind: "branch-created",
        deduplicationKey:
          "github:branch-created:42:feature%2Fjournal:2026-08-31",
        subjectId: "feature/journal",
        subjectTitle: "feature/journal",
        evidenceUrl: "https://github.com/acme/private-engine/branches",
        occurredAt: new Date("2026-08-31T11:00:00Z"),
      },
      {
        ...common,
        kind: "release-published",
        deduplicationKey: "github:release-published:42:501",
        subjectId: "501",
        subjectTitle: "Version 2",
        evidenceUrl:
          "https://github.com/acme/private-engine/releases/tag/v2.0.0",
        occurredAt: new Date("2026-08-31T11:10:00Z"),
      },
      {
        ...common,
        kind: "discussion-comment",
        deduplicationKey: "github:discussion-comment:42:8801",
        subjectId: "8801",
        subjectNumber: 73,
        subjectTitle: "How should reconciliation report gaps?",
        evidenceUrl:
          "https://github.com/acme/private-engine/discussions/73#discussioncomment-8801",
        occurredAt: new Date("2026-08-31T11:20:00Z"),
      },
    ];
    storedActivities = new Map(
      activities.map((activity) => [activity.deduplicationKey, activity]),
    );
    activityRepositoryBoundary.tryStart.mockResolvedValue(false);

    render(
      <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>,
    );

    expect(screen.getByText("1 ref change")).toBeInTheDocument();
    expect(screen.getByText("1 release update")).toBeInTheDocument();
    expect(screen.getByText("1 discussion update")).toBeInTheDocument();
    expect(screen.getByText("Created branch")).toBeInTheDocument();
    expect(screen.getByText("Published release")).toBeInTheDocument();
    expect(screen.getByText("Commented on discussion #73")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "View answer evidence" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View comment evidence" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/acme/private-engine/discussions/73#discussioncomment-8801",
    );
    expect(screen.getAllByText("Private repository")).toHaveLength(3);
  });

  it("keeps sign-out available after onboarding", async () => {
    authBoundary.getSession.mockResolvedValue({
      session: { id: "session-1", token: "server-only-token" },
      user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
    });
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });

    render(
      <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>,
    );

    authBoundary.signOut.mockResolvedValue({
      data: { success: true },
      error: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(authBoundary.signOut).toHaveBeenCalledOnce());
    expect(navigation.replace).toHaveBeenCalledWith("/");
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("redirects a signed-out visitor to the recoverable sign-in route", async () => {
    authBoundary.getSession.mockResolvedValue(null);

    await expect(JournalPage()).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?next=%2Fjournal",
    );
  });
});
