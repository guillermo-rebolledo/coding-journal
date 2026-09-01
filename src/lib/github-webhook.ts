import { createHmac, timingSafeEqual } from "node:crypto";

import {
  commitDeduplicationKey,
  getLocalDayWindow,
  parseDate,
  pushDeduplicationKey,
  pushEvidenceUrl,
  validRepositoryName,
  validSha,
  type ActivityRecord,
} from "@/lib/github-reconciliation";

// Deliveries whose push happened this long before receipt rewrite history the
// journal no longer reconciles; they are acknowledged but never enqueued.
const staleDeliveryMs = 7 * 24 * 60 * 60 * 1000;

export const webhookDeliveryTopic = "github-webhook-deliveries";

export type PushDeliveryMessage = {
  version: 1;
  deliveryId: string;
  installationId: string;
  receivedAt: string;
  push: {
    repositoryId: string;
    repositoryName: string;
    private: boolean;
    before: string;
    head: string;
    pushedAt: string;
    senderId: string;
    senderLogin: string;
    commits: Array<{
      sha: string;
      authoredAt: string;
      authorLogin: string | null;
    }>;
  };
};

export function verifyGitHubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
) {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export function validDeliveryId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{1,100}$/.test(value);
}

// Push webhooks report repository.pushed_at as epoch seconds; other payloads
// use ISO strings.
function parsePushedAt(value: unknown) {
  if (typeof value === "number") {
    const date = new Date(value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return parseDate(value);
}

type PushWebhookPayload = {
  deleted?: unknown;
  repository?: {
    id?: unknown;
    full_name?: unknown;
    private?: unknown;
    pushed_at?: unknown;
  };
  before?: unknown;
  after?: unknown;
  sender?: { id?: unknown; login?: unknown };
  installation?: { id?: unknown };
  commits?: unknown;
};

export type PushExtraction =
  | { ok: true; message: PushDeliveryMessage }
  | { ok: false; reason: "malformed" | "stale" | "no-activity" };

export function extractPushDelivery({
  payload,
  deliveryId,
  receivedAt,
}: {
  payload: unknown;
  deliveryId: string;
  receivedAt: Date;
}): PushExtraction {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, reason: "malformed" };
  }
  const push = payload as PushWebhookPayload;
  const repository = push.repository;
  const sender = push.sender;
  const installationId = push.installation?.id;

  if (
    typeof repository?.id !== "number" ||
    !validRepositoryName(repository.full_name) ||
    typeof repository.private !== "boolean" ||
    !validSha(push.before) ||
    !validSha(push.after) ||
    typeof sender?.id !== "number" ||
    typeof sender.login !== "string" ||
    typeof installationId !== "number" ||
    installationId <= 0
  ) {
    return { ok: false, reason: "malformed" };
  }

  // A branch or tag deletion pushes an all-zero head and carries no activity.
  if (push.deleted === true || /^0+$/.test(push.after)) {
    return { ok: false, reason: "no-activity" };
  }

  const pushedAt = parsePushedAt(repository.pushed_at) ?? receivedAt;

  if (receivedAt.getTime() - pushedAt.getTime() > staleDeliveryMs) {
    return { ok: false, reason: "stale" };
  }

  const commits: PushDeliveryMessage["push"]["commits"] = [];
  if (Array.isArray(push.commits)) {
    for (const candidate of push.commits as Array<{
      id?: unknown;
      timestamp?: unknown;
      author?: { username?: unknown } | null;
    }>) {
      const authoredAt = parseDate(candidate.timestamp);
      if (!validSha(candidate.id) || !authoredAt) continue;
      commits.push({
        sha: candidate.id,
        authoredAt: authoredAt.toISOString(),
        authorLogin:
          typeof candidate.author?.username === "string"
            ? candidate.author.username
            : null,
      });
    }
  }

  return {
    ok: true,
    message: {
      version: 1,
      deliveryId,
      installationId: String(installationId),
      receivedAt: receivedAt.toISOString(),
      push: {
        repositoryId: String(repository.id),
        repositoryName: repository.full_name,
        private: repository.private,
        before: push.before,
        head: push.after,
        pushedAt: pushedAt.toISOString(),
        senderId: String(sender.id),
        senderLogin: sender.login,
        commits,
      },
    },
  };
}

export function parsePushDeliveryMessage(
  value: unknown,
): PushDeliveryMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Partial<PushDeliveryMessage>;
  const push = message.push;
  if (
    message.version !== 1 ||
    !validDeliveryId(message.deliveryId) ||
    typeof message.installationId !== "string" ||
    !parseDate(message.receivedAt) ||
    typeof push !== "object" ||
    push === null ||
    typeof push.repositoryId !== "string" ||
    !validRepositoryName(push.repositoryName) ||
    typeof push.private !== "boolean" ||
    !validSha(push.before) ||
    !validSha(push.head) ||
    !parseDate(push.pushedAt) ||
    typeof push.senderId !== "string" ||
    typeof push.senderLogin !== "string" ||
    !Array.isArray(push.commits) ||
    push.commits.some(
      (commit) =>
        !validSha(commit?.sha) ||
        !parseDate(commit.authoredAt) ||
        (commit.authorLogin !== null && typeof commit.authorLogin !== "string"),
    )
  ) {
    return null;
  }
  return message as PushDeliveryMessage;
}

export function normalizePushMessage(
  message: PushDeliveryMessage,
  user: { githubAccountId: string; timeZone: string },
): ActivityRecord[] {
  const { push } = message;
  if (push.senderId !== user.githubAccountId) return [];

  const occurredAt = new Date(push.pushedAt);
  const observedAt = new Date(message.receivedAt);
  const window = getLocalDayWindow(occurredAt, user.timeZone);
  const records = new Map<string, ActivityRecord>();
  const visibility = push.private ? "private" : "public";

  const pushKey = pushDeduplicationKey(
    push.repositoryId,
    push.before,
    push.head,
  );
  records.set(pushKey, {
    deduplicationKey: pushKey,
    localDate: window.localDate,
    kind: "push",
    actorId: push.senderId,
    actorLogin: push.senderLogin,
    repositoryId: push.repositoryId,
    repositoryName: push.repositoryName,
    evidenceUrl: pushEvidenceUrl(push.repositoryName, push.before, push.head),
    visibility,
    source: "github-webhook",
    subjectId: push.head,
    subjectNumber: null,
    subjectTitle: null,
    occurredAt,
    observedAt,
    authoredBeforeDay: false,
    installationId: message.installationId,
  });

  for (const commit of push.commits) {
    if (commit.authorLogin?.toLowerCase() !== push.senderLogin.toLowerCase()) {
      continue;
    }
    const authoredAt = new Date(commit.authoredAt);
    const commitKey = commitDeduplicationKey(push.repositoryId, commit.sha);
    if (records.has(commitKey)) continue;
    records.set(commitKey, {
      deduplicationKey: commitKey,
      localDate: window.localDate,
      kind: "commit",
      actorId: push.senderId,
      actorLogin: push.senderLogin,
      repositoryId: push.repositoryId,
      repositoryName: push.repositoryName,
      evidenceUrl: `https://github.com/${push.repositoryName}/commit/${commit.sha}`,
      visibility,
      source: "github-webhook",
      subjectId: commit.sha,
      subjectNumber: null,
      subjectTitle: null,
      occurredAt: authoredAt,
      observedAt,
      authoredBeforeDay: authoredAt < window.startsAt,
      installationId: message.installationId,
    });
  }

  return [...records.values()];
}
