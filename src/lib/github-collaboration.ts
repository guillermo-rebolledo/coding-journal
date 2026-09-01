import {
  collaborationKinds,
  validRepositoryName,
  type ActivityRecord,
  type CollaborationKind,
} from "@/lib/github-activity";
import { getLocalDayWindow, parseDate } from "@/lib/time-zone";

// Deliveries whose action happened this long before receipt describe history
// the journal no longer reconciles; they are acknowledged but never enqueued.
const staleDeliveryMs = 7 * 24 * 60 * 60 * 1000;

// Titles and ref/tag names are the only free text this activity contract
// keeps. Bodies, diffs, patches, release assets, and comments are never
// retained.
export const subjectTitleMaxLength = 120;
const refNameMaxLength = 255;

export const collaborationWebhookEvents = [
  "create",
  "delete",
  "release",
  "discussion",
  "discussion_comment",
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
] as const;

export type CollaborationWebhookEvent =
  (typeof collaborationWebhookEvents)[number];

const eventsApiCollaborationTypes: Record<string, CollaborationWebhookEvent> = {
  CreateEvent: "create",
  DeleteEvent: "delete",
  ReleaseEvent: "release",
  DiscussionEvent: "discussion",
  IssuesEvent: "issues",
  IssueCommentEvent: "issue_comment",
  PullRequestEvent: "pull_request",
  PullRequestReviewEvent: "pull_request_review",
  PullRequestReviewCommentEvent: "pull_request_review_comment",
};

export function collaborationEventForApiType(
  type: unknown,
): CollaborationWebhookEvent | null {
  return typeof type === "string"
    ? (eventsApiCollaborationTypes[type] ?? null)
    : null;
}

export function isCollaborationWebhookEvent(
  value: string,
): value is CollaborationWebhookEvent {
  return (collaborationWebhookEvents as readonly string[]).includes(value);
}

export type CollaborationSubject = {
  kind: CollaborationKind;
  deduplicationKey: string;
  subjectId: string;
  subjectNumber: number | null;
  title: string | null;
  evidenceUrl: string;
  occurredAt: Date;
};

export type CollaborationDerivation =
  | { ok: true; subject: CollaborationSubject }
  | { ok: false; reason: "unsupported" | "invalid" };

type CollaborationPayload = {
  action?: unknown;
  ref?: unknown;
  ref_type?: unknown;
  pusher_type?: unknown;
  release?: {
    id?: unknown;
    tag_name?: unknown;
    name?: unknown;
    draft?: unknown;
    published_at?: unknown;
    updated_at?: unknown;
  } | null;
  discussion?: {
    number?: unknown;
    title?: unknown;
    created_at?: unknown;
    updated_at?: unknown;
  } | null;
  answer?: { id?: unknown } | null;
  issue?: {
    number?: unknown;
    title?: unknown;
    created_at?: unknown;
    closed_at?: unknown;
    updated_at?: unknown;
    pull_request?: unknown;
  } | null;
  pull_request?: {
    number?: unknown;
    title?: unknown;
    created_at?: unknown;
    closed_at?: unknown;
    merged_at?: unknown;
    updated_at?: unknown;
    merged?: unknown;
  } | null;
  comment?: { id?: unknown; created_at?: unknown } | null;
  review?: {
    id?: unknown;
    submitted_at?: unknown;
    state?: unknown;
    body?: unknown;
  } | null;
};

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function boundSubjectTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim();
  if (!title) return null;
  return title.length > subjectTitleMaxLength
    ? `${title.slice(0, subjectTitleMaxLength - 1)}…`
    : title;
}

const unsupported = { ok: false, reason: "unsupported" } as const;
const invalid = { ok: false, reason: "invalid" } as const;

const collaborationKindSet = new Set<string>(collaborationKinds);

function collaborationDeduplicationKey(
  kind: CollaborationKind,
  repositoryId: string,
  discriminator: string | number,
) {
  return `github:${kind}:${repositoryId}:${discriminator}`;
}

// Maps one observed issue or pull-request action onto its canonical subject.
// Keys derive from content (numbers, comment/review ids, state-change times),
// never from delivery or events-feed ids, so both sources compute the same
// key for the same underlying action.
export function deriveCollaborationSubject(
  eventType: CollaborationWebhookEvent,
  payload: unknown,
  repository: { id: string; name: string },
  eventOccurredAt?: Date,
  eventIdentity?: string,
): CollaborationDerivation {
  if (typeof payload !== "object" || payload === null) return invalid;
  const collaboration = payload as CollaborationPayload;
  const action = collaboration.action;

  if (eventType === "create" || eventType === "delete") {
    if (collaboration.pusher_type !== "user") return unsupported;
    if (
      (collaboration.ref_type !== "branch" &&
        collaboration.ref_type !== "tag") ||
      typeof collaboration.ref !== "string" ||
      !collaboration.ref.trim() ||
      collaboration.ref.trim().length > refNameMaxLength ||
      !eventOccurredAt ||
      !eventIdentity
    ) {
      return invalid;
    }
    const ref = collaboration.ref.trim();
    const kind =
      `${collaboration.ref_type}-${eventType === "create" ? "created" : "deleted"}` as CollaborationKind;
    return {
      ok: true,
      subject: {
        kind,
        deduplicationKey: collaborationDeduplicationKey(
          kind,
          repository.id,
          `${encodeURIComponent(ref)}:${eventIdentity}`,
        ),
        subjectId: ref,
        subjectNumber: null,
        title: boundSubjectTitle(ref),
        evidenceUrl: `https://github.com/${repository.name}/${collaboration.ref_type === "branch" ? "branches" : "tags"}`,
        occurredAt: eventOccurredAt,
      },
    };
  }

  if (typeof action !== "string") return invalid;

  if (eventType === "release") {
    if (
      !["created", "published", "released", "prereleased", "edited"].includes(
        action,
      )
    ) {
      return unsupported;
    }
    const release = collaboration.release;
    if (
      !positiveInteger(release?.id) ||
      typeof release.tag_name !== "string" ||
      !release.tag_name.trim() ||
      release.tag_name.trim().length > refNameMaxLength ||
      typeof release.draft !== "boolean"
    ) {
      return invalid;
    }
    if (release.draft) return unsupported;
    const kind: CollaborationKind =
      action === "edited" ? "release-updated" : "release-published";
    const occurredAt = parseDate(
      kind === "release-updated" ? release.updated_at : release.published_at,
    );
    if (!occurredAt) return invalid;
    const discriminator =
      kind === "release-published"
        ? String(release.id)
        : `${release.id}:${occurredAt.toISOString()}`;
    const tag = release.tag_name.trim();
    return {
      ok: true,
      subject: {
        kind,
        deduplicationKey: collaborationDeduplicationKey(
          kind,
          repository.id,
          discriminator,
        ),
        subjectId: String(release.id),
        subjectNumber: null,
        title: boundSubjectTitle(release.name) ?? boundSubjectTitle(tag),
        evidenceUrl: `https://github.com/${repository.name}/releases/tag/${encodeURIComponent(tag)}`,
        occurredAt,
      },
    };
  }

  if (eventType === "discussion") {
    if (action !== "created" && action !== "answered") return unsupported;
    const discussion = collaboration.discussion;
    const number = discussion?.number;
    if (!discussion || !positiveInteger(number)) return invalid;
    if (action === "created") {
      const occurredAt = parseDate(discussion.created_at);
      if (!occurredAt) return invalid;
      return {
        ok: true,
        subject: {
          kind: "discussion-created",
          deduplicationKey: collaborationDeduplicationKey(
            "discussion-created",
            repository.id,
            number,
          ),
          subjectId: String(number),
          subjectNumber: number,
          title: boundSubjectTitle(discussion.title),
          evidenceUrl: `https://github.com/${repository.name}/discussions/${number}`,
          occurredAt,
        },
      };
    }
    const answerId = collaboration.answer?.id;
    const occurredAt = parseDate(discussion.updated_at) ?? eventOccurredAt;
    if (!positiveInteger(answerId) || !occurredAt) return invalid;
    return {
      ok: true,
      subject: {
        kind: "discussion-answered",
        deduplicationKey: collaborationDeduplicationKey(
          "discussion-answered",
          repository.id,
          `${answerId}:${occurredAt.toISOString()}`,
        ),
        subjectId: String(answerId),
        subjectNumber: number,
        title: boundSubjectTitle(discussion.title),
        evidenceUrl: `https://github.com/${repository.name}/discussions/${number}#discussioncomment-${answerId}`,
        occurredAt,
      },
    };
  }

  if (eventType === "discussion_comment") {
    if (action !== "created") return unsupported;
    const discussion = collaboration.discussion;
    const number = discussion?.number;
    const commentId = collaboration.comment?.id;
    if (!discussion || !positiveInteger(number) || !positiveInteger(commentId))
      return invalid;
    const occurredAt = parseDate(collaboration.comment?.created_at);
    if (!occurredAt) return invalid;
    return {
      ok: true,
      subject: {
        kind: "discussion-comment",
        deduplicationKey: collaborationDeduplicationKey(
          "discussion-comment",
          repository.id,
          commentId,
        ),
        subjectId: String(commentId),
        subjectNumber: number,
        title: boundSubjectTitle(discussion.title),
        evidenceUrl: `https://github.com/${repository.name}/discussions/${number}#discussioncomment-${commentId}`,
        occurredAt,
      },
    };
  }

  if (eventType === "issues") {
    if (!["opened", "closed", "reopened"].includes(action)) return unsupported;
    const issue = collaboration.issue;
    const number = issue?.number;
    if (!positiveInteger(number)) return invalid;
    const occurredAt =
      action === "opened"
        ? parseDate(issue?.created_at)
        : action === "closed"
          ? parseDate(issue?.closed_at)
          : parseDate(issue?.updated_at);
    if (!occurredAt) return invalid;
    const kind = `issue-${action}` as CollaborationKind;
    // Opening happens once; closing and reopening can repeat, so their keys
    // carry the state-change instant both sources report identically.
    const discriminator =
      action === "opened"
        ? `${number}`
        : `${number}:${occurredAt.toISOString()}`;
    return {
      ok: true,
      subject: {
        kind,
        deduplicationKey: collaborationDeduplicationKey(
          kind,
          repository.id,
          discriminator,
        ),
        subjectId: String(number),
        subjectNumber: number,
        title: boundSubjectTitle(issue?.title),
        evidenceUrl: `https://github.com/${repository.name}/issues/${number}`,
        occurredAt,
      },
    };
  }

  if (eventType === "issue_comment") {
    if (action !== "created") return unsupported;
    const issue = collaboration.issue;
    const comment = collaboration.comment;
    const number = issue?.number;
    const commentId = comment?.id;
    if (!positiveInteger(number) || !positiveInteger(commentId)) return invalid;
    const occurredAt = parseDate(comment?.created_at);
    if (!occurredAt) return invalid;
    const onPullRequest =
      typeof issue?.pull_request === "object" && issue.pull_request !== null;
    const kind = onPullRequest ? "pull-request-comment" : "issue-comment";
    return {
      ok: true,
      subject: {
        kind,
        deduplicationKey: collaborationDeduplicationKey(
          kind,
          repository.id,
          commentId,
        ),
        subjectId: String(commentId),
        subjectNumber: number,
        title: boundSubjectTitle(issue?.title),
        evidenceUrl: `https://github.com/${repository.name}/${onPullRequest ? "pull" : "issues"}/${number}#issuecomment-${commentId}`,
        occurredAt,
      },
    };
  }

  if (eventType === "pull_request") {
    // "synchronize" is deliberately unsupported: the commits it announces
    // already reach the journal through push ingestion, and recording both
    // would double-count the same work.
    if (
      !["opened", "closed", "reopened", "edited", "ready_for_review"].includes(
        action,
      )
    ) {
      return unsupported;
    }
    const pullRequest = collaboration.pull_request;
    const number = pullRequest?.number;
    if (!positiveInteger(number)) return invalid;
    const kind: CollaborationKind =
      action === "opened"
        ? "pull-request-opened"
        : action === "closed"
          ? pullRequest?.merged === true
            ? "pull-request-merged"
            : "pull-request-closed"
          : action === "reopened"
            ? "pull-request-reopened"
            : "pull-request-updated";
    const occurredAt =
      kind === "pull-request-opened"
        ? parseDate(pullRequest?.created_at)
        : kind === "pull-request-merged"
          ? parseDate(pullRequest?.merged_at)
          : kind === "pull-request-closed"
            ? parseDate(pullRequest?.closed_at)
            : parseDate(pullRequest?.updated_at);
    if (!occurredAt) return invalid;
    // Opening and merging happen once; the repeatable transitions carry the
    // state-change instant.
    const discriminator =
      kind === "pull-request-opened" || kind === "pull-request-merged"
        ? `${number}`
        : `${number}:${occurredAt.toISOString()}`;
    return {
      ok: true,
      subject: {
        kind,
        deduplicationKey: collaborationDeduplicationKey(
          kind,
          repository.id,
          discriminator,
        ),
        subjectId: String(number),
        subjectNumber: number,
        title: boundSubjectTitle(pullRequest?.title),
        evidenceUrl: `https://github.com/${repository.name}/pull/${number}`,
        occurredAt,
      },
    };
  }

  if (eventType === "pull_request_review") {
    // Webhooks say "submitted"; the events feed says "created".
    if (action !== "submitted" && action !== "created") return unsupported;
    const review = collaboration.review;
    const pullRequest = collaboration.pull_request;
    const number = pullRequest?.number;
    const reviewId = review?.id;
    if (!positiveInteger(number) || !positiveInteger(reviewId)) return invalid;
    // A lone diff comment auto-submits an empty "commented" review shell; the
    // review-comment observation already carries that work.
    if (
      review?.state === "commented" &&
      !(typeof review.body === "string" && review.body.trim())
    ) {
      return unsupported;
    }
    const occurredAt = parseDate(review?.submitted_at);
    if (!occurredAt) return invalid;
    return {
      ok: true,
      subject: {
        kind: "pull-request-review",
        deduplicationKey: collaborationDeduplicationKey(
          "pull-request-review",
          repository.id,
          reviewId,
        ),
        subjectId: String(reviewId),
        subjectNumber: number,
        title: boundSubjectTitle(pullRequest?.title),
        evidenceUrl: `https://github.com/${repository.name}/pull/${number}#pullrequestreview-${reviewId}`,
        occurredAt,
      },
    };
  }

  if (action !== "created") return unsupported;
  const comment = collaboration.comment;
  const pullRequest = collaboration.pull_request;
  const number = pullRequest?.number;
  const commentId = comment?.id;
  if (!positiveInteger(number) || !positiveInteger(commentId)) return invalid;
  const occurredAt = parseDate(comment?.created_at);
  if (!occurredAt) return invalid;
  return {
    ok: true,
    subject: {
      kind: "pull-request-review-comment",
      deduplicationKey: collaborationDeduplicationKey(
        "pull-request-review-comment",
        repository.id,
        commentId,
      ),
      subjectId: String(commentId),
      subjectNumber: number,
      title: boundSubjectTitle(pullRequest?.title),
      evidenceUrl: `https://github.com/${repository.name}/pull/${number}#discussion_r${commentId}`,
      occurredAt,
    },
  };
}

export type CollaborationDeliveryMessage = {
  version: 1;
  deliveryId: string;
  installationId: string;
  receivedAt: string;
  collaboration: {
    repositoryId: string;
    repositoryName: string;
    private: boolean;
    senderId: string;
    senderLogin: string;
    subject: {
      kind: CollaborationKind;
      deduplicationKey: string;
      subjectId: string;
      subjectNumber: number | null;
      title: string | null;
      evidenceUrl: string;
      occurredAt: string;
    };
  };
};

export type CollaborationExtraction =
  | { ok: true; message: CollaborationDeliveryMessage }
  | { ok: false; reason: "malformed" | "stale" | "no-activity" };

type CollaborationWebhookEnvelope = {
  repository?: { id?: unknown; full_name?: unknown; private?: unknown } | null;
  sender?: { id?: unknown; login?: unknown; type?: unknown } | null;
  installation?: { id?: unknown } | null;
};

export function extractCollaborationDelivery({
  eventType,
  payload,
  deliveryId,
  receivedAt,
}: {
  eventType: CollaborationWebhookEvent;
  payload: unknown;
  deliveryId: string;
  receivedAt: Date;
}): CollaborationExtraction {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, reason: "malformed" };
  }
  const envelope = payload as CollaborationWebhookEnvelope;
  const repository = envelope.repository;
  const sender = envelope.sender;
  const installationId = envelope.installation?.id;

  if (
    typeof repository?.id !== "number" ||
    !validRepositoryName(repository.full_name) ||
    typeof repository.private !== "boolean" ||
    typeof sender?.id !== "number" ||
    typeof sender.login !== "string" ||
    typeof installationId !== "number" ||
    installationId <= 0
  ) {
    return { ok: false, reason: "malformed" };
  }

  // The journal records the signed-in user's direct activity; bot actors
  // never produce an activity effect.
  if (sender.type === "Bot" || sender.login.toLowerCase().endsWith("[bot]")) {
    return { ok: false, reason: "no-activity" };
  }

  const derivation = deriveCollaborationSubject(
    eventType,
    payload,
    {
      id: String(repository.id),
      name: repository.full_name,
    },
    receivedAt,
    deliveryId,
  );
  if (!derivation.ok) {
    return derivation.reason === "invalid"
      ? { ok: false, reason: "malformed" }
      : { ok: false, reason: "no-activity" };
  }
  const { subject } = derivation;

  if (receivedAt.getTime() - subject.occurredAt.getTime() > staleDeliveryMs) {
    return { ok: false, reason: "stale" };
  }

  return {
    ok: true,
    message: {
      version: 1,
      deliveryId,
      installationId: String(installationId),
      receivedAt: receivedAt.toISOString(),
      collaboration: {
        repositoryId: String(repository.id),
        repositoryName: repository.full_name,
        private: repository.private,
        senderId: String(sender.id),
        senderLogin: sender.login,
        subject: {
          kind: subject.kind,
          deduplicationKey: subject.deduplicationKey,
          subjectId: subject.subjectId,
          subjectNumber: subject.subjectNumber,
          title: subject.title,
          evidenceUrl: subject.evidenceUrl,
          occurredAt: subject.occurredAt.toISOString(),
        },
      },
    },
  };
}

export function parseCollaborationDeliveryMessage(
  value: unknown,
): CollaborationDeliveryMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Partial<CollaborationDeliveryMessage>;
  const collaboration = message.collaboration;
  const subject = collaboration?.subject;
  if (
    message.version !== 1 ||
    typeof message.deliveryId !== "string" ||
    message.deliveryId.length === 0 ||
    typeof message.installationId !== "string" ||
    !parseDate(message.receivedAt) ||
    typeof collaboration !== "object" ||
    collaboration === null ||
    typeof collaboration.repositoryId !== "string" ||
    !validRepositoryName(collaboration.repositoryName) ||
    typeof collaboration.private !== "boolean" ||
    typeof collaboration.senderId !== "string" ||
    typeof collaboration.senderLogin !== "string" ||
    typeof subject !== "object" ||
    subject === null ||
    typeof subject.kind !== "string" ||
    !collaborationKindSet.has(subject.kind) ||
    typeof subject.deduplicationKey !== "string" ||
    subject.deduplicationKey.length === 0 ||
    subject.deduplicationKey.length > 1024 ||
    typeof subject.subjectId !== "string" ||
    subject.subjectId.length === 0 ||
    subject.subjectId.length > refNameMaxLength ||
    (subject.subjectNumber !== null &&
      !positiveInteger(subject.subjectNumber)) ||
    (subject.title !== null &&
      (typeof subject.title !== "string" ||
        subject.title.length > subjectTitleMaxLength)) ||
    typeof subject.evidenceUrl !== "string" ||
    subject.evidenceUrl.length > 2048 ||
    !subject.evidenceUrl.startsWith("https://github.com/") ||
    !parseDate(subject.occurredAt)
  ) {
    return null;
  }
  return message as CollaborationDeliveryMessage;
}

export function normalizeCollaborationMessage(
  message: CollaborationDeliveryMessage,
  user: { githubAccountId: string; timeZone: string },
): ActivityRecord[] {
  const { collaboration } = message;
  if (collaboration.senderId !== user.githubAccountId) return [];

  const { subject } = collaboration;
  const occurredAt = new Date(subject.occurredAt);
  const window = getLocalDayWindow(occurredAt, user.timeZone);

  return [
    {
      deduplicationKey: subject.deduplicationKey,
      localDate: window.localDate,
      kind: subject.kind,
      actorId: collaboration.senderId,
      actorLogin: collaboration.senderLogin,
      repositoryId: collaboration.repositoryId,
      repositoryName: collaboration.repositoryName,
      evidenceUrl: subject.evidenceUrl,
      visibility: collaboration.private ? "private" : "public",
      source: "github-webhook",
      subjectId: subject.subjectId,
      subjectNumber: subject.subjectNumber,
      subjectTitle: subject.title,
      occurredAt,
      observedAt: new Date(message.receivedAt),
      authoredBeforeDay: false,
      installationId: message.installationId,
    },
  ];
}
