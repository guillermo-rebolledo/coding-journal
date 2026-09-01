// @vitest-environment node

import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  extractPushDelivery,
  normalizePushMessage,
  parsePushDeliveryMessage,
  verifyGitHubSignature,
  type PushDeliveryMessage,
} from "@/lib/github-webhook";

const secret = "webhook-secret";

function sign(body: string, signingSecret = secret) {
  return `sha256=${createHmac("sha256", signingSecret).update(body).digest("hex")}`;
}

function pushPayload(overrides: Record<string, unknown> = {}) {
  return {
    ref: "refs/heads/main",
    before: "1111111",
    after: "2222222",
    repository: {
      id: 42,
      full_name: "acme/private-engine",
      private: true,
      pushed_at: Date.parse("2026-03-08T15:00:00Z") / 1000,
    },
    sender: { id: 7, login: "ada" },
    installation: { id: 99 },
    commits: [
      {
        id: "2222222",
        timestamp: "2026-03-07T21:00:00Z",
        author: { username: "ada" },
      },
      {
        id: "3333333",
        timestamp: "2026-03-08T16:00:00Z",
        author: { username: "grace" },
      },
    ],
    ...overrides,
  };
}

const receivedAt = new Date("2026-03-08T15:00:05Z");

function extract(overrides: Record<string, unknown> = {}) {
  return extractPushDelivery({
    payload: pushPayload(overrides),
    deliveryId: "delivery-1",
    receivedAt,
  });
}

describe("GitHub webhook signatures", () => {
  it("accepts a signature computed over the exact raw body", () => {
    const body = JSON.stringify(pushPayload());
    expect(verifyGitHubSignature(body, sign(body), secret)).toBe(true);
  });

  it("rejects tampered bodies, wrong secrets, and malformed headers", () => {
    const body = JSON.stringify(pushPayload());
    expect(verifyGitHubSignature(`${body} `, sign(body), secret)).toBe(false);
    expect(verifyGitHubSignature(body, sign(body, "other"), secret)).toBe(
      false,
    );
    expect(verifyGitHubSignature(body, null, secret)).toBe(false);
    expect(verifyGitHubSignature(body, "sha1=abc", secret)).toBe(false);
    expect(verifyGitHubSignature(body, "sha256=abc", secret)).toBe(false);
  });
});

describe("GitHub push delivery extraction", () => {
  it("projects a verified push into a minimal queue message", () => {
    const extraction = extract();

    expect(extraction).toEqual({
      ok: true,
      message: {
        version: 1,
        deliveryId: "delivery-1",
        installationId: "99",
        receivedAt: receivedAt.toISOString(),
        push: {
          repositoryId: "42",
          repositoryName: "acme/private-engine",
          private: true,
          before: "1111111",
          head: "2222222",
          pushedAt: "2026-03-08T15:00:00.000Z",
          senderId: "7",
          senderLogin: "ada",
          commits: [
            {
              sha: "2222222",
              authoredAt: "2026-03-07T21:00:00.000Z",
              authorLogin: "ada",
            },
            {
              sha: "3333333",
              authoredAt: "2026-03-08T16:00:00.000Z",
              authorLogin: "grace",
            },
          ],
        },
      },
    });
  });

  it("rejects payloads missing an installation or repository identity", () => {
    expect(extract({ installation: undefined })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(extract({ repository: { id: 42 } })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(extract({ sender: { login: "ada" } })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(
      extractPushDelivery({
        payload: null,
        deliveryId: "delivery-1",
        receivedAt,
      }),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("acknowledges branch deletions and stale replays without activity", () => {
    expect(extract({ deleted: true })).toEqual({
      ok: false,
      reason: "no-activity",
    });
    expect(
      extract({ after: "0000000000000000000000000000000000000000" }),
    ).toEqual({ ok: false, reason: "no-activity" });
    expect(
      extract({
        repository: {
          id: 42,
          full_name: "acme/private-engine",
          private: true,
          pushed_at: Date.parse("2026-02-20T15:00:00Z") / 1000,
        },
      }),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("drops commit entries it cannot verify instead of failing the push", () => {
    const extraction = extract({
      commits: [
        { id: "not-a-sha", timestamp: "2026-03-08T16:00:00Z" },
        { id: "4444444", timestamp: "not-a-date" },
        { id: "5555555", timestamp: "2026-03-08T16:00:00Z", author: null },
      ],
    });

    expect(extraction.ok).toBe(true);
    if (extraction.ok) {
      expect(extraction.message.push.commits).toEqual([
        {
          sha: "5555555",
          authoredAt: "2026-03-08T16:00:00.000Z",
          authorLogin: null,
        },
      ]);
    }
  });
});

describe("GitHub push delivery normalization", () => {
  const message = (() => {
    const extraction = extract();
    if (!extraction.ok) throw new Error("Fixture extraction failed");
    return extraction.message;
  })();

  it("applies the reconciliation local-day and dedup-key rules", () => {
    const records = normalizePushMessage(message, {
      githubAccountId: "7",
      timeZone: "America/New_York",
    });

    expect(records).toEqual([
      expect.objectContaining({
        deduplicationKey: "github:push:42:1111111:2222222",
        kind: "push",
        localDate: "2026-03-08",
        actorId: "7",
        actorLogin: "ada",
        repositoryId: "42",
        repositoryName: "acme/private-engine",
        evidenceUrl:
          "https://github.com/acme/private-engine/compare/1111111...2222222",
        visibility: "private",
        source: "github-webhook",
        subjectId: "2222222",
        subjectNumber: null,
        subjectTitle: null,
        occurredAt: new Date("2026-03-08T15:00:00Z"),
        authoredBeforeDay: false,
        installationId: "99",
      }),
      expect.objectContaining({
        deduplicationKey: "github:commit:42:2222222",
        kind: "commit",
        localDate: "2026-03-08",
        evidenceUrl: "https://github.com/acme/private-engine/commit/2222222",
        occurredAt: new Date("2026-03-07T21:00:00Z"),
        authoredBeforeDay: true,
        source: "github-webhook",
      }),
    ]);
  });

  it("attributes nothing when the pusher is not the journal user", () => {
    expect(
      normalizePushMessage(message, {
        githubAccountId: "8",
        timeZone: "America/New_York",
      }),
    ).toEqual([]);
  });
});

describe("GitHub push delivery message parsing", () => {
  const message = (() => {
    const extraction = extract();
    if (!extraction.ok) throw new Error("Fixture extraction failed");
    return extraction.message;
  })();

  it("round-trips a producer message through JSON", () => {
    expect(
      parsePushDeliveryMessage(
        JSON.parse(JSON.stringify(message)) as PushDeliveryMessage,
      ),
    ).toEqual(message);
  });

  it("rejects messages from an incompatible deployment", () => {
    expect(parsePushDeliveryMessage(null)).toBeNull();
    expect(parsePushDeliveryMessage({ version: 2 })).toBeNull();
    expect(
      parsePushDeliveryMessage({
        ...message,
        push: { ...message.push, head: "" },
      }),
    ).toBeNull();
  });
});
