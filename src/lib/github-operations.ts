import {
  validRepositoryName,
  type ActivityRecord,
  type ActivityStatus,
  type OperationsKind,
} from "@/lib/github-activity";
import { validDeliveryId } from "@/lib/github-webhook";
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
  return (operationsWebhookEvents as readonly string[]).includes(value);
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

type Actor = { id?: unknown; login?: unknown; type?: unknown } | null;

type OperationsPayload = {
  action?: unknown;
  repository?: {
    id?: unknown;
    full_name?: unknown;
    private?: unknown;
  } | null;
  sender?: Actor;
  approver?: Actor;
  installation?: { id?: unknown } | null;
  workflow_run?: {
    id?: unknown;
    run_attempt?: unknown;
    name?: unknown;
    event?: unknown;
    status?: unknown;
    conclusion?: unknown;
    created_at?: unknown;
    updated_at?: unknown;
    triggering_actor?: Actor;
  } | null;
  since?: unknown;
  package?: PackagePayload | null;
  registry_package?: PackagePayload | null;
  deployment?: {
    id?: unknown;
    sha?: unknown;
    ref?: unknown;
    created_at?: unknown;
    environment?: unknown;
  } | null;
  deployment_status?: {
    id?: unknown;
    state?: unknown;
    created_at?: unknown;
  } | null;
};

type PackagePayload = {
  id?: unknown;
  name?: unknown;
  package_type?: unknown;
  package_version?: {
    id?: unknown;
    version?: unknown;
    created_at?: unknown;
    updated_at?: unknown;
    target_commitish?: unknown;
    target_oid?: unknown;
  } | null;
};

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function boundedTitle(value: unknown) {
  if (typeof value !== "string") return null;
  const title = value.trim();
  if (!title) return null;
  return title.length > subjectTitleMaxLength
    ? `${title.slice(0, subjectTitleMaxLength - 1)}…`
    : title;
}

function workflowStatus(action: unknown, conclusion: unknown): ActivityStatus {
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
  payload: unknown;
  deliveryId: string;
  receivedAt: Date;
}): OperationsExtraction {
  if (
    !validDeliveryId(deliveryId) ||
    typeof payload !== "object" ||
    payload === null
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (eventType === "package" || eventType === "registry_package") {
    return extractPackageDelivery(
      payload as OperationsPayload,
      eventType,
      deliveryId,
      receivedAt,
    );
  }
  if (eventType === "deployment_status") {
    return extractDeploymentDelivery(
      payload as OperationsPayload,
      deliveryId,
      receivedAt,
    );
  }
  if (eventType !== "workflow_run" && eventType !== "deployment_review") {
    return { ok: false, reason: "no-activity" };
  }

  const candidate = payload as OperationsPayload;
  const repository = candidate.repository;
  const run = candidate.workflow_run;
  const approval = eventType === "deployment_review";
  const actor = approval ? candidate.approver : run?.triggering_actor;
  const installationId = candidate.installation?.id;
  const occurredAt = parseDate(run?.created_at);
  const observedOutcomeAt =
    (approval ? parseDate(candidate.since) : parseDate(run?.updated_at)) ??
    occurredAt;

  if (
    !positiveInteger(repository?.id) ||
    !validRepositoryName(repository.full_name) ||
    typeof repository.private !== "boolean" ||
    !positiveInteger(installationId) ||
    !positiveInteger(run?.id) ||
    !positiveInteger(run.run_attempt) ||
    typeof run.event !== "string" ||
    !positiveInteger(actor?.id) ||
    typeof actor.login !== "string" ||
    (approval && actor.type !== "User") ||
    !occurredAt ||
    !observedOutcomeAt
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (approval && candidate.action !== "approved") {
    return { ok: false, reason: "no-activity" };
  }
  const direct =
    approval || run.event === "workflow_dispatch" || run.run_attempt > 1;
  if (!direct && candidate.action !== "completed") {
    return { ok: false, reason: "no-activity" };
  }
  if (receivedAt.getTime() - observedOutcomeAt.getTime() > staleDeliveryMs) {
    return { ok: false, reason: "stale" };
  }

  const repositoryId = String(repository.id);
  const runId = String(run.id);
  const key = `github:workflow-run:${repositoryId}:${runId}:${run.run_attempt}`;
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
        repositoryName: repository.full_name,
        private: repository.private,
        actorId: String(actor.id),
        actorLogin: actor.login,
        subjectId: runId,
        title: boundedTitle(run.name),
        occurredAt: occurredAt.toISOString(),
        statusOccurredAt: observedOutcomeAt.toISOString(),
        status: approval
          ? "approved"
          : workflowStatus(candidate.action, run.conclusion),
        evidenceUrl: `https://github.com/${repository.full_name}/actions/runs/${runId}/attempts/${run.run_attempt}`,
        narrativeEligible: true,
      },
    },
  };
}

function deploymentStatus(value: unknown): ActivityStatus | null {
  if (value === "success") return "success";
  if (value === "failure" || value === "error") return "failure";
  if (value === "inactive") return "cancelled";
  if (value === "pending" || value === "queued" || value === "in_progress") {
    return "pending";
  }
  return null;
}

function extractDeploymentDelivery(
  candidate: OperationsPayload,
  deliveryId: string,
  receivedAt: Date,
): OperationsExtraction {
  const repository = candidate.repository;
  const installationId = candidate.installation?.id;
  const deployment = candidate.deployment;
  const outcome = candidate.deployment_status;
  const status = deploymentStatus(outcome?.state);
  const occurredAt = parseDate(deployment?.created_at);
  const outcomeAt = parseDate(outcome?.created_at);
  if (
    candidate.action !== "created" ||
    !positiveInteger(repository?.id) ||
    !validRepositoryName(repository.full_name) ||
    typeof repository.private !== "boolean" ||
    !positiveInteger(installationId) ||
    !positiveInteger(deployment?.id) ||
    typeof deployment.sha !== "string" ||
    !/^[a-fA-F0-9]{7,64}$/.test(deployment.sha) ||
    typeof deployment.ref !== "string" ||
    !deployment.ref.trim() ||
    !positiveInteger(outcome?.id) ||
    !status ||
    !occurredAt ||
    !outcomeAt
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (receivedAt.getTime() - outcomeAt.getTime() > staleDeliveryMs) {
    return { ok: false, reason: "stale" };
  }

  const repositoryId = String(repository.id);
  const run = candidate.workflow_run;
  const runActor = run?.triggering_actor;
  const directWorkflow =
    positiveInteger(run?.id) &&
    positiveInteger(run.run_attempt) &&
    (run.event === "workflow_dispatch" || run.run_attempt > 1) &&
    positiveInteger(runActor?.id) &&
    typeof runActor.login === "string" &&
    runActor.type === "User";
  const sender = candidate.sender;
  if (
    !directWorkflow &&
    (!positiveInteger(sender?.id) || typeof sender.login !== "string")
  ) {
    return { ok: false, reason: "malformed" };
  }
  const actor = directWorkflow ? runActor : sender;
  if (!actor || !positiveInteger(actor.id) || typeof actor.login !== "string") {
    return { ok: false, reason: "malformed" };
  }
  const attributionKeys = directWorkflow
    ? [
        `github:workflow-run:${repositoryId}:${String(run!.id)}:${String(run!.run_attempt)}`,
      ]
    : [
        `github:commit:${repositoryId}:${deployment.sha}`,
        `github:ref:${repositoryId}:${encodeURIComponent(deployment.ref.trim())}`,
      ];
  const deploymentId = String(deployment.id);
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
        repositoryName: repository.full_name,
        private: repository.private,
        actorId: String(actor.id),
        actorLogin: actor.login,
        subjectId: deploymentId,
        title: boundedTitle(deployment.environment),
        occurredAt: occurredAt.toISOString(),
        statusOccurredAt: outcomeAt.toISOString(),
        status,
        evidenceUrl: `https://github.com/${repository.full_name}/deployments`,
        narrativeEligible: true,
      },
    },
  };
}

function extractPackageDelivery(
  candidate: OperationsPayload,
  eventType: "package" | "registry_package",
  deliveryId: string,
  receivedAt: Date,
): OperationsExtraction {
  const repository = candidate.repository;
  const actor = candidate.sender;
  const installationId = candidate.installation?.id;
  const packageInfo =
    eventType === "package" ? candidate.package : candidate.registry_package;
  const version = packageInfo?.package_version;
  const action = candidate.action;
  if (
    !["published", "updated", "deleted", "restored"].includes(String(action))
  ) {
    return { ok: false, reason: "no-activity" };
  }
  const occurredAt = parseDate(
    action === "published" ? version?.created_at : version?.updated_at,
  );
  if (
    !positiveInteger(repository?.id) ||
    !validRepositoryName(repository.full_name) ||
    typeof repository.private !== "boolean" ||
    !positiveInteger(installationId) ||
    !positiveInteger(actor?.id) ||
    typeof actor.login !== "string" ||
    (actor.type !== "User" && actor.type !== "Bot") ||
    !positiveInteger(packageInfo?.id) ||
    typeof packageInfo.name !== "string" ||
    !packageInfo.name.trim() ||
    typeof packageInfo.package_type !== "string" ||
    !positiveInteger(version?.id) ||
    typeof version.version !== "string" ||
    !version.version.trim() ||
    !occurredAt
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (receivedAt.getTime() - occurredAt.getTime() > staleDeliveryMs) {
    return { ok: false, reason: "stale" };
  }
  const kind = `package-${action}` as OperationsKind;
  const repositoryId = String(repository.id);
  const versionId = String(version.id);
  const targetOid =
    typeof version.target_oid === "string" &&
    /^[a-fA-F0-9]{7,64}$/.test(version.target_oid)
      ? version.target_oid
      : null;
  const targetCommitish =
    typeof version.target_commitish === "string" &&
    version.target_commitish.trim()
      ? version.target_commitish.trim()
      : null;
  const direct = actor.type === "User";
  const attributionKeys = direct
    ? [`github:package:${repositoryId}:${versionId}`]
    : [
        ...(targetOid ? [`github:commit:${repositoryId}:${targetOid}`] : []),
        ...(targetCommitish
          ? [
              `github:ref:${repositoryId}:${encodeURIComponent(targetCommitish)}`,
            ]
          : []),
      ];
  if (!direct && attributionKeys.length === 0) {
    return { ok: false, reason: "no-activity" };
  }
  const packageName = boundedTitle(packageInfo.name);
  const versionName = boundedTitle(version.version);
  const title =
    packageName && versionName
      ? boundedTitle(`${packageName} · ${versionName}`)
      : packageName;
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
        repositoryName: repository.full_name,
        private: repository.private,
        actorId: String(actor.id),
        actorLogin: actor.login,
        subjectId: versionId,
        title,
        occurredAt: occurredAt.toISOString(),
        statusOccurredAt: occurredAt.toISOString(),
        status: action === "deleted" ? "cancelled" : "success",
        evidenceUrl: `https://github.com/${repository.full_name}/packages`,
        narrativeEligible: action === "published" || action === "updated",
      },
    },
  };
}

export function parseOperationsDeliveryMessage(
  value: unknown,
): OperationsMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Partial<OperationsMessage>;
  const operation = message.operation;
  const validStatuses: readonly string[] = [
    "pending",
    "approved",
    "success",
    "failure",
    "cancelled",
  ];
  const validKinds: readonly string[] = [
    "workflow-run",
    "deployment",
    "package-published",
    "package-updated",
    "package-deleted",
    "package-restored",
  ];
  if (
    message.version !== 1 ||
    !validDeliveryId(message.deliveryId) ||
    typeof message.installationId !== "string" ||
    !/^\d+$/.test(message.installationId) ||
    !parseDate(message.receivedAt) ||
    !operation ||
    !validKinds.includes(operation.kind) ||
    typeof operation.deduplicationKey !== "string" ||
    operation.deduplicationKey.length === 0 ||
    operation.deduplicationKey.length > 1024 ||
    typeof operation.attributionKey !== "string" ||
    operation.attributionKey.length === 0 ||
    operation.attributionKey.length > 1024 ||
    (operation.attributionKeys !== undefined &&
      (!Array.isArray(operation.attributionKeys) ||
        operation.attributionKeys.length === 0 ||
        operation.attributionKeys.length > 4 ||
        operation.attributionKeys.some(
          (key) =>
            typeof key !== "string" || key.length === 0 || key.length > 1024,
        ))) ||
    (operation.attribution !== "direct" &&
      operation.attribution !== "linked") ||
    typeof operation.repositoryId !== "string" ||
    typeof operation.actorId !== "string" ||
    operation.actorId.length === 0 ||
    typeof operation.actorLogin !== "string" ||
    operation.actorLogin.length === 0 ||
    typeof operation.private !== "boolean" ||
    typeof operation.subjectId !== "string" ||
    operation.subjectId.length === 0 ||
    operation.subjectId.length > 255 ||
    (operation.title !== null &&
      (typeof operation.title !== "string" ||
        operation.title.length > subjectTitleMaxLength)) ||
    !parseDate(operation.occurredAt) ||
    (operation.statusOccurredAt !== undefined &&
      !parseDate(operation.statusOccurredAt)) ||
    !validStatuses.includes(operation.status) ||
    typeof operation.evidenceUrl !== "string" ||
    operation.evidenceUrl.length > 2048 ||
    !validRepositoryName(operation.repositoryName) ||
    !operation.evidenceUrl.startsWith(
      `https://github.com/${operation.repositoryName}/`,
    ) ||
    typeof operation.narrativeEligible !== "boolean"
  ) {
    return null;
  }
  return message as OperationsMessage;
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
