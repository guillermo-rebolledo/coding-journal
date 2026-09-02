import {
  operationsKinds,
  readAttributionKeys,
  validRepositoryName,
  validSha,
  type ActivityRecord,
  type ActivityStatus,
  type OperationsKind,
} from "@/lib/github-activity";
import { validDeliveryId } from "@/lib/github-webhook";
import {
  readBoolean,
  readNonEmptyString,
  readNumber,
  readObject,
  readPositiveInteger,
  readString,
  type JsonObject,
} from "@/lib/json-payload";
import { getLocalDayWindow, parseDate } from "@/lib/time-zone";

const staleDeliveryMs = 7 * 24 * 60 * 60 * 1000;
const subjectTitleMaxLength = 120;

export const operationsWebhookEvents = [
  "workflow_run",
  "deployment_review",
  "deployment_status",
  "package",
  "registry_package",
] as const;

export type OperationsWebhookEvent = (typeof operationsWebhookEvents)[number];

export function isOperationsWebhookEvent(
  value: string,
): value is OperationsWebhookEvent {
  return operationsWebhookEvents.some((event) => event === value);
}

type OperationsMessage = {
  version: 1;
  deliveryId: string;
  installationId: string;
  receivedAt: string;
  operation: {
    kind: OperationsKind;
    deduplicationKey: string;
    attributionKey: string;
    attributionKeys?: string[];
    attribution: "direct" | "linked";
    repositoryId: string;
    repositoryName: string;
    private: boolean;
    actorId: string;
    actorLogin: string;
    subjectId: string;
    title: string | null;
    occurredAt: string;
    statusOccurredAt?: string;
    status: ActivityStatus;
    evidenceUrl: string;
    narrativeEligible: boolean;
  };
};

export type OperationsExtraction =
  | { ok: true; message: OperationsMessage }
  | { ok: false; reason: "malformed" | "stale" | "no-activity" };

/** The `action` values that describe real package work. */
const packageActions = ["published", "updated", "deleted", "restored"] as const;

type PackageAction = (typeof packageActions)[number];

function isPackageAction(value: string | null): value is PackageAction {
  return packageActions.some((action) => action === value);
}

/** The activity each package action records. */
const packageActionKinds = {
  published: "package-published",
  updated: "package-updated",
  deleted: "package-deleted",
  restored: "package-restored",
} as const satisfies Record<PackageAction, OperationsKind>;

function boundedTitle(value: string | null) {
  if (value === null) return null;
  const title = value.trim();
  if (!title) return null;
  return title.length > subjectTitleMaxLength
    ? `${title.slice(0, subjectTitleMaxLength - 1)}…`
    : title;
}

function workflowStatus(
  action: string | null,
  conclusion: string | null,
): ActivityStatus {
  if (action !== "completed") return "pending";
  if (conclusion === "success") return "success";
  if (conclusion === "cancelled") return "cancelled";
  return "failure";
}

export function extractOperationsDelivery({
  eventType,
  payload,
  deliveryId,
  receivedAt,
}: {
  eventType: OperationsWebhookEvent;
  payload: JsonObject | null;
  deliveryId: string;
  receivedAt: Date;
}): OperationsExtraction {
  if (!validDeliveryId(deliveryId) || payload === null) {
    return { ok: false, reason: "malformed" };
  }

  if (eventType === "package" || eventType === "registry_package") {
    return extractPackageDelivery(payload, eventType, deliveryId, receivedAt);
  }
  if (eventType === "deployment_status") {
    return extractDeploymentDelivery(payload, deliveryId, receivedAt);
  }
  if (eventType !== "workflow_run" && eventType !== "deployment_review") {
    return { ok: false, reason: "no-activity" };
  }

  const approval = eventType === "deployment_review";
  const action = readString(payload, "action");
  const repository = readObject(payload, "repository");
  const repositoryNumericId = readPositiveInteger(repository, "id");
  const repositoryName = readString(repository, "full_name");
  const isPrivate = readBoolean(repository, "private");
  const installationId = readPositiveInteger(
    readObject(payload, "installation"),
    "id",
  );
  const run = readObject(payload, "workflow_run");
  const runId = readPositiveInteger(run, "id");
  const runAttempt = readPositiveInteger(run, "run_attempt");
  const runEvent = readString(run, "event");
  const actor = approval
    ? readObject(payload, "approver")
    : readObject(run, "triggering_actor");
  const actorId = readPositiveInteger(actor, "id");
  const actorLogin = readString(actor, "login");
  const occurredAt = parseDate(readString(run, "created_at"));
  // An approval is stamped by the review event; a run carries its own last
  // transition. Either way the run's start is the fallback.
  const observedOutcomeAt =
    (approval
      ? parseDate(readString(payload, "since"))
      : parseDate(readString(run, "updated_at"))) ?? occurredAt;

  if (
    repositoryNumericId === null ||
    !validRepositoryName(repositoryName) ||
    isPrivate === null ||
    installationId === null ||
    runId === null ||
    runAttempt === null ||
    runEvent === null ||
    actorId === null ||
    actorLogin === null ||
    (approval && readString(actor, "type") !== "User") ||
    !occurredAt ||
    !observedOutcomeAt
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (approval && action !== "approved") {
    return { ok: false, reason: "no-activity" };
  }
  const direct = approval || runEvent === "workflow_dispatch" || runAttempt > 1;
  if (!direct && action !== "completed") {
    return { ok: false, reason: "no-activity" };
  }
  if (receivedAt.getTime() - observedOutcomeAt.getTime() > staleDeliveryMs) {
    return { ok: false, reason: "stale" };
  }

  const repositoryId = String(repositoryNumericId);
  const subjectId = String(runId);
  const key = `github:workflow-run:${repositoryId}:${subjectId}:${runAttempt}`;
  return {
    ok: true,
    message: {
      version: 1,
      deliveryId,
      installationId: String(installationId),
      receivedAt: receivedAt.toISOString(),
      operation: {
        kind: "workflow-run",
        deduplicationKey: key,
        attributionKey: key,
        attribution: direct ? "direct" : "linked",
        repositoryId,
        repositoryName,
        private: isPrivate,
        actorId: String(actorId),
        actorLogin,
        subjectId,
        title: boundedTitle(readString(run, "name")),
        occurredAt: occurredAt.toISOString(),
        statusOccurredAt: observedOutcomeAt.toISOString(),
        status: approval
          ? "approved"
          : workflowStatus(action, readString(run, "conclusion")),
        evidenceUrl: `https://github.com/${repositoryName}/actions/runs/${subjectId}/attempts/${runAttempt}`,
        narrativeEligible: true,
      },
    },
  };
}

function deploymentStatus(value: string | null): ActivityStatus | null {
  if (value === "success") return "success";
  if (value === "failure" || value === "error") return "failure";
  if (value === "inactive") return "cancelled";
  if (value === "pending" || value === "queued" || value === "in_progress") {
    return "pending";
  }
  return null;
}

function extractDeploymentDelivery(
  payload: JsonObject,
  deliveryId: string,
  receivedAt: Date,
): OperationsExtraction {
  const repository = readObject(payload, "repository");
  const repositoryNumericId = readPositiveInteger(repository, "id");
  const repositoryName = readString(repository, "full_name");
  const isPrivate = readBoolean(repository, "private");
  const installationId = readPositiveInteger(
    readObject(payload, "installation"),
    "id",
  );
  const deployment = readObject(payload, "deployment");
  const deploymentNumericId = readPositiveInteger(deployment, "id");
  const sha = readString(deployment, "sha");
  const ref = readNonEmptyString(deployment, "ref");
  const outcome = readObject(payload, "deployment_status");
  const status = deploymentStatus(readString(outcome, "state"));
  const occurredAt = parseDate(readString(deployment, "created_at"));
  const outcomeAt = parseDate(readString(outcome, "created_at"));
  if (
    readString(payload, "action") !== "created" ||
    repositoryNumericId === null ||
    !validRepositoryName(repositoryName) ||
    isPrivate === null ||
    installationId === null ||
    deploymentNumericId === null ||
    !validSha(sha) ||
    ref === null ||
    readPositiveInteger(outcome, "id") === null ||
    !status ||
    !occurredAt ||
    !outcomeAt
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (receivedAt.getTime() - outcomeAt.getTime() > staleDeliveryMs) {
    return { ok: false, reason: "stale" };
  }

  const repositoryId = String(repositoryNumericId);
  // A deployment triggered by a dispatched or re-run workflow is the user's own
  // work; anything else is attributed to the commit and ref it shipped.
  const run = readObject(payload, "workflow_run");
  const runId = readPositiveInteger(run, "id");
  const runAttempt = readPositiveInteger(run, "run_attempt");
  const runActor = readObject(run, "triggering_actor");
  const runActorId = readPositiveInteger(runActor, "id");
  const runActorLogin = readString(runActor, "login");
  const directWorkflow =
    runId !== null &&
    runAttempt !== null &&
    (readString(run, "event") === "workflow_dispatch" || runAttempt > 1) &&
    runActorId !== null &&
    runActorLogin !== null &&
    readString(runActor, "type") === "User";

  const sender = readObject(payload, "sender");
  const senderId = readPositiveInteger(sender, "id");
  const senderLogin = readString(sender, "login");
  const actorId = directWorkflow ? runActorId : senderId;
  const actorLogin = directWorkflow ? runActorLogin : senderLogin;
  if (actorId === null || actorLogin === null) {
    return { ok: false, reason: "malformed" };
  }

  const attributionKeys =
    directWorkflow && runId !== null && runAttempt !== null
      ? [`github:workflow-run:${repositoryId}:${runId}:${runAttempt}`]
      : [
          `github:commit:${repositoryId}:${sha}`,
          `github:ref:${repositoryId}:${encodeURIComponent(ref)}`,
        ];
  const deploymentId = String(deploymentNumericId);
  return {
    ok: true,
    message: {
      version: 1,
      deliveryId,
      installationId: String(installationId),
      receivedAt: receivedAt.toISOString(),
      operation: {
        kind: "deployment",
        deduplicationKey: `github:deployment:${repositoryId}:${deploymentId}`,
        attributionKey: attributionKeys[0]!,
        attributionKeys,
        attribution: directWorkflow ? "direct" : "linked",
        repositoryId,
        repositoryName,
        private: isPrivate,
        actorId: String(actorId),
        actorLogin,
        subjectId: deploymentId,
        title: boundedTitle(readString(deployment, "environment")),
        occurredAt: occurredAt.toISOString(),
        statusOccurredAt: outcomeAt.toISOString(),
        status,
        evidenceUrl: `https://github.com/${repositoryName}/deployments`,
        narrativeEligible: true,
      },
    },
  };
}

function extractPackageDelivery(
  payload: JsonObject,
  eventType: "package" | "registry_package",
  deliveryId: string,
  receivedAt: Date,
): OperationsExtraction {
  const action = readString(payload, "action");
  if (!isPackageAction(action)) return { ok: false, reason: "no-activity" };

  const repository = readObject(payload, "repository");
  const repositoryNumericId = readPositiveInteger(repository, "id");
  const repositoryName = readString(repository, "full_name");
  const isPrivate = readBoolean(repository, "private");
  const installationId = readPositiveInteger(
    readObject(payload, "installation"),
    "id",
  );
  const actor = readObject(payload, "sender");
  const actorId = readPositiveInteger(actor, "id");
  const actorLogin = readString(actor, "login");
  const actorType = readString(actor, "type");
  const packageInfo = readObject(payload, eventType);
  const packageName = readNonEmptyString(packageInfo, "name");
  const version = readObject(packageInfo, "package_version");
  const versionNumericId = readPositiveInteger(version, "id");
  const versionName = readNonEmptyString(version, "version");
  // Publishing stamps the version's creation; every later transition stamps
  // its update.
  const occurredAt = parseDate(
    readString(version, action === "published" ? "created_at" : "updated_at"),
  );
  if (
    repositoryNumericId === null ||
    !validRepositoryName(repositoryName) ||
    isPrivate === null ||
    installationId === null ||
    actorId === null ||
    actorLogin === null ||
    (actorType !== "User" && actorType !== "Bot") ||
    readPositiveInteger(packageInfo, "id") === null ||
    packageName === null ||
    readString(packageInfo, "package_type") === null ||
    versionNumericId === null ||
    versionName === null ||
    !occurredAt
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (receivedAt.getTime() - occurredAt.getTime() > staleDeliveryMs) {
    return { ok: false, reason: "stale" };
  }

  const kind = packageActionKinds[action];
  const repositoryId = String(repositoryNumericId);
  const versionId = String(versionNumericId);
  const targetOid = readString(version, "target_oid");
  const targetCommitish = readNonEmptyString(version, "target_commitish");
  // A person publishing is doing the work. A bot release is only the user's
  // work through the commit or ref it was cut from.
  const direct = actorType === "User";
  const attributionKeys = direct
    ? [`github:package:${repositoryId}:${versionId}`]
    : [
        ...(validSha(targetOid)
          ? [`github:commit:${repositoryId}:${targetOid}`]
          : []),
        ...(targetCommitish
          ? [
              `github:ref:${repositoryId}:${encodeURIComponent(targetCommitish)}`,
            ]
          : []),
      ];
  if (!direct && attributionKeys.length === 0) {
    return { ok: false, reason: "no-activity" };
  }
  const boundedName = boundedTitle(packageName);
  const boundedVersion = boundedTitle(versionName);
  const title =
    boundedName && boundedVersion
      ? boundedTitle(`${boundedName} · ${boundedVersion}`)
      : boundedName;
  const lifecycleIdentity =
    action === "published"
      ? versionId
      : `${versionId}:${occurredAt.toISOString()}`;
  return {
    ok: true,
    message: {
      version: 1,
      deliveryId,
      installationId: String(installationId),
      receivedAt: receivedAt.toISOString(),
      operation: {
        kind,
        deduplicationKey: `github:${kind}:${repositoryId}:${lifecycleIdentity}`,
        attributionKey: attributionKeys[0]!,
        attributionKeys,
        attribution: direct ? "direct" : "linked",
        repositoryId,
        repositoryName,
        private: isPrivate,
        actorId: String(actorId),
        actorLogin,
        subjectId: versionId,
        title,
        occurredAt: occurredAt.toISOString(),
        statusOccurredAt: occurredAt.toISOString(),
        status: action === "deleted" ? "cancelled" : "success",
        evidenceUrl: `https://github.com/${repositoryName}/packages`,
        narrativeEligible: action === "published" || action === "updated",
      },
    },
  };
}

/** The statuses an operations activity may carry, as data the parser can test. */
const operationStatuses = [
  "pending",
  "approved",
  "success",
  "failure",
  "cancelled",
] as const satisfies readonly ActivityStatus[];

function isOperationsKind(value: string | null): value is OperationsKind {
  return operationsKinds.some((kind) => kind === value);
}

function isOperationStatus(value: string | null): value is ActivityStatus {
  return operationStatuses.some((status) => status === value);
}

const maximumKeyLength = 1024;

function isBoundedKey(value: string | null): value is string {
  return value !== null && value.length > 0 && value.length <= maximumKeyLength;
}

/**
 * Decodes a queue message this service published earlier. The message crossed
 * a queue, so it is re-parsed field by field rather than trusted: every value
 * below is read and checked before the message is rebuilt.
 */
export function parseOperationsDeliveryMessage(
  value: JsonObject | null,
): OperationsMessage | null {
  if (value === null || readNumber(value, "version") !== 1) return null;

  const deliveryId = readString(value, "deliveryId");
  const installationId = readString(value, "installationId");
  const receivedAt = readString(value, "receivedAt");
  const operation = readObject(value, "operation");
  if (
    !validDeliveryId(deliveryId) ||
    installationId === null ||
    !/^\d+$/.test(installationId) ||
    receivedAt === null ||
    !parseDate(receivedAt) ||
    operation === null
  ) {
    return null;
  }

  const kind = readString(operation, "kind");
  const deduplicationKey = readString(operation, "deduplicationKey");
  const attributionKey = readString(operation, "attributionKey");
  const attribution = readString(operation, "attribution");
  const repositoryId = readString(operation, "repositoryId");
  const repositoryName = readString(operation, "repositoryName");
  const actorId = readString(operation, "actorId");
  const actorLogin = readString(operation, "actorLogin");
  const isPrivate = readBoolean(operation, "private");
  const subjectId = readString(operation, "subjectId");
  const status = readString(operation, "status");
  const evidenceUrl = readString(operation, "evidenceUrl");
  const narrativeEligible = readBoolean(operation, "narrativeEligible");
  const occurredAt = readString(operation, "occurredAt");

  // `title` is nullable rather than optional: an absent member is malformed,
  // an explicit null is a subject that simply has no title.
  const titleMember = operation["title"];
  const title = readString(operation, "title");
  if (
    titleMember !== null &&
    (title === null || title.length > subjectTitleMaxLength)
  ) {
    return null;
  }

  // `statusOccurredAt` is optional, but a present value must be an instant.
  const statusOccurredAt = readString(operation, "statusOccurredAt");
  if (
    operation["statusOccurredAt"] !== undefined &&
    !parseDate(statusOccurredAt)
  ) {
    return null;
  }

  const attributionKeys = readAttributionKeys(operation, isBoundedKey);
  if (attributionKeys === "invalid") return null;

  if (
    !isOperationsKind(kind) ||
    !isBoundedKey(deduplicationKey) ||
    !isBoundedKey(attributionKey) ||
    (attribution !== "direct" && attribution !== "linked") ||
    repositoryId === null ||
    !validRepositoryName(repositoryName) ||
    actorId === null ||
    actorId.length === 0 ||
    actorLogin === null ||
    actorLogin.length === 0 ||
    isPrivate === null ||
    subjectId === null ||
    subjectId.length === 0 ||
    subjectId.length > 255 ||
    occurredAt === null ||
    !parseDate(occurredAt) ||
    !isOperationStatus(status) ||
    evidenceUrl === null ||
    evidenceUrl.length > 2048 ||
    !evidenceUrl.startsWith(`https://github.com/${repositoryName}/`) ||
    narrativeEligible === null
  ) {
    return null;
  }

  const message: OperationsMessage = {
    version: 1,
    deliveryId,
    installationId,
    receivedAt,
    operation: {
      kind,
      deduplicationKey,
      attributionKey,
      attribution,
      repositoryId,
      repositoryName,
      private: isPrivate,
      actorId,
      actorLogin,
      subjectId,
      title,
      occurredAt,
      status,
      evidenceUrl,
      narrativeEligible,
    },
  };
  if (attributionKeys !== undefined) {
    message.operation.attributionKeys = attributionKeys;
  }
  if (statusOccurredAt !== null) {
    message.operation.statusOccurredAt = statusOccurredAt;
  }
  return message;
}

export function normalizeOperationsMessage(
  message: OperationsMessage,
  user: { githubAccountId: string; timeZone: string },
): ActivityRecord[] {
  const { operation } = message;
  if (
    operation.attribution === "direct" &&
    operation.actorId !== user.githubAccountId
  ) {
    return [];
  }
  const occurredAt = new Date(operation.occurredAt);
  return [
    {
      deduplicationKey: operation.deduplicationKey,
      localDate: getLocalDayWindow(occurredAt, user.timeZone).localDate,
      kind: operation.kind,
      actorId: operation.actorId,
      actorLogin: operation.actorLogin,
      repositoryId: operation.repositoryId,
      repositoryName: operation.repositoryName,
      evidenceUrl: operation.evidenceUrl,
      visibility: operation.private ? "private" : "public",
      source: "github-webhook",
      subjectId: operation.subjectId,
      subjectNumber: null,
      subjectTitle: operation.title,
      occurredAt,
      observedAt: new Date(message.receivedAt),
      authoredBeforeDay: false,
      installationId: message.installationId,
      status: operation.status,
      statusOccurredAt: new Date(
        operation.statusOccurredAt ?? operation.occurredAt,
      ),
      narrativeEligible: operation.narrativeEligible,
      attributionKey: operation.attributionKey,
      attributionKeys: operation.attributionKeys ?? [operation.attributionKey],
      attributed: operation.attribution === "direct",
    },
  ];
}
