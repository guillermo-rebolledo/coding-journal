import { createHmac, timingSafeEqual } from "node:crypto";

import {
  isJsonObject,
  readArray,
  readBoolean,
  readNumber,
  readObject,
  readObjectArray,
  readPositiveInteger,
  readString,
  type JsonObject,
} from "@/lib/json-payload";
import {
  isStaleGitHubDelivery,
  validGitHubDeliveryId,
} from "@/lib/github-delivery-rules";
import {
  activityIdentity,
  commitDeduplicationKey,
  createActivityRecord,
  pushDeduplicationKey,
  validRepositoryName,
  validSha,
  type ActivityRecord,
} from "@/lib/github-activity";
import { getLocalDayWindow, parseDate } from "@/lib/time-zone";

// Deliveries whose push happened this long before receipt rewrite history the
// journal no longer reconciles; they are acknowledged but never enqueued.
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

/** Narrows a header or decoded string to GitHub's delivery-id form. */
export function validDeliveryId(value: string | null): value is string {
  return validGitHubDeliveryId(value);
}

/**
 * Push webhooks report `repository.pushed_at` as epoch seconds; every other
 * payload uses an ISO string, so both encodings are accepted here.
 */
function readPushedAt(source: JsonObject | null, key: string): Date | null {
  const seconds = readNumber(source, key);
  if (seconds !== null) {
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return parseDate(readString(source, key));
}

export type PushExtraction =
  | { ok: true; message: PushDeliveryMessage }
  | { ok: false; reason: "malformed" | "stale" | "no-activity" };

export function extractPushDelivery({
  payload,
  deliveryId,
  receivedAt,
}: {
  payload: JsonObject | null;
  deliveryId: string;
  receivedAt: Date;
}): PushExtraction {
  if (payload === null) return { ok: false, reason: "malformed" };

  const repository = readObject(payload, "repository");
  const repositoryNumericId = readPositiveInteger(repository, "id");
  const repositoryName = readString(repository, "full_name");
  const isPrivate = readBoolean(repository, "private");
  const before = readString(payload, "before");
  const head = readString(payload, "after");
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
    !validSha(before) ||
    !validSha(head) ||
    senderId === null ||
    senderLogin === null ||
    installationId === null
  ) {
    return { ok: false, reason: "malformed" };
  }

  // A branch or tag deletion pushes an all-zero head and carries no activity.
  if (readBoolean(payload, "deleted") === true || /^0+$/.test(head)) {
    return { ok: false, reason: "no-activity" };
  }

  const pushedAt = readPushedAt(repository, "pushed_at") ?? receivedAt;
  if (isStaleGitHubDelivery(receivedAt, pushedAt)) {
    return { ok: false, reason: "stale" };
  }

  const commits: PushDeliveryMessage["push"]["commits"] = [];
  for (const candidate of readObjectArray(payload, "commits") ?? []) {
    const sha = readString(candidate, "id");
    const authoredAt = parseDate(readString(candidate, "timestamp"));
    if (!validSha(sha) || !authoredAt) continue;
    commits.push({
      sha,
      authoredAt: authoredAt.toISOString(),
      authorLogin: readString(readObject(candidate, "author"), "username"),
    });
  }

  return {
    ok: true,
    message: {
      version: 1,
      deliveryId,
      installationId: String(installationId),
      receivedAt: receivedAt.toISOString(),
      push: {
        repositoryId: String(repositoryNumericId),
        repositoryName,
        private: isPrivate,
        before,
        head,
        pushedAt: pushedAt.toISOString(),
        senderId: String(senderId),
        senderLogin,
        commits,
      },
    },
  };
}

/**
 * Decodes a queue message this service published earlier. The message crossed
 * a queue, so every field is read and checked before the message is rebuilt.
 */
export function parsePushDeliveryMessage(
  value: JsonObject | null,
): PushDeliveryMessage | null {
  if (value === null || readNumber(value, "version") !== 1) return null;

  const deliveryId = readString(value, "deliveryId");
  const installationId = readString(value, "installationId");
  const receivedAt = readString(value, "receivedAt");
  const push = readObject(value, "push");
  const repositoryId = readString(push, "repositoryId");
  const repositoryName = readString(push, "repositoryName");
  const isPrivate = readBoolean(push, "private");
  const before = readString(push, "before");
  const head = readString(push, "head");
  const pushedAt = readString(push, "pushedAt");
  const senderId = readString(push, "senderId");
  const senderLogin = readString(push, "senderLogin");
  const rawCommits = readArray(push, "commits");

  if (
    !validDeliveryId(deliveryId) ||
    installationId === null ||
    receivedAt === null ||
    !parseDate(receivedAt) ||
    push === null ||
    repositoryId === null ||
    !validRepositoryName(repositoryName) ||
    isPrivate === null ||
    !validSha(before) ||
    !validSha(head) ||
    pushedAt === null ||
    !parseDate(pushedAt) ||
    senderId === null ||
    senderLogin === null ||
    rawCommits === null
  ) {
    return null;
  }

  const commits: PushDeliveryMessage["push"]["commits"] = [];
  for (const entry of rawCommits) {
    const commit = isJsonObject(entry) ? entry : null;
    const sha = readString(commit, "sha");
    const authoredAt = readString(commit, "authoredAt");
    // `authorLogin` is nullable rather than optional: an unattributed commit
    // reports null, but a present value must be a login.
    const authorLoginMember =
      commit === null ? undefined : commit["authorLogin"];
    const authorLogin = readString(commit, "authorLogin");
    if (
      !validSha(sha) ||
      authoredAt === null ||
      !parseDate(authoredAt) ||
      (authorLoginMember !== null && authorLogin === null)
    ) {
      return null;
    }
    commits.push({ sha, authoredAt, authorLogin });
  }

  return {
    version: 1,
    deliveryId,
    installationId,
    receivedAt,
    push: {
      repositoryId,
      repositoryName,
      private: isPrivate,
      before,
      head,
      pushedAt,
      senderId,
      senderLogin,
      commits,
    },
  };
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

  const pushKey = pushDeduplicationKey(
    push.repositoryId,
    push.before,
    push.head,
  );
  records.set(
    pushKey,
    createActivityRecord({
      kind: "push",
      identity: activityIdentity.push(
        push.repositoryId,
        push.before,
        push.head,
      ),
      evidence: { shape: "push", before: push.before, head: push.head },
      actor: { id: push.senderId, login: push.senderLogin },
      repository: {
        id: push.repositoryId,
        name: push.repositoryName,
        private: push.private,
      },
      subject: { id: push.head, number: null, title: null },
      source: "github-webhook",
      occurredAt,
      observedAt,
      window,
      installationId: message.installationId,
    }),
  );

  for (const commit of push.commits) {
    if (commit.authorLogin?.toLowerCase() !== push.senderLogin.toLowerCase()) {
      continue;
    }
    const authoredAt = new Date(commit.authoredAt);
    const commitKey = commitDeduplicationKey(push.repositoryId, commit.sha);
    if (records.has(commitKey)) continue;
    records.set(
      commitKey,
      createActivityRecord({
        kind: "commit",
        identity: activityIdentity.commit(push.repositoryId, commit.sha),
        evidence: { shape: "commit", sha: commit.sha },
        actor: { id: push.senderId, login: push.senderLogin },
        repository: {
          id: push.repositoryId,
          name: push.repositoryName,
          private: push.private,
        },
        subject: { id: commit.sha, number: null, title: null },
        source: "github-webhook",
        occurredAt: authoredAt,
        observedAt,
        window,
        installationId: message.installationId,
      }),
    );
  }

  return [...records.values()];
}
