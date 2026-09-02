import {
  collaborationKinds,
  validRepositoryName,
  validSha,
  type ActivityRecord,
  type CollaborationKind,
} from "@/lib/github-activity";
import {
  asString,
  readArray,
  readBoolean,
  readNonEmptyString,
  readNumber,
  readObject,
  readPositiveInteger,
  readString,
  type JsonObject,
} from "@/lib/json-payload";
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

/** The events feed names the same activities differently from webhooks. */
const eventsApiCollaborationTypes = {
  CreateEvent: "create",
  DeleteEvent: "delete",
  ReleaseEvent: "release",
  DiscussionEvent: "discussion",
  IssuesEvent: "issues",
  IssueCommentEvent: "issue_comment",
  PullRequestEvent: "pull_request",
  PullRequestReviewEvent: "pull_request_review",
  PullRequestReviewCommentEvent: "pull_request_review_comment",
} as const satisfies Readonly<Record<string, CollaborationWebhookEvent>>;

type EventsApiType = keyof typeof eventsApiCollaborationTypes;

function isEventsApiType(value: string | null): value is EventsApiType {
  return Object.hasOwn(eventsApiCollaborationTypes, value ?? "");
}

export function collaborationEventForApiType(
  type: string | null,
): CollaborationWebhookEvent | null {
  return isEventsApiType(type) ? eventsApiCollaborationTypes[type] : null;
}

export function isCollaborationWebhookEvent(
  value: string,
): value is CollaborationWebhookEvent {
  return collaborationWebhookEvents.some((event) => event === value);
}

export type CollaborationSubject = {
  kind: CollaborationKind;
  deduplicationKey: string;
  subjectId: string;
  subjectNumber: number | null;
  title: string | null;
  evidenceUrl: string;
  occurredAt: Date;
  attributionKeys?: string[];
};

export type CollaborationDerivation =
  | { ok: true; subject: CollaborationSubject }
  | { ok: false; reason: "unsupported" | "invalid" };

function boundSubjectTitle(value: string | null): string | null {
  if (value === null) return null;
  const title = value.trim();
  if (!title) return null;
  return title.length > subjectTitleMaxLength
    ? `${title.slice(0, subjectTitleMaxLength - 1)}…`
    : title;
}

/** Reads a ref name, rejecting one that is empty or implausibly long. */
function readRefName(source: JsonObject | null, key: string): string | null {
  const ref = readNonEmptyString(source, key);
  return ref !== null && ref.length <= refNameMaxLength ? ref : null;
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
  payload: JsonObject | null,
  repository: { id: string; name: string },
  eventOccurredAt?: Date,
  eventIdentity?: string,
): CollaborationDerivation {
  if (payload === null) return invalid;
  const action = readString(payload, "action");

  if (eventType === "create" || eventType === "delete") {
    if (readString(payload, "pusher_type") !== "user") return unsupported;
    const refType = readString(payload, "ref_type");
    const ref = readRefName(payload, "ref");
    if (
      (refType !== "branch" && refType !== "tag") ||
      ref === null ||
      !eventOccurredAt ||
      !eventIdentity
    ) {
      return invalid;
    }
    const created = eventType === "create";
    const kind: CollaborationKind =
      refType === "branch"
        ? created
          ? "branch-created"
          : "branch-deleted"
        : created
          ? "tag-created"
          : "tag-deleted";
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
        evidenceUrl: `https://github.com/${repository.name}/${refType === "branch" ? "branches" : "tags"}`,
        occurredAt: eventOccurredAt,
      },
    };
  }

  if (action === null) return invalid;

  if (eventType === "release") {
    if (
      !["created", "published", "released", "prereleased", "edited"].includes(
        action,
      )
    ) {
      return unsupported;
    }
    const release = readObject(payload, "release");
    const releaseId = readPositiveInteger(release, "id");
    const tag = readRefName(release, "tag_name");
    const draft = readBoolean(release, "draft");
    if (releaseId === null || tag === null || draft === null) return invalid;
    if (draft) return unsupported;
    const kind: CollaborationKind =
      action === "edited" ? "release-updated" : "release-published";
    const occurredAt = parseDate(
      readString(
        release,
        kind === "release-updated" ? "updated_at" : "published_at",
      ),
    );
    if (!occurredAt) return invalid;
    const discriminator =
      kind === "release-published"
        ? String(releaseId)
        : `${releaseId}:${occurredAt.toISOString()}`;
    return {
      ok: true,
      subject: {
        kind,
        deduplicationKey: collaborationDeduplicationKey(
          kind,
          repository.id,
          discriminator,
        ),
        subjectId: String(releaseId),
        subjectNumber: null,
        title:
          boundSubjectTitle(readString(release, "name")) ??
          boundSubjectTitle(tag),
        evidenceUrl: `https://github.com/${repository.name}/releases/tag/${encodeURIComponent(tag)}`,
        occurredAt,
        attributionKeys: [
          `github:ref:${repository.id}:${encodeURIComponent(tag)}`,
        ],
      },
    };
  }

  if (eventType === "discussion") {
    if (action !== "created" && action !== "answered") return unsupported;
    const discussion = readObject(payload, "discussion");
    const number = readPositiveInteger(discussion, "number");
    if (discussion === null || number === null) return invalid;
    const title = boundSubjectTitle(readString(discussion, "title"));
    if (action === "created") {
      const occurredAt = parseDate(readString(discussion, "created_at"));
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
          title,
          evidenceUrl: `https://github.com/${repository.name}/discussions/${number}`,
          occurredAt,
        },
      };
    }
    const answerId = readPositiveInteger(readObject(payload, "answer"), "id");
    const occurredAt =
      parseDate(readString(discussion, "updated_at")) ?? eventOccurredAt;
    if (answerId === null || !occurredAt) return invalid;
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
        title,
        evidenceUrl: `https://github.com/${repository.name}/discussions/${number}#discussioncomment-${answerId}`,
        occurredAt,
      },
    };
  }

  if (eventType === "discussion_comment") {
    if (action !== "created") return unsupported;
    const discussion = readObject(payload, "discussion");
    const number = readPositiveInteger(discussion, "number");
    const comment = readObject(payload, "comment");
    const commentId = readPositiveInteger(comment, "id");
    if (discussion === null || number === null || commentId === null) {
      return invalid;
    }
    const occurredAt = parseDate(readString(comment, "created_at"));
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
        title: boundSubjectTitle(readString(discussion, "title")),
        evidenceUrl: `https://github.com/${repository.name}/discussions/${number}#discussioncomment-${commentId}`,
        occurredAt,
      },
    };
  }

  if (eventType === "issues") {
    const kind: CollaborationKind | null =
      action === "opened"
        ? "issue-opened"
        : action === "closed"
          ? "issue-closed"
          : action === "reopened"
            ? "issue-reopened"
            : null;
    if (kind === null) return unsupported;
    const issue = readObject(payload, "issue");
    const number = readPositiveInteger(issue, "number");
    if (number === null) return invalid;
    const occurredAt = parseDate(
      readString(
        issue,
        action === "opened"
          ? "created_at"
          : action === "closed"
            ? "closed_at"
            : "updated_at",
      ),
    );
    if (!occurredAt) return invalid;
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
        title: boundSubjectTitle(readString(issue, "title")),
        evidenceUrl: `https://github.com/${repository.name}/issues/${number}`,
        occurredAt,
      },
    };
  }

  if (eventType === "issue_comment") {
    if (action !== "created") return unsupported;
    const issue = readObject(payload, "issue");
    const comment = readObject(payload, "comment");
    const number = readPositiveInteger(issue, "number");
    const commentId = readPositiveInteger(comment, "id");
    if (number === null || commentId === null) return invalid;
    const occurredAt = parseDate(readString(comment, "created_at"));
    if (!occurredAt) return invalid;
    // GitHub delivers pull-request conversation comments on the issue event,
    // distinguished only by this member.
    const onPullRequest = readObject(issue, "pull_request") !== null;
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
        title: boundSubjectTitle(readString(issue, "title")),
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
    const pullRequest = readObject(payload, "pull_request");
    const number = readPositiveInteger(pullRequest, "number");
    if (number === null) return invalid;
    const kind: CollaborationKind =
      action === "opened"
        ? "pull-request-opened"
        : action === "closed"
          ? readBoolean(pullRequest, "merged") === true
            ? "pull-request-merged"
            : "pull-request-closed"
          : action === "reopened"
            ? "pull-request-reopened"
            : "pull-request-updated";
    const occurredAt = parseDate(
      readString(
        pullRequest,
        kind === "pull-request-opened"
          ? "created_at"
          : kind === "pull-request-merged"
            ? "merged_at"
            : kind === "pull-request-closed"
              ? "closed_at"
              : "updated_at",
      ),
    );
    if (!occurredAt) return invalid;
    // Opening and merging happen once; the repeatable transitions carry the
    // state-change instant.
    const discriminator =
      kind === "pull-request-opened" || kind === "pull-request-merged"
        ? `${number}`
        : `${number}:${occurredAt.toISOString()}`;
    const subject: CollaborationSubject = {
      kind,
      deduplicationKey: collaborationDeduplicationKey(
        kind,
        repository.id,
        discriminator,
      ),
      subjectId: String(number),
      subjectNumber: number,
      title: boundSubjectTitle(readString(pullRequest, "title")),
      evidenceUrl: `https://github.com/${repository.name}/pull/${number}`,
      occurredAt,
    };
    // A merge also attributes the merge commit, so the commit observation and
    // the merge observation collapse into one activity.
    const mergeCommitSha = readString(pullRequest, "merge_commit_sha");
    if (kind === "pull-request-merged" && validSha(mergeCommitSha)) {
      subject.attributionKeys = [
        `github:commit:${repository.id}:${mergeCommitSha}`,
      ];
    }
    return { ok: true, subject };
  }

  if (eventType === "pull_request_review") {
    // Webhooks say "submitted"; the events feed says "created".
    if (action !== "submitted" && action !== "created") return unsupported;
    const review = readObject(payload, "review");
    const pullRequest = readObject(payload, "pull_request");
    const number = readPositiveInteger(pullRequest, "number");
    const reviewId = readPositiveInteger(review, "id");
    if (number === null || reviewId === null) return invalid;
    // A lone diff comment auto-submits an empty "commented" review shell; the
    // review-comment observation already carries that work.
    if (
      readString(review, "state") === "commented" &&
      readNonEmptyString(review, "body") === null
    ) {
      return unsupported;
    }
    const occurredAt = parseDate(readString(review, "submitted_at"));
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
        title: boundSubjectTitle(readString(pullRequest, "title")),
        evidenceUrl: `https://github.com/${repository.name}/pull/${number}#pullrequestreview-${reviewId}`,
        occurredAt,
      },
    };
  }

  if (action !== "created") return unsupported;
  const comment = readObject(payload, "comment");
  const pullRequest = readObject(payload, "pull_request");
  const number = readPositiveInteger(pullRequest, "number");
  const commentId = readPositiveInteger(comment, "id");
  if (number === null || commentId === null) return invalid;
  const occurredAt = parseDate(readString(comment, "created_at"));
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
      title: boundSubjectTitle(readString(pullRequest, "title")),
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
      attributionKeys?: string[];
    };
  };
};

export type CollaborationExtraction =
  | { ok: true; message: CollaborationDeliveryMessage }
  | { ok: false; reason: "malformed" | "stale" | "no-activity" };

export function extractCollaborationDelivery({
  eventType,
  payload,
  deliveryId,
  receivedAt,
}: {
  eventType: CollaborationWebhookEvent;
  payload: JsonObject | null;
  deliveryId: string;
  receivedAt: Date;
}): CollaborationExtraction {
  if (payload === null) return { ok: false, reason: "malformed" };

  const repository = readObject(payload, "repository");
  const repositoryNumericId = readPositiveInteger(repository, "id");
  const repositoryName = readString(repository, "full_name");
  const isPrivate = readBoolean(repository, "private");
  const sender = readObject(payload, "sender");
  const senderId = readPositiveInteger(sender, "id");
  const senderLogin = readString(sender, "login");
  const installationId = readPositiveInteger(
    readObject(payload, "installation"),
    "id",
  );

  if (
    repositoryNumericId === null ||
    !validRepositoryName(repositoryName) ||
    isPrivate === null ||
    senderId === null ||
    senderLogin === null ||
    installationId === null
  ) {
    return { ok: false, reason: "malformed" };
  }

  // The journal records the signed-in user's direct activity; bot actors
  // never produce an activity effect.
  if (
    readString(sender, "type") === "Bot" ||
    senderLogin.toLowerCase().endsWith("[bot]")
  ) {
    return { ok: false, reason: "no-activity" };
  }

  const repositoryId = String(repositoryNumericId);
  const derivation = deriveCollaborationSubject(
    eventType,
    payload,
    { id: repositoryId, name: repositoryName },
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
        repositoryId,
        repositoryName,
        private: isPrivate,
        senderId: String(senderId),
        senderLogin,
        subject: {
          kind: subject.kind,
          deduplicationKey: subject.deduplicationKey,
          subjectId: subject.subjectId,
          subjectNumber: subject.subjectNumber,
          title: subject.title,
          evidenceUrl: subject.evidenceUrl,
          occurredAt: subject.occurredAt.toISOString(),
          attributionKeys: subject.attributionKeys,
        },
      },
    },
  };
}

function isCollaborationKind(value: string | null): value is CollaborationKind {
  return value !== null && collaborationKindSet.has(value);
}

/**
 * Decodes a queue message this service published earlier. The message crossed
 * a queue, so every field is read and checked before the message is rebuilt.
 */
export function parseCollaborationDeliveryMessage(
  value: JsonObject | null,
): CollaborationDeliveryMessage | null {
  if (value === null || readNumber(value, "version") !== 1) return null;

  const deliveryId = readNonEmptyString(value, "deliveryId");
  const installationId = readString(value, "installationId");
  const receivedAt = readString(value, "receivedAt");
  const collaboration = readObject(value, "collaboration");
  const repositoryId = readString(collaboration, "repositoryId");
  const repositoryName = readString(collaboration, "repositoryName");
  const isPrivate = readBoolean(collaboration, "private");
  const senderId = readString(collaboration, "senderId");
  const senderLogin = readString(collaboration, "senderLogin");
  const subject = readObject(collaboration, "subject");
  if (
    deliveryId === null ||
    installationId === null ||
    receivedAt === null ||
    !parseDate(receivedAt) ||
    repositoryId === null ||
    !validRepositoryName(repositoryName) ||
    isPrivate === null ||
    senderId === null ||
    senderLogin === null ||
    subject === null
  ) {
    return null;
  }

  const kind = readString(subject, "kind");
  const deduplicationKey = readString(subject, "deduplicationKey");
  const subjectId = readString(subject, "subjectId");
  const subjectNumber = readNumber(subject, "subjectNumber");
  const evidenceUrl = readString(subject, "evidenceUrl");
  const occurredAt = readString(subject, "occurredAt");

  // `subjectNumber` is nullable rather than optional: refs have no number,
  // but a present number must be a real one.
  const numberMember = subject["subjectNumber"];
  if (
    numberMember !== null &&
    (subjectNumber === null ||
      !Number.isSafeInteger(subjectNumber) ||
      subjectNumber <= 0)
  ) {
    return null;
  }

  // `title` is nullable in the same way: absent is malformed, null is a
  // subject that genuinely has no title.
  const titleMember = subject["title"];
  const title = readString(subject, "title");
  if (
    titleMember !== null &&
    (title === null || title.length > subjectTitleMaxLength)
  ) {
    return null;
  }

  const attributionKeys = readSubjectAttributionKeys(subject);
  if (attributionKeys === "invalid") return null;

  if (
    !isCollaborationKind(kind) ||
    deduplicationKey === null ||
    deduplicationKey.length === 0 ||
    deduplicationKey.length > 1024 ||
    subjectId === null ||
    subjectId.length === 0 ||
    subjectId.length > refNameMaxLength ||
    evidenceUrl === null ||
    evidenceUrl.length > 2048 ||
    !evidenceUrl.startsWith("https://github.com/") ||
    occurredAt === null ||
    !parseDate(occurredAt)
  ) {
    return null;
  }

  const message: CollaborationDeliveryMessage = {
    version: 1,
    deliveryId,
    installationId,
    receivedAt,
    collaboration: {
      repositoryId,
      repositoryName,
      private: isPrivate,
      senderId,
      senderLogin,
      subject: {
        kind,
        deduplicationKey,
        subjectId,
        subjectNumber,
        title,
        evidenceUrl,
        occurredAt,
      },
    },
  };
  if (attributionKeys !== undefined) {
    message.collaboration.subject.attributionKeys = attributionKeys;
  }
  return message;
}

/**
 * Reads the optional `attributionKeys` list. Returns `undefined` when the
 * member is absent and the sentinel `"invalid"` when it is present but is not
 * a list of between one and four bounded keys.
 */
function readSubjectAttributionKeys(
  subject: JsonObject,
): string[] | undefined | "invalid" {
  if (subject["attributionKeys"] === undefined) return undefined;
  const entries = readArray(subject, "attributionKeys");
  if (entries === null || entries.length === 0 || entries.length > 4) {
    return "invalid";
  }
  const keys = entries.map((entry) => asString(entry));
  return keys.every((key) => isBoundedAttributionKey(key)) ? keys : "invalid";
}

function isBoundedAttributionKey(value: string | null): value is string {
  return value !== null && value.length <= 1024;
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
      attributionKeys: subject.attributionKeys,
    },
  ];
}
