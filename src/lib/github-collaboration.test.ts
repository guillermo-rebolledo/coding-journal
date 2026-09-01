// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  deriveCollaborationSubject,
  extractCollaborationDelivery,
  normalizeCollaborationMessage,
  parseCollaborationDeliveryMessage,
  subjectTitleMaxLength,
  type CollaborationDeliveryMessage,
  type CollaborationWebhookEvent,
} from "@/lib/github-collaboration";

const receivedAt = new Date("2026-03-08T15:00:05Z");
const user = { githubAccountId: "7", timeZone: "America/New_York" };

const envelope = {
  repository: { id: 42, full_name: "acme/private-engine", private: true },
  sender: { id: 7, login: "ada", type: "User" },
  installation: { id: 99 },
};

function issuePayload(overrides: Record<string, unknown> = {}) {
  return {
    ...envelope,
    action: "opened",
    issue: {
      number: 41,
      title: "Reconciliation misses reopened issues",
      body: "PRIVATE-ISSUE-BODY with reproduction details",
      created_at: "2026-03-08T14:30:00Z",
      closed_at: null,
      updated_at: "2026-03-08T14:30:00Z",
    },
    ...overrides,
  };
}

function pullRequestPayload(overrides: Record<string, unknown> = {}) {
  return {
    ...envelope,
    action: "opened",
    pull_request: {
      number: 52,
      title: "Track issue and pull-request collaboration",
      body: "PRIVATE-PR-BODY describing the diff",
      merged: false,
      created_at: "2026-03-08T14:00:00Z",
      closed_at: null,
      merged_at: null,
      updated_at: "2026-03-08T14:00:00Z",
    },
    ...overrides,
  };
}

function extract(
  eventType: CollaborationWebhookEvent,
  payload: unknown,
  at = receivedAt,
) {
  return extractCollaborationDelivery({
    eventType,
    payload,
    deliveryId: "delivery-1",
    receivedAt: at,
  });
}

function extractedMessage(
  eventType: CollaborationWebhookEvent,
  payload: unknown,
): CollaborationDeliveryMessage {
  const extraction = extract(eventType, payload);
  if (!extraction.ok)
    throw new Error(`extraction failed: ${extraction.reason}`);
  return extraction.message;
}

describe("GitHub collaboration delivery extraction", () => {
  it("normalizes branch and tag lifecycle activity without retaining payload details", () => {
    const branch = extractedMessage("create", {
      ...envelope,
      ref: "feature/private-roadmap",
      ref_type: "branch",
      pusher_type: "user",
      description: "PRIVATE-REPOSITORY-DESCRIPTION",
    });
    expect(branch.collaboration.subject).toMatchObject({
      kind: "branch-created",
      subjectId: "feature/private-roadmap",
      subjectNumber: null,
      title: "feature/private-roadmap",
      evidenceUrl: "https://github.com/acme/private-engine/branches",
    });

    const tag = extractedMessage("delete", {
      ...envelope,
      ref: "v2.0.0",
      ref_type: "tag",
      pusher_type: "user",
    });
    expect(tag.collaboration.subject).toMatchObject({
      kind: "tag-deleted",
      subjectId: "v2.0.0",
      subjectNumber: null,
      title: "v2.0.0",
      evidenceUrl: "https://github.com/acme/private-engine/tags",
    });
    expect(JSON.stringify(branch)).not.toContain("PRIVATE");
  });

  it("normalizes release publication and updates without retaining bodies or assets", () => {
    const release = {
      id: 501,
      tag_name: "v2.0.0",
      name: "Version 2",
      body: "PRIVATE-RELEASE-NOTES",
      draft: false,
      published_at: "2026-03-08T14:20:00Z",
      updated_at: "2026-03-08T14:40:00Z",
      assets: [{ name: "private-debug-symbols.zip" }],
    };
    const published = extractedMessage("release", {
      ...envelope,
      action: "published",
      release,
    });
    expect(published.collaboration.subject).toMatchObject({
      kind: "release-published",
      deduplicationKey: "github:release-published:42:501",
      subjectId: "501",
      subjectNumber: null,
      title: "Version 2",
      evidenceUrl: "https://github.com/acme/private-engine/releases/tag/v2.0.0",
      occurredAt: "2026-03-08T14:20:00.000Z",
      attributionKeys: ["github:ref:42:v2.0.0"],
    });

    const updated = extractedMessage("release", {
      ...envelope,
      action: "edited",
      release,
    });
    expect(updated.collaboration.subject).toMatchObject({
      kind: "release-updated",
      deduplicationKey:
        "github:release-updated:42:501:2026-03-08T14:40:00.000Z",
    });
    expect(JSON.stringify([published, updated])).not.toContain("PRIVATE");
    expect(JSON.stringify([published, updated])).not.toContain("assets");

    const reconciled = deriveCollaborationSubject(
      "release",
      { action: "published", release },
      { id: "42", name: "acme/private-engine" },
    );
    expect(reconciled.ok && reconciled.subject.deduplicationKey).toBe(
      published.collaboration.subject.deduplicationKey,
    );
  });

  it("normalizes discussion creation, comments, and answers without retaining content", () => {
    const discussion = {
      number: 73,
      title: "How should reconciliation report gaps?",
      body: "PRIVATE-DISCUSSION-BODY",
      created_at: "2026-03-08T14:10:00Z",
      updated_at: "2026-03-08T14:45:00Z",
    };
    const created = extractedMessage("discussion", {
      ...envelope,
      action: "created",
      discussion,
    });
    const commented = extractedMessage("discussion_comment", {
      ...envelope,
      action: "created",
      discussion,
      comment: {
        id: 8801,
        body: "PRIVATE-DISCUSSION-COMMENT",
        created_at: "2026-03-08T14:30:00Z",
      },
    });
    const answered = extractedMessage("discussion", {
      ...envelope,
      action: "answered",
      discussion,
      answer: { id: 8801, body: "PRIVATE-ANSWER" },
    });

    expect(created.collaboration.subject).toMatchObject({
      kind: "discussion-created",
      deduplicationKey: "github:discussion-created:42:73",
      subjectNumber: 73,
    });
    expect(commented.collaboration.subject).toMatchObject({
      kind: "discussion-comment",
      deduplicationKey: "github:discussion-comment:42:8801",
      evidenceUrl:
        "https://github.com/acme/private-engine/discussions/73#discussioncomment-8801",
    });
    expect(answered.collaboration.subject).toMatchObject({
      kind: "discussion-answered",
      subjectId: "8801",
      subjectNumber: 73,
    });
    expect(JSON.stringify([created, commented, answered])).not.toContain(
      "PRIVATE",
    );
  });

  it("excludes reactions and deploy-key ref changes entirely", () => {
    expect(
      extract("create", {
        ...envelope,
        ref: "automation",
        ref_type: "branch",
        pusher_type: "deploy_key",
      }),
    ).toEqual({ ok: false, reason: "no-activity" });
    expect(
      extract("discussion", {
        ...envelope,
        action: "labeled",
        discussion: { number: 73 },
        reaction: { content: "+1" },
      }),
    ).toEqual({ ok: false, reason: "no-activity" });
    expect(
      extract("release", {
        ...envelope,
        action: "edited",
        release: {
          id: 501,
          tag_name: "v2.0.0",
          draft: true,
          updated_at: "2026-03-08T14:40:00Z",
        },
      }),
    ).toEqual({ ok: false, reason: "no-activity" });
  });

  it("keeps repeated ref lifecycle deliveries distinct", () => {
    const refPayload = {
      ref: "feature/journal",
      ref_type: "branch",
      pusher_type: "user",
    };
    const first = extractedMessage("create", {
      ...envelope,
      ...refPayload,
    }).collaboration.subject.deduplicationKey;
    const secondExtraction = extractCollaborationDelivery({
      eventType: "create",
      payload: { ...envelope, ...refPayload },
      deliveryId: "delivery-2",
      receivedAt,
    });
    if (!secondExtraction.ok) throw new Error("second extraction failed");
    const second =
      secondExtraction.message.collaboration.subject.deduplicationKey;

    expect(first).not.toBe(second);
    expect(first).toContain(encodeURIComponent("feature/journal"));
  });

  it("projects an opened issue into a minimal queue message", () => {
    expect(extract("issues", issuePayload())).toEqual({
      ok: true,
      message: {
        version: 1,
        deliveryId: "delivery-1",
        installationId: "99",
        receivedAt: receivedAt.toISOString(),
        collaboration: {
          repositoryId: "42",
          repositoryName: "acme/private-engine",
          private: true,
          senderId: "7",
          senderLogin: "ada",
          subject: {
            kind: "issue-opened",
            deduplicationKey: "github:issue-opened:42:41",
            subjectId: "41",
            subjectNumber: 41,
            title: "Reconciliation misses reopened issues",
            evidenceUrl: "https://github.com/acme/private-engine/issues/41",
            occurredAt: "2026-03-08T14:30:00.000Z",
          },
        },
      },
    });
  });

  it("keys issue closure and reopening on their state-change instants", () => {
    const closed = extractedMessage(
      "issues",
      issuePayload({
        action: "closed",
        issue: {
          number: 41,
          title: "Reconciliation misses reopened issues",
          created_at: "2026-03-08T14:30:00Z",
          closed_at: "2026-03-08T14:45:00Z",
          updated_at: "2026-03-08T14:45:00Z",
        },
      }),
    );
    expect(closed.collaboration.subject).toMatchObject({
      kind: "issue-closed",
      deduplicationKey: "github:issue-closed:42:41:2026-03-08T14:45:00.000Z",
      occurredAt: "2026-03-08T14:45:00.000Z",
    });

    const reopened = extractedMessage(
      "issues",
      issuePayload({
        action: "reopened",
        issue: {
          number: 41,
          title: "Reconciliation misses reopened issues",
          created_at: "2026-03-08T14:30:00Z",
          closed_at: null,
          updated_at: "2026-03-08T14:50:00Z",
        },
      }),
    );
    expect(reopened.collaboration.subject).toMatchObject({
      kind: "issue-reopened",
      deduplicationKey: "github:issue-reopened:42:41:2026-03-08T14:50:00.000Z",
    });
  });

  it("keys comments on their comment id and separates issue from pull-request threads", () => {
    const comment = {
      id: 9001,
      body: "PRIVATE-COMMENT-BODY",
      created_at: "2026-03-08T14:35:00Z",
    };
    const onIssue = extractedMessage(
      "issue_comment",
      issuePayload({ action: "created", comment }),
    );
    expect(onIssue.collaboration.subject).toMatchObject({
      kind: "issue-comment",
      deduplicationKey: "github:issue-comment:42:9001",
      subjectId: "9001",
      subjectNumber: 41,
      evidenceUrl:
        "https://github.com/acme/private-engine/issues/41#issuecomment-9001",
    });

    const onPullRequest = extractedMessage(
      "issue_comment",
      issuePayload({
        action: "created",
        comment,
        issue: {
          number: 52,
          title: "Track issue and pull-request collaboration",
          pull_request: { url: "https://api.github.com/..." },
        },
      }),
    );
    expect(onPullRequest.collaboration.subject).toMatchObject({
      kind: "pull-request-comment",
      deduplicationKey: "github:pull-request-comment:42:9001",
      subjectNumber: 52,
      evidenceUrl:
        "https://github.com/acme/private-engine/pull/52#issuecomment-9001",
    });
  });

  it("distinguishes merged, closed, reopened, and updated pull requests", () => {
    expect(
      extractedMessage("pull_request", pullRequestPayload()).collaboration
        .subject,
    ).toMatchObject({
      kind: "pull-request-opened",
      deduplicationKey: "github:pull-request-opened:42:52",
      evidenceUrl: "https://github.com/acme/private-engine/pull/52",
      occurredAt: "2026-03-08T14:00:00.000Z",
    });

    const merged = extractedMessage(
      "pull_request",
      pullRequestPayload({
        action: "closed",
        pull_request: {
          number: 52,
          title: "Track issue and pull-request collaboration",
          merged: true,
          merge_commit_sha: "abcdef1234567",
          created_at: "2026-03-08T14:00:00Z",
          closed_at: "2026-03-08T14:40:00Z",
          merged_at: "2026-03-08T14:40:00Z",
          updated_at: "2026-03-08T14:40:00Z",
        },
      }),
    );
    expect(merged.collaboration.subject).toMatchObject({
      kind: "pull-request-merged",
      deduplicationKey: "github:pull-request-merged:42:52",
      occurredAt: "2026-03-08T14:40:00.000Z",
      attributionKeys: ["github:commit:42:abcdef1234567"],
    });

    const closed = extractedMessage(
      "pull_request",
      pullRequestPayload({
        action: "closed",
        pull_request: {
          number: 52,
          title: "Track issue and pull-request collaboration",
          merged: false,
          created_at: "2026-03-08T14:00:00Z",
          closed_at: "2026-03-08T14:41:00Z",
          merged_at: null,
          updated_at: "2026-03-08T14:41:00Z",
        },
      }),
    );
    expect(closed.collaboration.subject).toMatchObject({
      kind: "pull-request-closed",
      deduplicationKey:
        "github:pull-request-closed:42:52:2026-03-08T14:41:00.000Z",
    });

    expect(
      extractedMessage(
        "pull_request",
        pullRequestPayload({
          action: "reopened",
          pull_request: {
            number: 52,
            title: "Track issue and pull-request collaboration",
            merged: false,
            created_at: "2026-03-08T14:00:00Z",
            updated_at: "2026-03-08T14:42:00Z",
          },
        }),
      ).collaboration.subject.kind,
    ).toBe("pull-request-reopened");

    expect(
      extractedMessage(
        "pull_request",
        pullRequestPayload({ action: "ready_for_review" }),
      ).collaboration.subject.kind,
    ).toBe("pull-request-updated");
    expect(
      extractedMessage("pull_request", pullRequestPayload({ action: "edited" }))
        .collaboration.subject.kind,
    ).toBe("pull-request-updated");
  });

  it("records submitted reviews but skips the empty shell wrapping a lone diff comment", () => {
    const review = {
      id: 7001,
      state: "approved",
      body: "PRIVATE-REVIEW-BODY",
      submitted_at: "2026-03-08T14:36:00Z",
    };
    const submitted = extractedMessage(
      "pull_request_review",
      pullRequestPayload({ action: "submitted", review }),
    );
    expect(submitted.collaboration.subject).toMatchObject({
      kind: "pull-request-review",
      deduplicationKey: "github:pull-request-review:42:7001",
      subjectId: "7001",
      subjectNumber: 52,
      evidenceUrl:
        "https://github.com/acme/private-engine/pull/52#pullrequestreview-7001",
    });

    // The events feed reports the same submission with action "created".
    expect(
      extract(
        "pull_request_review",
        pullRequestPayload({ action: "created", review }),
      ).ok,
    ).toBe(true);

    expect(
      extract(
        "pull_request_review",
        pullRequestPayload({
          action: "submitted",
          review: { ...review, state: "commented", body: null },
        }),
      ),
    ).toEqual({ ok: false, reason: "no-activity" });
  });

  it("records review comments on the diff", () => {
    const message = extractedMessage(
      "pull_request_review_comment",
      pullRequestPayload({
        action: "created",
        comment: {
          id: 8001,
          body: "PRIVATE-DIFF-COMMENT",
          diff_hunk: "@@ -1,3 +1,3 @@ PRIVATE-DIFF-HUNK",
          path: "src/lib/example.ts",
          created_at: "2026-03-08T14:37:00Z",
        },
      }),
    );
    expect(message.collaboration.subject).toMatchObject({
      kind: "pull-request-review-comment",
      deduplicationKey: "github:pull-request-review-comment:42:8001",
      evidenceUrl:
        "https://github.com/acme/private-engine/pull/52#discussion_r8001",
      occurredAt: "2026-03-08T14:37:00.000Z",
    });
  });

  it("keeps only a bounded title and never bodies, diffs, or patches", () => {
    const longTitle = "long title ".repeat(30).trim();
    const message = extractedMessage(
      "issue_comment",
      issuePayload({
        action: "created",
        comment: {
          id: 9001,
          body: "PRIVATE-COMMENT-BODY",
          created_at: "2026-03-08T14:35:00Z",
        },
        issue: { number: 41, title: longTitle, body: "PRIVATE-ISSUE-BODY" },
      }),
    );

    const title = message.collaboration.subject.title!;
    expect(title.length).toBe(subjectTitleMaxLength);
    expect(title.endsWith("…")).toBe(true);
    expect(JSON.stringify(message)).not.toContain("PRIVATE");
    expect(
      JSON.stringify(
        extractedMessage(
          "pull_request_review_comment",
          pullRequestPayload({
            action: "created",
            comment: {
              id: 8001,
              body: "PRIVATE-DIFF-COMMENT",
              diff_hunk: "PRIVATE-DIFF-HUNK",
              created_at: "2026-03-08T14:37:00Z",
            },
          }),
        ),
      ),
    ).not.toContain("PRIVATE");
  });

  it("excludes bot senders and unsupported actions without failing the delivery", () => {
    expect(
      extract(
        "issues",
        issuePayload({
          sender: { id: 900, login: "dependabot[bot]", type: "Bot" },
        }),
      ),
    ).toEqual({ ok: false, reason: "no-activity" });
    expect(
      extract(
        "issues",
        issuePayload({
          sender: { id: 900, login: "Renovate[bot]", type: "User" },
        }),
      ),
    ).toEqual({ ok: false, reason: "no-activity" });
    expect(extract("issues", issuePayload({ action: "labeled" }))).toEqual({
      ok: false,
      reason: "no-activity",
    });
    expect(
      extract("pull_request", pullRequestPayload({ action: "synchronize" })),
    ).toEqual({ ok: false, reason: "no-activity" });
    expect(
      extract("issue_comment", issuePayload({ action: "edited" })),
    ).toEqual({ ok: false, reason: "no-activity" });
  });

  it("rejects deliveries missing identity or content fields as malformed", () => {
    expect(extract("issues", null)).toEqual({ ok: false, reason: "malformed" });
    expect(
      extract("issues", issuePayload({ installation: undefined })),
    ).toEqual({ ok: false, reason: "malformed" });
    expect(extract("issues", issuePayload({ repository: { id: 42 } }))).toEqual(
      { ok: false, reason: "malformed" },
    );
    expect(extract("issues", issuePayload({ issue: { title: "x" } }))).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(
      extract(
        "issue_comment",
        issuePayload({ action: "created", comment: { id: 9001 } }),
      ),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("acknowledges but never enqueues week-old history", () => {
    expect(
      extract("issues", issuePayload(), new Date("2026-03-16T15:00:00Z")),
    ).toEqual({ ok: false, reason: "stale" });
  });
});

describe("GitHub collaboration message contract", () => {
  const message = extractedMessage("issues", issuePayload());

  it("round-trips through the queue's JSON encoding", () => {
    expect(
      parseCollaborationDeliveryMessage(JSON.parse(JSON.stringify(message))),
    ).toEqual(message);
  });

  it("rejects messages another deployment cannot have produced", () => {
    expect(parseCollaborationDeliveryMessage(null)).toBeNull();
    expect(parseCollaborationDeliveryMessage({})).toBeNull();
    expect(
      parseCollaborationDeliveryMessage({ ...message, version: 2 }),
    ).toBeNull();
    expect(
      parseCollaborationDeliveryMessage({
        ...message,
        collaboration: {
          ...message.collaboration,
          subject: { ...message.collaboration.subject, kind: "push" },
        },
      }),
    ).toBeNull();
    expect(
      parseCollaborationDeliveryMessage({
        ...message,
        collaboration: {
          ...message.collaboration,
          subject: {
            ...message.collaboration.subject,
            title: "x".repeat(500),
          },
        },
      }),
    ).toBeNull();
    expect(
      parseCollaborationDeliveryMessage({
        ...message,
        collaboration: {
          ...message.collaboration,
          subject: {
            ...message.collaboration.subject,
            evidenceUrl: "https://evil.example/issues/41",
          },
        },
      }),
    ).toBeNull();
  });
});

describe("GitHub collaboration normalization", () => {
  const message = extractedMessage("issues", issuePayload());

  it("normalizes the sender's own action into one canonical record", () => {
    expect(normalizeCollaborationMessage(message, user)).toEqual([
      {
        deduplicationKey: "github:issue-opened:42:41",
        localDate: "2026-03-08",
        kind: "issue-opened",
        actorId: "7",
        actorLogin: "ada",
        repositoryId: "42",
        repositoryName: "acme/private-engine",
        evidenceUrl: "https://github.com/acme/private-engine/issues/41",
        visibility: "private",
        source: "github-webhook",
        subjectId: "41",
        subjectNumber: 41,
        subjectTitle: "Reconciliation misses reopened issues",
        occurredAt: new Date("2026-03-08T14:30:00Z"),
        observedAt: receivedAt,
        authoredBeforeDay: false,
        installationId: "99",
      },
    ]);
  });

  it("attributes nothing when the sender is another participant", () => {
    expect(
      normalizeCollaborationMessage(message, {
        ...user,
        githubAccountId: "8",
      }),
    ).toEqual([]);
  });

  it("preserves public repository visibility", () => {
    const publicMessage = extractedMessage("discussion_comment", {
      ...envelope,
      repository: {
        id: 42,
        full_name: "acme/open-engine",
        private: false,
      },
      action: "created",
      discussion: {
        number: 73,
        title: "Public design question",
      },
      comment: { id: 8801, created_at: "2026-03-08T14:35:00Z" },
    });

    expect(normalizeCollaborationMessage(publicMessage, user)[0]).toMatchObject(
      {
        repositoryName: "acme/open-engine",
        visibility: "public",
      },
    );
  });

  it("dates the record on the user's local day, not UTC", () => {
    const lateEvening = extractedMessage(
      "issues",
      issuePayload({
        issue: {
          number: 41,
          title: "Reconciliation misses reopened issues",
          created_at: "2026-03-09T03:30:00Z",
        },
      }),
    );
    const [record] = normalizeCollaborationMessage(lateEvening, user);
    expect(record?.localDate).toBe("2026-03-08");
  });
});
