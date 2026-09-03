import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { JsonValue } from "@/lib/json-payload";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeActivityMetrics,
  type ActivityRecord,
} from "@/lib/github-activity";
import type { TodayJournal } from "@/lib/github-reconciliation";
import { JournalNotFoundError } from "@/lib/journal-errors";

import { renderJournalPage } from "@/app/journal/journal-page";
import { runRefreshTodayJournal } from "@/app/journal/refresh-action";
import {
  AppServicesProvider,
  type AppServices,
} from "@/components/app-services";
import { ThemeProvider } from "@/components/theme-provider";
import { getGitHubInstallations } from "@/lib/github-installation";
import type { JournalOnboarding } from "@/lib/journal";
import {
  generateJournalSummary,
  type SummaryStore,
} from "@/lib/journal-summary";
import type { CircuitStore } from "@/lib/service-circuit";
import type { JournalSession } from "@/lib/session";
import { guardAction } from "@/lib/request-guard";
import {
  readTodayJournal,
  reconcileTodayJournalDay,
  type TodayJournalStores,
} from "@/lib/today-journal";
import type { rateLimitRepository } from "@/lib/rate-limit-repository";
import { installationStore } from "~test/installation-store";
import { journalSession } from "~test/session-fixture";

const authBoundary = {
  getSession: vi.fn<(headers: Headers) => Promise<JournalSession | null>>(),
  signOut: vi.fn<AppServices["session"]["signOut"]>(),
};

const journalBoundary = {
  getOnboarding:
    vi.fn<(userId: string, headers: Headers) => Promise<JournalOnboarding>>(),
};

const installations = installationStore();
const installationBoundary = {
  getInstallations: installations.findInstallations,
};

type ActivityStore = TodayJournalStores["activities"];

const activityRepositoryBoundary = {
  tryStart: vi.fn<ActivityStore["tryStart"]>(),
  finish: vi.fn<ActivityStore["finish"]>(),
  read: vi.fn<ActivityStore["read"]>(),
};

const githubBoundary = {
  getToken:
    vi.fn<(headers: Headers, userId: string) => Promise<string | null>>(),
  fetch: vi.fn(),
};

const summaryBoundary = {
  findBySnapshotHash: vi.fn<SummaryStore["findBySnapshotHash"]>(),
  getUsage: vi.fn<SummaryStore["getUsage"]>(),
  claimSlot: vi.fn<SummaryStore["claimSlot"]>(),
  save: vi.fn<SummaryStore["save"]>(),
};

const navigation = {
  replace: vi.fn<(href: string) => void>(),
  refresh: vi.fn<() => void>(),
};

// Request budgets and provider circuits are storage boundaries like any other
// repository here; the policies themselves are covered by their own tests.
const budgetBoundary = {
  increment: vi.fn<(typeof rateLimitRepository)["increment"]>(),
};

const circuitBoundary = {
  tryEnter: vi.fn<CircuitStore["tryEnter"]>(),
  recordSuccess: vi.fn<CircuitStore["recordSuccess"]>(),
  recordFailure: vi.fn<CircuitStore["recordFailure"]>(),
};

const services: AppServices = {
  navigation,
  session: { signOut: authBoundary.signOut },
};

function redirect(destination: string): never {
  throw new Error(`NEXT_REDIRECT:${destination}`);
}

const activityStores = (): TodayJournalStores => ({
  activities: activityRepositoryBoundary,
  circuits: circuitBoundary,
  getAccessToken: githubBoundary.getToken,
});

function JournalPage(
  options: {
    searchParams?: Promise<{
      setup?: string;
      github?: string | string[];
    }>;
  } = {},
) {
  return renderJournalPage(options.searchParams ?? Promise.resolve({}), {
    requestHeaders: new Headers(),
    getSession: authBoundary.getSession,
    getOnboarding: journalBoundary.getOnboarding,
    getInstallations: (userId) => getGitHubInstallations(userId, installations),
    readToday: (input) =>
      readTodayJournal({
        ...input,
        stores: activityStores(),
        findSummary: summaryBoundary.findBySnapshotHash,
      }),
    refresh: refreshTodayJournal,
    redirect,
  });
}

function refreshTodayJournal() {
  return runRefreshTodayJournal({
    requestHeaders: new Headers(),
    getSession: authBoundary.getSession,
    getOnboarding: journalBoundary.getOnboarding,
    guard: (policy, userId, now) =>
      guardAction({
        policy,
        userId,
        now,
        rateStore: budgetBoundary,
      }),
    readStoredJournal: (userId, localDate) =>
      activityRepositoryBoundary.read(userId, localDate),
    getInstallations: (userId) => getGitHubInstallations(userId, installations),
    reconcile: (input) =>
      reconcileTodayJournalDay({ ...input, stores: activityStores() }),
    summarize: ({ userId, localDate, activities, now }) =>
      generateJournalSummary({
        userId,
        localDate,
        activities,
        store: summaryBoundary,
        provider: () =>
          Promise.reject(new Error("no summary provider in this test")),
        now,
      }),
    redirect,
  });
}

let storedJournal: Omit<TodayJournal, "activities" | "metrics"> | null;
let storedActivities: Map<string, ActivityRecord>;

function jsonResponse(body: JsonValue, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Metric values live in the "All 16 categories" breakdown as a definition
 * list, per the look-and-feel reference's compact metric overview
 * (`docs/design/Coding Journal look and feel.html`, frame 1e).
 */
function metricValue(label: string) {
  return within(
    screen.getByRole("group", { name: "All 16 categories" }),
  ).getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
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
    summaryBoundary.findBySnapshotHash.mockReset();
    summaryBoundary.findBySnapshotHash.mockResolvedValue(null);
    summaryBoundary.getUsage.mockResolvedValue({
      userDaily: 0,
      globalDaily: 0,
      monthlyCostUsd: 0,
    });
    summaryBoundary.claimSlot.mockResolvedValue({ finish: vi.fn() });
    navigation.refresh.mockReset();
    budgetBoundary.increment.mockReset();
    budgetBoundary.increment.mockImplementation(
      async ({ now, windowMs }: { now: Date; windowMs: number }) => ({
        count: 1,
        windowEndsAt: new Date(now.getTime() + windowMs),
      }),
    );
    circuitBoundary.tryEnter.mockReset();
    circuitBoundary.tryEnter.mockResolvedValue({ allowed: true });
    circuitBoundary.recordSuccess.mockReset();
    circuitBoundary.recordFailure.mockReset();
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
        if (url.includes("/gists/starred")) return jsonResponse([]);
        if (url.includes("/gists?")) return jsonResponse([]);
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
        if (!storedJournal) throw new JournalNotFoundError();
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
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: null,
      githubAccessMode: null,
    });

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
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
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: null,
    });

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
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
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Monday, August 31" }),
    ).toBeInTheDocument();
    expect(screen.getByText("America/Mexico_City")).toBeInTheDocument();
    expect(screen.getByText("Best-effort journal")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Your day is ready to refresh" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("GitHub reconciliation pending"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Review repository access" }),
    ).toBeInTheDocument();
  });

  it("shows an actionable GitHub callback outcome on Today", async () => {
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>
          {await JournalPage({
            searchParams: Promise.resolve({ github: "invalid-state" }),
          })}
        </ThemeProvider>
      </AppServicesProvider>,
    );

    expect(screen.getByText("Installation link expired")).toBeInTheDocument();
    expect(
      screen.getByText(/Start the connection again from Settings/),
    ).toBeInTheDocument();
  });

  it("labels selected GitHub App coverage as partial on Today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "app",
    });
    installationBoundary.getInstallations.mockResolvedValue([
      {
        installationId: "42",
        accountId: "84",
        accountLogin: "example-org",
        accountType: "Organization",
        repositorySelection: "selected",
        repositoryCount: 3,
        permissions: {
          actions: "read",
          contents: "read",
          deployments: "read",
          discussions: "read",
          metadata: "read",
          organization_projects: "read",
          packages: "read",
        },
        status: "active",
      },
    ]);

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );

    expect(screen.getByText("Partial access")).toBeInTheDocument();
    expect(screen.getByText("3 selected repositories")).toBeInTheDocument();
  });

  it("marks Discussions incomplete when the installed App lacks permission", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "app",
    });
    installationBoundary.getInstallations.mockResolvedValue([
      {
        installationId: "42",
        accountId: "84",
        accountLogin: "example-org",
        accountType: "Organization",
        repositorySelection: "all",
        repositoryCount: 8,
        permissions: {
          actions: "read",
          contents: "read",
          deployments: "read",
          metadata: "read",
          organization_projects: "read",
          packages: "read",
        },
        status: "active",
      },
    ]);

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );

    expect(screen.getByText("Limited activity")).toBeInTheDocument();
    expect(
      screen.getByText("All granted repositories · Discussions unavailable"),
    ).toBeInTheDocument();
  });

  it("marks ref and release coverage incomplete without Contents permission", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "app",
    });
    installationBoundary.getInstallations.mockResolvedValue([
      {
        installationId: "42",
        accountId: "84",
        accountLogin: "example-org",
        accountType: "Organization",
        repositorySelection: "all",
        repositoryCount: 8,
        permissions: {
          actions: "read",
          deployments: "read",
          discussions: "read",
          metadata: "read",
          organization_projects: "read",
          packages: "read",
        },
        status: "active",
      },
    ]);

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );

    expect(screen.getByText("Limited activity")).toBeInTheDocument();
    expect(
      screen.getByText(
        "All granted repositories · Pushes, refs, and releases unavailable",
      ),
    ).toBeInTheDocument();
  });

  it("marks organization Projects preview unavailable without its permission", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "app",
    });
    installationBoundary.getInstallations.mockResolvedValue([
      {
        installationId: "42",
        accountId: "84",
        accountLogin: "example-org",
        accountType: "Organization",
        repositorySelection: "all",
        repositoryCount: 8,
        permissions: {
          actions: "read",
          contents: "read",
          deployments: "read",
          discussions: "read",
          metadata: "read",
          packages: "read",
        },
        status: "active",
      },
    ]);

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );

    expect(screen.getByText("Limited activity")).toBeInTheDocument();
    expect(
      screen.getByText(
        "All granted repositories · Organization Projects preview unavailable",
      ),
    ).toBeInTheDocument();
  });

  it("summarizes incomplete coverage across multiple active installations", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "app",
    });
    installationBoundary.getInstallations.mockResolvedValue([
      {
        installationId: "10",
        accountId: "84",
        accountLogin: "ada",
        accountType: "User",
        repositorySelection: "all",
        repositoryCount: 8,
        permissions: {
          actions: "read",
          contents: "read",
          deployments: "read",
          discussions: "read",
          metadata: "read",
          organization_projects: "read",
          packages: "read",
        },
        status: "active",
      },
      {
        installationId: "42",
        accountId: "84",
        accountLogin: "example-org",
        accountType: "Organization",
        repositorySelection: "selected",
        repositoryCount: 2,
        permissions: {
          actions: "read",
          contents: "read",
          deployments: "read",
          metadata: "read",
          organization_projects: "read",
          packages: "read",
        },
        status: "active",
      },
    ]);

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );

    expect(screen.getByText("Partial access")).toBeInTheDocument();
    expect(
      screen.getByText("2 selected repositories · Discussions unavailable"),
    ).toBeInTheDocument();
  });

  it("shows trustworthy metrics and chronological evidence for today's activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "app",
    });
    installationBoundary.getInstallations.mockResolvedValue([
      {
        installationId: "99",
        accountId: "84",
        accountLogin: "acme",
        accountType: "Organization",
        repositorySelection: "selected",
        repositoryCount: 1,
        permissions: {
          contents: "read",
          discussions: "read",
          metadata: "read",
        },
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
        if (url.includes("/gists/starred")) return jsonResponse([]);
        if (url.includes("/gists?")) return jsonResponse([]);
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

    await refreshTodayJournal();
    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );

    expect(metricValue("Pushes")).toBe("1");
    expect(metricValue("Commits")).toBe("1");
    expect(screen.getByText("Partial GitHub response")).toBeInTheDocument();
    expect(screen.getByText("Authored before today")).toBeInTheDocument();
    expect(
      screen.getAllByText("acme/private-engine", { selector: "span" }),
    ).toHaveLength(2);
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
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
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
        if (url.includes("/gists/starred")) return jsonResponse([]);
        if (url.includes("/gists?")) return jsonResponse([]);
        throw new Error(`Unexpected fixture request: ${url}`);
      },
    );

    await refreshTodayJournal();
    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );

    expect(metricValue("Issue updates")).toBe("1");
    expect(metricValue("Pull requests")).toBe("0");
    expect(metricValue("Reviews")).toBe("1");
    expect(metricValue("Merges")).toBe("1");
    expect(metricValue("Comments")).toBe("1");

    expect(screen.getByText("Opened issue #41")).toBeInTheDocument();
    expect(screen.getByText("Commented on issue #41")).toBeInTheDocument();
    expect(screen.getByText("Reviewed pull request #52")).toBeInTheDocument();
    expect(screen.getByText("Merged pull request #52")).toBeInTheDocument();
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
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
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
          "github:branch-created:42:feature%2Fjournal:delivery-1",
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
        visibility: "public",
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
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );

    expect(metricValue("Ref changes")).toBe("1");
    expect(metricValue("Releases")).toBe("1");
    expect(metricValue("Discussions")).toBe("1");
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
    expect(screen.getAllByText("Private repository")).toHaveLength(2);
  });

  it("shows attributable operations with status and package narrative policy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "app",
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
      attributed: true,
    };
    const activities: ActivityRecord[] = [
      {
        ...common,
        kind: "workflow-run",
        deduplicationKey: "github:workflow-run:42:501:1",
        subjectId: "501",
        subjectTitle: "Deploy production",
        evidenceUrl:
          "https://github.com/acme/private-engine/actions/runs/501/attempts/1",
        occurredAt: new Date("2026-08-31T11:00:00Z"),
        status: "success",
      },
      {
        ...common,
        kind: "deployment",
        deduplicationKey: "github:deployment:42:801",
        subjectId: "801",
        subjectTitle: "production",
        evidenceUrl: "https://github.com/acme/private-engine/deployments",
        occurredAt: new Date("2026-08-31T11:10:00Z"),
        status: "failure",
      },
      {
        ...common,
        kind: "package-published",
        deduplicationKey: "github:package-published:42:701",
        subjectId: "701",
        subjectTitle: "coding-journal · 1.0.0",
        evidenceUrl: "https://github.com/acme/private-engine/packages",
        occurredAt: new Date("2026-08-31T11:20:00Z"),
        status: "success",
        narrativeEligible: true,
      },
      {
        ...common,
        kind: "package-deleted",
        deduplicationKey:
          "github:package-deleted:42:701:2026-08-31T11:25:00.000Z",
        subjectId: "701",
        subjectTitle: "coding-journal · 1.0.0",
        evidenceUrl: "https://github.com/acme/private-engine/packages",
        occurredAt: new Date("2026-08-31T11:25:00Z"),
        status: "cancelled",
        narrativeEligible: false,
      },
    ];
    storedActivities = new Map(
      activities.map((activity) => [activity.deduplicationKey, activity]),
    );
    activityRepositoryBoundary.tryStart.mockResolvedValue(false);

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );

    expect(metricValue("Workflow runs")).toBe("1");
    expect(metricValue("Deployments")).toBe("1");
    expect(metricValue("Package updates")).toBe("1");
    expect(screen.getAllByText("Succeeded")).toHaveLength(2);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Excluded from narrative")).toBeInTheDocument();
    expect(screen.getByText("Ran workflow")).toBeInTheDocument();
    expect(screen.getByText("Published package")).toBeInTheDocument();
  });

  it("presents Projects, metadata-only Gists, social exclusions, and source freshness", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "app",
    });
    storedJournal = {
      localDate: "2026-08-31",
      timeZone: "America/Mexico_City",
      status: "partial",
      refreshedAt: new Date("2026-08-31T12:00:00Z"),
      sourceFreshness: [
        {
          source: "social",
          label: "Social activity",
          status: "best-effort",
          refreshedAt: new Date("2026-08-31T12:00:00Z"),
          detail: "GitHub's activity feed may be delayed by up to 6 hours.",
        },
        {
          source: "gists",
          label: "Gists",
          status: "unavailable",
          refreshedAt: null,
          detail: "Gist metadata reconciliation was unavailable.",
        },
      ],
    };
    const common = {
      localDate: "2026-08-31",
      actorId: "7",
      actorLogin: "ada",
      subjectNumber: null,
      observedAt: new Date("2026-08-31T12:00:00Z"),
      authoredBeforeDay: false,
      installationId: null,
      visibility: "public" as const,
    };
    const activities: ActivityRecord[] = [
      {
        ...common,
        kind: "project-updated",
        deduplicationKey: "github:project-updated:PVT:501:delivery-1",
        repositoryId: "84",
        repositoryName: "acme/Projects",
        evidenceUrl: "https://github.com/orgs/acme/projects/12",
        source: "github-projects-preview",
        subjectId: "PVT",
        subjectNumber: 12,
        subjectTitle: "Engineering roadmap",
        occurredAt: new Date("2026-08-31T11:00:00Z"),
        installationId: "99",
      },
      {
        ...common,
        kind: "gist-created",
        deduplicationKey: "github:gist-created:gist-1",
        repositoryId: "gists:7",
        repositoryName: "ada/Gists",
        evidenceUrl: "https://gist.github.com/ada/gist-1",
        source: "github-gists",
        subjectId: "gist-1",
        subjectTitle: "Metadata only",
        occurredAt: new Date("2026-08-31T11:10:00Z"),
      },
      {
        ...common,
        kind: "repository-starred",
        deduplicationKey: "github:repository-starred:event-1",
        repositoryId: "42",
        repositoryName: "acme/journal",
        evidenceUrl: "https://github.com/acme/journal",
        source: "github-events",
        subjectId: "42",
        subjectTitle: "acme/journal",
        occurredAt: new Date("2026-08-31T11:20:00Z"),
        narrativeEligible: false,
      },
      {
        ...common,
        kind: "gist-starred",
        deduplicationKey: "github:gist-starred:gist-2",
        repositoryId: "gists:7",
        repositoryName: "ada/Gists",
        evidenceUrl: "https://gist.github.com/grace/gist-2",
        source: "github-gists",
        subjectId: "gist-2",
        subjectTitle: "Useful snippet",
        occurredAt: new Date("2026-08-31T11:30:00Z"),
        narrativeEligible: false,
      },
    ];
    storedActivities = new Map(
      activities.map((activity) => [activity.deduplicationKey, activity]),
    );
    activityRepositoryBoundary.tryStart.mockResolvedValue(false);

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );

    expect(metricValue("Project updates")).toBe("1");
    expect(metricValue("Gist updates")).toBe("2");
    expect(metricValue("Social actions")).toBe("1");
    expect(screen.getByText("Updated project #12")).toBeInTheDocument();
    expect(screen.getByText("Created Gist")).toBeInTheDocument();
    expect(screen.getByText("Observed starred Gist")).toBeInTheDocument();
    expect(
      screen.getByText("First observed · best-effort"),
    ).toBeInTheDocument();
    expect(screen.getByText("Starred repository")).toBeInTheDocument();
    expect(screen.getByText("Preview · best-effort")).toBeInTheDocument();
    expect(
      screen.getByText("Reconciliation · best-effort"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Delayed source · best-effort"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Excluded from narrative")).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: "Secondary source coverage" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Best-effort · refreshed at 6:00 AM"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Unavailable during this refresh"),
    ).toBeInTheDocument();
    expect(screen.getByText(/delayed by up to 6 hours/)).toBeInTheDocument();
  });

  it("filters chronologically and groups repositories without losing evidence", async () => {
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
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
      visibility: "public" as const,
      source: "github-events" as const,
      subjectNumber: null,
      subjectTitle: null,
      observedAt: new Date("2026-08-31T12:00:00Z"),
      authoredBeforeDay: false,
      installationId: null,
    };
    const activities: ActivityRecord[] = [
      {
        ...common,
        kind: "push",
        deduplicationKey: "push-1",
        repositoryName: "acme/api",
        subjectId: "push-1",
        evidenceUrl: "https://github.com/acme/api/compare/1...2",
        occurredAt: new Date("2026-08-31T11:00:00Z"),
      },
      {
        ...common,
        kind: "issue-opened",
        deduplicationKey: "issue-1",
        repositoryId: "43",
        repositoryName: "acme/web",
        subjectId: "51",
        subjectNumber: 51,
        evidenceUrl: "https://github.com/acme/web/issues/51",
        occurredAt: new Date("2026-08-31T12:00:00Z"),
      },
    ];
    storedActivities = new Map(
      activities.map((activity) => [activity.deduplicationKey, activity]),
    );

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );

    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
      "Opened issue #51",
    );
    fireEvent.change(screen.getByLabelText("Activity filters: Activity type"), {
      target: { value: "pushes" },
    });
    expect(screen.queryByText("Opened issue #51")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Activity filters: Repository"), {
      target: { value: "acme/api" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Group by repository" }),
    );

    const group = screen.getByRole("heading", {
      name: "acme/api",
    }).parentElement!;
    expect(within(group).getAllByRole("listitem")).toHaveLength(1);
    expect(
      within(group).getByRole("link", { name: "View push evidence" }),
    ).toHaveAttribute("href", "https://github.com/acme/api/compare/1...2");
    expect(screen.getByLabelText("Activity filters: Repository")).toHaveValue(
      "acme/api",
    );
  });

  it("reloads stored data on polling and announces a manual cooldown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-31T12:10:00Z"));
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });
    storedJournal = {
      localDate: "2026-08-31",
      timeZone: "America/Mexico_City",
      status: "complete",
      refreshedAt: new Date("2026-08-31T12:00:00Z"),
      lastAttemptAt: new Date("2026-08-31T12:00:00Z"),
    };

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh Today" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Stored activity reloaded. GitHub sync is cooling down.",
        ),
      ).toBeInTheDocument(),
    );
    expect(githubBoundary.fetch).not.toHaveBeenCalled();

    navigation.refresh.mockClear();
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(githubBoundary.fetch).not.toHaveBeenCalled();
  });

  it("states a request limit in words and leaves the recorded day untouched", async () => {
    vi.setSystemTime(new Date("2026-08-31T12:10:00Z"));
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });
    storedJournal = {
      localDate: "2026-08-31",
      timeZone: "America/Mexico_City",
      status: "complete",
      refreshedAt: new Date("2026-08-31T12:00:00Z"),
      lastAttemptAt: new Date("2026-08-31T11:00:00Z"),
    };
    storedActivities.set("github:issue-opened:43:51", {
      deduplicationKey: "github:issue-opened:43:51",
      localDate: "2026-08-31",
      kind: "issue-opened",
      actorId: "7",
      actorLogin: "ada",
      repositoryId: "43",
      repositoryName: "acme/web",
      evidenceUrl: "https://github.com/acme/web/issues/51",
      visibility: "public",
      source: "github-events",
      subjectId: "51",
      subjectNumber: 51,
      subjectTitle: "Polish Today filters",
      occurredAt: new Date("2026-08-31T11:30:00Z"),
      observedAt: new Date("2026-08-31T11:31:00Z"),
      authoredBeforeDay: false,
      installationId: null,
    });
    budgetBoundary.increment.mockResolvedValue({
      count: 999,
      windowEndsAt: new Date("2026-08-31T12:17:00Z"),
    });

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );
    expect(
      screen.getAllByRole("status").some((status) => status.textContent === ""),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Refresh Today" }));

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .filter((element) =>
            element.textContent?.includes("Request limit reached."),
          ),
      ).toHaveLength(1),
    );
    // The refusal is a status, not an alert, and it is visible rather than
    // only announced. The recorded journal beside it is untouched.
    expect(
      screen.getByText("Request limit reached.", {
        selector: "p:not(.sr-only)",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Opened issue #51")).toBeInTheDocument();
    expect(githubBoundary.fetch).not.toHaveBeenCalled();
  });

  it("announces the later of rate-limit reset and reconciliation cooldown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-31T12:20:00Z"));
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });
    storedJournal = {
      localDate: "2026-08-31",
      timeZone: "America/Mexico_City",
      status: "complete",
      refreshedAt: new Date("2026-08-31T12:00:00Z"),
      lastAttemptAt: new Date("2026-08-31T12:00:00Z"),
    };
    githubBoundary.fetch.mockImplementation(
      async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/user")) {
          return new Response("{}", {
            status: 429,
            headers: { "x-ratelimit-reset": "1788179100" },
          });
        }
        if (url.includes("/gists/starred") || url.includes("/gists?")) {
          return jsonResponse([]);
        }
        throw new Error(`Unexpected fixture request: ${url}`);
      },
    );

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh Today" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Stored activity reloaded. GitHub rate limit reached.",
        ),
      ).toBeInTheDocument(),
    );
    expect(
      document.querySelector('time[datetime="2026-08-31T12:35:00.000Z"]'),
    ).toBeInTheDocument();
  });

  it("reloads the stored view and announces a failed manual reconciliation", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-31T12:20:00Z"));
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });
    githubBoundary.getToken.mockResolvedValue(null);

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh Today" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Stored activity reloaded. GitHub could not sync right now.",
        ),
      ).toBeInTheDocument(),
    );
    expect(navigation.refresh).toHaveBeenCalled();
    expect(githubBoundary.fetch).not.toHaveBeenCalled();
  });

  it("keeps sign-out available after onboarding", async () => {
    authBoundary.getSession.mockResolvedValue(journalSession("user-1"));
    journalBoundary.getOnboarding.mockResolvedValue({
      timeZone: "America/Mexico_City",
      githubAccessMode: "best-effort",
    });

    render(
      <AppServicesProvider services={services}>
        <ThemeProvider storageKey={null}>{await JournalPage()}</ThemeProvider>
      </AppServicesProvider>,
    );

    authBoundary.signOut.mockResolvedValue({ error: null });
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
