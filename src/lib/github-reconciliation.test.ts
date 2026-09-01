// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  computeActivityMetrics,
  getLocalDayWindow,
  reconcileGitHubActivity,
  type ActivityRecord,
  type ReconciliationDiagnostic,
  type ReconciliationStore,
  type TodayJournal,
} from "@/lib/github-reconciliation";

class MemoryStore implements ReconciliationStore {
  private activities = new Map<string, ActivityRecord>();
  private attempts = new Map<string, Date>();
  private journals = new Map<string, TodayJournal>();

  async tryStart(userId: string, localDate: string, now: Date, cutoff: Date) {
    const key = `${userId}:${localDate}`;
    const previous = this.attempts.get(key);
    if (previous && previous > cutoff) return false;
    this.attempts.set(key, now);
    return true;
  }

  async finish(
    userId: string,
    journal: Omit<TodayJournal, "activities" | "metrics">,
    records: ActivityRecord[],
  ) {
    for (const record of records) {
      this.activities.set(`${userId}:${record.deduplicationKey}`, record);
    }
    this.journals.set(`${userId}:${journal.localDate}`, {
      ...journal,
      activities: [],
      metrics: computeActivityMetrics([]),
    });
  }

  async read(userId: string, localDate: string): Promise<TodayJournal> {
    const state = this.journals.get(`${userId}:${localDate}`) ?? {
      localDate,
      timeZone: "America/New_York",
      status: "loading" as const,
      refreshedAt: null,
      activities: [],
      metrics: computeActivityMetrics([]),
    };
    const activities = [...this.activities.values()]
      .filter((activity) => activity.localDate === localDate)
      .sort(
        (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
      );

    return {
      ...state,
      activities,
      metrics: computeActivityMetrics(activities),
    };
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GitHub current-day reconciliation", () => {
  it("uses the user's 23-hour local day when daylight saving time starts", () => {
    const window = getLocalDayWindow(
      new Date("2026-03-08T18:00:00.000Z"),
      "America/New_York",
    );

    expect(window).toEqual({
      localDate: "2026-03-08",
      startsAt: new Date("2026-03-08T05:00:00.000Z"),
      endsAt: new Date("2026-03-09T04:00:00.000Z"),
    });
  });

  it("deduplicates a private push, expands truncated commits, and attributes only verified authors", async () => {
    const store = new MemoryStore();
    const push = {
      id: "event-900",
      type: "PushEvent",
      actor: { id: 7, login: "ada" },
      repo: { id: 42, name: "acme/private-engine" },
      public: false,
      created_at: "2026-03-08T15:00:00Z",
      payload: {
        push_id: 900,
        before: "1111111",
        head: "2222222",
        ref: "refs/heads/main",
        size: 2,
        commits: [{ sha: "2222222" }],
      },
    };
    const fetchFixture = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/user")) {
        return jsonResponse({ id: 7, login: "ada" });
      }
      if (url.includes("/users/ada/events")) {
        return jsonResponse([push, push]);
      }
      if (
        url.includes("/repos/acme/private-engine/compare/1111111...2222222")
      ) {
        return jsonResponse({
          total_commits: 2,
          commits: [
            {
              sha: "2222222",
              author: { id: 7, login: "ada" },
              commit: { author: { date: "2026-03-07T21:00:00Z" } },
            },
            {
              sha: "3333333",
              author: null,
              commit: { author: { date: "2026-03-08T16:00:00Z" } },
            },
          ],
        });
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    });

    const first = await reconcileGitHubActivity({
      userId: "user-1",
      timeZone: "America/New_York",
      accessMode: "best-effort",
      installationIds: [],
      accessToken: "fixture-token",
      now: new Date("2026-03-08T18:00:00Z"),
      fetchImplementation: fetchFixture as typeof fetch,
      store,
    });
    const repeated = await reconcileGitHubActivity({
      userId: "user-1",
      timeZone: "America/New_York",
      accessMode: "best-effort",
      installationIds: [],
      accessToken: "fixture-token",
      now: new Date("2026-03-08T18:16:00Z"),
      fetchImplementation: fetchFixture as typeof fetch,
      store,
    });

    expect(first.metrics).toEqual({
      pushes: 1,
      commits: 1,
      issues: 0,
      pullRequests: 0,
      reviews: 0,
      merges: 0,
      comments: 0,
    });
    expect(repeated.metrics).toEqual({
      pushes: 1,
      commits: 1,
      issues: 0,
      pullRequests: 0,
      reviews: 0,
      merges: 0,
      comments: 0,
    });
    expect(repeated.status).toBe("complete");
    expect(repeated.activities).toEqual([
      expect.objectContaining({
        kind: "commit",
        actorLogin: "ada",
        repositoryName: "acme/private-engine",
        visibility: "private",
        authoredBeforeDay: true,
        source: "github-events",
        evidenceUrl: "https://github.com/acme/private-engine/commit/2222222",
      }),
      expect.objectContaining({
        kind: "push",
        // The content-derived key keeps webhook-ingested pushes deduplicated
        // against events API reconciliation.
        deduplicationKey: "github:push:42:1111111:2222222",
        repositoryName: "acme/private-engine",
        visibility: "private",
        authoredBeforeDay: false,
        evidenceUrl:
          "https://github.com/acme/private-engine/compare/1111111...2222222",
      }),
    ]);
  });

  it("keeps installed private-repository commits when the Events API is partial", async () => {
    const store = new MemoryStore();
    const fetchFixture = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/user")) return jsonResponse({ id: 7, login: "ada" });
      if (url.includes("/users/ada/events")) return jsonResponse({}, 502);
      if (url.includes("/user/installations/99/repositories")) {
        return jsonResponse({
          total_count: 1,
          repositories: [
            { id: 42, full_name: "acme/private-engine", private: true },
          ],
        });
      }
      if (url.includes("/repos/acme/private-engine/commits?")) {
        return jsonResponse([
          {
            sha: "abcdef1234567",
            author: { id: 7, login: "ada" },
            commit: { author: { date: "2026-03-08T13:00:00Z" } },
          },
        ]);
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    });

    const journal = await reconcileGitHubActivity({
      userId: "user-1",
      timeZone: "America/New_York",
      accessMode: "app",
      installationIds: ["99"],
      accessToken: "fixture-token",
      now: new Date("2026-03-08T18:00:00Z"),
      fetchImplementation: fetchFixture as typeof fetch,
      store,
    });

    expect(journal.status).toBe("partial");
    expect(journal.metrics).toEqual({
      pushes: 0,
      commits: 1,
      issues: 0,
      pullRequests: 0,
      reviews: 0,
      merges: 0,
      comments: 0,
    });
    expect(journal.activities[0]).toEqual(
      expect.objectContaining({
        kind: "commit",
        visibility: "private",
        source: "github-repository-commits",
        installationId: "99",
        authoredBeforeDay: false,
      }),
    );
  });

  it("reports which stage failed without exposing credentials", async () => {
    const store = new MemoryStore();
    const diagnostics: ReconciliationDiagnostic[] = [];
    const fetchFixture = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/user")) return jsonResponse({ id: 7, login: "ada" });
      if (url.includes("/users/ada/events")) return jsonResponse({}, 502);
      throw new Error(`Unexpected fixture request: ${url}`);
    });

    await reconcileGitHubActivity({
      userId: "user-1",
      timeZone: "America/New_York",
      accessMode: "best-effort",
      installationIds: [],
      accessToken: "fixture-token",
      now: new Date("2026-03-08T18:00:00Z"),
      fetchImplementation: fetchFixture as typeof fetch,
      store,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(diagnostics).toEqual([
      {
        stage: "events",
        errorName: "GitHubRequestError",
        errorMessage: "GitHub request failed (502)",
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("fixture-token");
  });

  it("keeps the events pass alive at GitHub's 300-event pagination limit", async () => {
    const store = new MemoryStore();
    const diagnostics: ReconciliationDiagnostic[] = [];
    const requestedPages: string[] = [];
    // Non-push events keep the fixture focused on pagination alone.
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: `watch-${index}`,
      type: "WatchEvent",
      actor: { id: 7, login: "ada" },
      repo: { id: 42, name: "acme/private-engine" },
      public: true,
      created_at: "2026-03-08T15:00:00Z",
    }));
    const fetchFixture = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/user")) return jsonResponse({ id: 7, login: "ada" });
      if (url.includes("/users/ada/events")) {
        const page = new URL(url).searchParams.get("page") ?? "1";
        requestedPages.push(page);
        // GitHub rejects anything past the third page of the events feed.
        if (Number(page) > 3) return jsonResponse({ message: "..." }, 422);
        return jsonResponse(fullPage);
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    });

    const journal = await reconcileGitHubActivity({
      userId: "user-1",
      timeZone: "America/New_York",
      accessMode: "best-effort",
      installationIds: [],
      accessToken: "fixture-token",
      now: new Date("2026-03-08T18:00:00Z"),
      fetchImplementation: fetchFixture as typeof fetch,
      store,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(requestedPages).toEqual(["1", "2", "3"]);
    expect(journal.status).toBe("partial");
    expect(diagnostics).toEqual([]);
  });

  it("degrades instead of failing when GitHub rejects a page with 422", async () => {
    const store = new MemoryStore();
    const fetchFixture = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/user")) return jsonResponse({ id: 7, login: "ada" });
      if (url.includes("/users/ada/events")) {
        return jsonResponse({ message: "Pagination is limited" }, 422);
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    });

    const journal = await reconcileGitHubActivity({
      userId: "user-1",
      timeZone: "America/New_York",
      accessMode: "best-effort",
      installationIds: [],
      accessToken: "fixture-token",
      now: new Date("2026-03-08T18:00:00Z"),
      fetchImplementation: fetchFixture as typeof fetch,
      store,
    });

    // A 422 must not read as "GitHub is unavailable".
    expect(journal.status).toBe("partial");
  });

  it("returns a recoverable error journal when GitHub is unavailable", async () => {
    const store = new MemoryStore();
    const fetchFixture = vi.fn(async () => jsonResponse({}, 503));

    const journal = await reconcileGitHubActivity({
      userId: "user-1",
      timeZone: "America/New_York",
      accessMode: "best-effort",
      installationIds: [],
      accessToken: "fixture-token",
      now: new Date("2026-03-08T18:00:00Z"),
      fetchImplementation: fetchFixture as typeof fetch,
      store,
    });

    expect(journal).toEqual(
      expect.objectContaining({
        status: "error",
        refreshedAt: null,
        metrics: computeActivityMetrics([]),
        activities: [],
      }),
    );
  });
});

describe("GitHub collaboration reconciliation from the events feed", () => {
  const window = { now: new Date("2026-03-08T18:00:00Z") };

  function collaborationEvent(
    id: string,
    type: string,
    payload: unknown,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      id,
      type,
      actor: { id: 7, login: "ada" },
      repo: { id: 42, name: "acme/private-engine" },
      public: false,
      created_at: "2026-03-08T15:00:00Z",
      payload,
      ...overrides,
    };
  }

  it("normalizes issue and pull-request activity, keeps only the actor's work, and never retains bodies", async () => {
    const store = new MemoryStore();
    const issue = {
      number: 41,
      title: "Reconciliation misses reopened issues",
      body: "PRIVATE-ISSUE-BODY",
      created_at: "2026-03-08T14:30:00Z",
      closed_at: null,
      updated_at: "2026-03-08T14:30:00Z",
    };
    const pullRequest = {
      number: 52,
      title: "Track issue and pull-request collaboration",
      body: "PRIVATE-PR-BODY",
      merged: true,
      created_at: "2026-03-08T14:00:00Z",
      closed_at: "2026-03-08T14:40:00Z",
      merged_at: "2026-03-08T14:40:00Z",
      updated_at: "2026-03-08T14:40:00Z",
    };
    const events = [
      collaborationEvent("event-1", "IssuesEvent", { action: "opened", issue }),
      // The same action can appear twice in the feed; it must collapse.
      collaborationEvent("event-1b", "IssuesEvent", {
        action: "opened",
        issue,
      }),
      collaborationEvent("event-2", "IssueCommentEvent", {
        action: "created",
        issue: {
          number: 52,
          title: "Track issue and pull-request collaboration",
          pull_request: { url: "https://api.github.com/..." },
        },
        comment: {
          id: 9001,
          body: "PRIVATE-COMMENT-BODY",
          created_at: "2026-03-08T14:35:00Z",
        },
      }),
      collaborationEvent("event-3", "PullRequestEvent", {
        action: "closed",
        pull_request: pullRequest,
      }),
      collaborationEvent("event-4", "PullRequestReviewEvent", {
        action: "created",
        pull_request: pullRequest,
        review: {
          id: 7001,
          state: "approved",
          body: "PRIVATE-REVIEW-BODY",
          submitted_at: "2026-03-08T14:36:00Z",
        },
      }),
      collaborationEvent("event-5", "PullRequestReviewCommentEvent", {
        action: "created",
        pull_request: pullRequest,
        comment: {
          id: 8001,
          body: "PRIVATE-DIFF-COMMENT",
          diff_hunk: "PRIVATE-DIFF-HUNK",
          created_at: "2026-03-08T14:37:00Z",
        },
      }),
      // Another participant's event never reaches the journal.
      collaborationEvent(
        "event-6",
        "IssuesEvent",
        { action: "opened", issue: { ...issue, number: 43 } },
        { actor: { id: 8, login: "grace" } },
      ),
      // Unsupported actions carry no journal activity.
      collaborationEvent("event-7", "IssuesEvent", {
        action: "labeled",
        issue,
      }),
      // Content that occurred before the local day stays out of Today.
      collaborationEvent("event-8", "IssueCommentEvent", {
        action: "created",
        issue: { number: 41, title: "Old thread" },
        comment: { id: 9500, created_at: "2026-03-07T12:00:00Z" },
      }),
    ];
    const fetchFixture = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/user")) return jsonResponse({ id: 7, login: "ada" });
      if (url.includes("/users/ada/events")) return jsonResponse(events);
      throw new Error(`Unexpected fixture request: ${url}`);
    });

    const journal = await reconcileGitHubActivity({
      userId: "user-1",
      timeZone: "America/New_York",
      accessMode: "best-effort",
      installationIds: [],
      accessToken: "fixture-token",
      now: window.now,
      fetchImplementation: fetchFixture as typeof fetch,
      store,
    });

    expect(journal.status).toBe("complete");
    expect(journal.metrics).toEqual({
      pushes: 0,
      commits: 0,
      issues: 1,
      pullRequests: 0,
      reviews: 1,
      merges: 1,
      comments: 2,
    });
    expect(
      journal.activities.map((activity) => activity.deduplicationKey),
    ).toEqual([
      "github:issue-opened:42:41",
      "github:pull-request-comment:42:9001",
      "github:pull-request-review:42:7001",
      "github:pull-request-review-comment:42:8001",
      "github:pull-request-merged:42:52",
    ]);
    expect(journal.activities[0]).toEqual(
      expect.objectContaining({
        kind: "issue-opened",
        actorId: "7",
        actorLogin: "ada",
        repositoryId: "42",
        repositoryName: "acme/private-engine",
        evidenceUrl: "https://github.com/acme/private-engine/issues/41",
        visibility: "private",
        source: "github-events",
        subjectId: "41",
        subjectNumber: 41,
        subjectTitle: "Reconciliation misses reopened issues",
        occurredAt: new Date("2026-03-08T14:30:00Z"),
        authoredBeforeDay: false,
      }),
    );
    expect(JSON.stringify(journal)).not.toContain("PRIVATE");
  });
});
