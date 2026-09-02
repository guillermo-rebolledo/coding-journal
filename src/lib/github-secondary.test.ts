// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  normalizeGistActivity,
  normalizeGistStarActivity,
  normalizeSocialEvent,
  secondarySourceFreshness,
} from "@/lib/github-secondary";
import { getLocalDayWindow } from "@/lib/time-zone";

const now = new Date("2026-08-31T18:00:00.000Z");
const window = getLocalDayWindow(now, "America/Mexico_City");
const actor = { id: 7, login: "ada" };

describe("GitHub secondary reconciliation contracts", () => {
  it("normalizes Gist creation, updates, comments, and forks from metadata only", () => {
    const records = normalizeGistActivity({
      gist: {
        id: "gist-1",
        html_url: "https://gist.github.com/ada/gist-1",
        public: false,
        description: "A bounded description",
        created_at: "2026-08-31T14:00:00.000Z",
        updated_at: "2026-08-31T16:00:00.000Z",
        owner: actor,
        fork_of: { id: "original-gist" },
        files: {
          "secret.ts": {
            content: "DO-NOT-STORE",
            raw_url: "https://gist.githubusercontent.com/private",
          },
        },
      },
      commits: [
        {
          version: "1111111",
          committed_at: "2026-08-31T14:00:00.000Z",
          user: actor,
        },
        {
          version: "2222222",
          committed_at: "2026-08-31T16:00:00.000Z",
          user: actor,
        },
      ],
      comments: [
        {
          id: 31,
          created_at: "2026-08-31T17:00:00.000Z",
          user: actor,
          body: "PRIVATE COMMENT",
        },
      ],
      actor,
      window,
      observedAt: now,
    });

    expect(records).toEqual([
      expect.objectContaining({
        kind: "gist-forked",
        subjectId: "gist-1",
        narrativeEligible: true,
      }),
      expect.objectContaining({
        kind: "gist-updated",
        subjectId: "2222222",
      }),
      expect.objectContaining({
        kind: "gist-comment",
        subjectId: "31",
      }),
    ]);
    expect(JSON.stringify(records)).not.toContain("DO-NOT-STORE");
    expect(JSON.stringify(records)).not.toContain("PRIVATE COMMENT");
    expect(JSON.stringify(records)).not.toContain("gistusercontent");
  });

  it("records currently starred Gists as first-observed metadata without file contents", () => {
    const record = normalizeGistStarActivity({
      gist: {
        id: "starred-gist-1",
        html_url: "https://gist.github.com/grace/starred-gist-1",
        public: true,
        description: "Useful snippet",
        owner: { id: 8, login: "grace" },
        files: { "private.ts": { content: "DO-NOT-STORE" } },
      },
      actor,
      window,
      observedAt: now,
    });

    expect(record).toEqual(
      expect.objectContaining({
        kind: "gist-starred",
        subjectId: "starred-gist-1",
        evidenceUrl: "https://gist.github.com/grace/starred-gist-1",
        occurredAt: now,
        narrativeEligible: false,
      }),
    );
    expect(JSON.stringify(record)).not.toContain("DO-NOT-STORE");
  });

  it("normalizes only exposed star and fork events as narrative-excluded social activity", () => {
    const star = normalizeSocialEvent({
      event: {
        id: "event-star-1",
        type: "WatchEvent",
        actor,
        repo: { id: 42, name: "acme/journal" },
        public: true,
        created_at: "2026-08-31T15:00:00.000Z",
        payload: { action: "started" },
      },
      actor,
      window,
      observedAt: now,
    });
    const fork = normalizeSocialEvent({
      event: {
        id: "event-fork-1",
        type: "ForkEvent",
        actor,
        repo: { id: 42, name: "acme/journal" },
        public: true,
        created_at: "2026-08-31T16:00:00.000Z",
        payload: {
          forkee: {
            id: 43,
            full_name: "ada/journal",
            html_url: "https://github.com/ada/journal",
          },
        },
      },
      actor,
      window,
      observedAt: now,
    });

    expect(star).toEqual(
      expect.objectContaining({
        kind: "repository-starred",
        evidenceUrl: "https://github.com/acme/journal",
        narrativeEligible: false,
      }),
    );
    expect(fork).toEqual(
      expect.objectContaining({
        kind: "repository-forked",
        evidenceUrl: "https://github.com/ada/journal",
        narrativeEligible: false,
      }),
    );
    expect(
      normalizeSocialEvent({
        event: {
          id: "event-reaction-1",
          type: "ReactionEvent",
          actor,
          repo: { id: 42, name: "acme/journal" },
          public: true,
          created_at: "2026-08-31T17:00:00.000Z",
          payload: { action: "created" },
        },
        actor,
        window,
        observedAt: now,
      }),
    ).toBeNull();
  });

  it("reports delayed and unavailable reconciliation-only surfaces honestly", () => {
    expect(
      secondarySourceFreshness({
        refreshedAt: now,
        eventsSucceeded: true,
        gistsSucceeded: false,
      }),
    ).toEqual([
      expect.objectContaining({
        source: "social",
        status: "best-effort",
        refreshedAt: now,
        detail: expect.stringContaining("up to 6 hours"),
      }),
      expect.objectContaining({
        source: "gists",
        status: "unavailable",
        refreshedAt: null,
      }),
    ]);
  });
});
