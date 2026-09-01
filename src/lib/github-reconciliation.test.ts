// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  getLocalDayWindow,
  reconcileGitHubActivity,
  type ActivityRecord,
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
      metrics: { pushes: 0, commits: 0 },
    });
  }

  async read(userId: string, localDate: string): Promise<TodayJournal> {
    const state = this.journals.get(`${userId}:${localDate}`) ?? {
      localDate,
      timeZone: "America/New_York",
      status: "loading" as const,
      refreshedAt: null,
      activities: [],
      metrics: { pushes: 0, commits: 0 },
    };
    const activities = [...this.activities.values()]
      .filter((activity) => activity.localDate === localDate)
      .sort(
        (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
      );

    return {
      ...state,
      activities,
      metrics: {
        pushes: activities.filter((activity) => activity.kind === "push")
          .length,
        commits: activities.filter((activity) => activity.kind === "commit")
          .length,
      },
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

    expect(first.metrics).toEqual({ pushes: 1, commits: 1 });
    expect(repeated.metrics).toEqual({ pushes: 1, commits: 1 });
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
    expect(journal.metrics).toEqual({ pushes: 0, commits: 1 });
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
        metrics: { pushes: 0, commits: 0 },
        activities: [],
      }),
    );
  });
});
