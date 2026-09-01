import {
  projectKinds,
  type ActivityRecord,
  type ProjectKind,
} from "@/lib/github-activity";
import { subjectTitleMaxLength } from "@/lib/github-collaboration";
import { getLocalDayWindow, parseDate } from "@/lib/time-zone";

export const projectsWebhookEvents = [
  "projects_v2",
  "projects_v2_item",
] as const;

export type ProjectsWebhookEvent = (typeof projectsWebhookEvents)[number];

export type ProjectsDeliveryMessage = {
  version: 1;
  deliveryId: string;
  installationId: string;
  receivedAt: string;
  project: {
    kind: ProjectKind;
    deduplicationKey: string;
    organizationId: string;
    organizationLogin: string;
    senderId: string;
    senderLogin: string;
    projectId: string;
    subjectId: string;
    subjectNumber: number | null;
    title: string | null;
    evidenceUrl: string;
    occurredAt: string;
    completeness: "best-effort";
  };
};

export type ProjectsExtraction =
  | { ok: true; message: ProjectsDeliveryMessage }
  | { ok: false; reason: "malformed" | "no-activity" };

const projectActions: Record<string, ProjectKind> = {
  created: "project-created",
  edited: "project-updated",
  closed: "project-closed",
  reopened: "project-reopened",
  deleted: "project-deleted",
};

const projectItemActions: Record<string, ProjectKind> = {
  added_to_project: "project-item-added",
  archived: "project-item-archived",
  converted: "project-item-converted",
  edited: "project-item-edited",
  redacted: "project-item-redacted",
  reordered: "project-item-reordered",
  restored: "project-item-restored",
};

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validDeliveryId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{1,100}$/.test(value);
}

function boundedTitle(value: unknown) {
  if (!nonEmptyString(value)) return null;
  const title = value.trim();
  return title.length > subjectTitleMaxLength
    ? `${title.slice(0, subjectTitleMaxLength - 1)}…`
    : title;
}

function githubUrl(value: unknown) {
  if (!nonEmptyString(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function previewObject(payload: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const candidate = payload[key];
    if (typeof candidate === "object" && candidate !== null) {
      return candidate as Record<string, unknown>;
    }
  }
  return null;
}

function firstString(object: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (nonEmptyString(object[key])) return object[key].trim();
  }
  return null;
}

export function isProjectsWebhookEvent(
  value: string,
): value is ProjectsWebhookEvent {
  return (projectsWebhookEvents as readonly string[]).includes(value);
}

export function extractProjectsDelivery({
  eventType,
  payload,
  deliveryId,
  receivedAt,
}: {
  eventType: ProjectsWebhookEvent;
  payload: unknown;
  deliveryId: string;
  receivedAt: Date;
}): ProjectsExtraction {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, reason: "malformed" };
  }
  const root = payload as Record<string, unknown>;
  const organization = previewObject(root, "organization");
  // Preview Project webhooks are organization-only. A payload without this
  // boundary is either personal Projects activity or an incompatible schema.
  if (!organization) return { ok: false, reason: "no-activity" };
  const sender = previewObject(root, "sender");
  const installation = previewObject(root, "installation");
  const action = root.action;
  if (
    !positiveInteger(organization.id) ||
    !nonEmptyString(organization.login) ||
    !positiveInteger(sender?.id) ||
    !nonEmptyString(sender.login) ||
    !positiveInteger(installation?.id) ||
    typeof action !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }

  const isItem = eventType === "projects_v2_item";
  const kind = (isItem ? projectItemActions : projectActions)[action];
  if (!kind) return { ok: false, reason: "no-activity" };

  const subject = isItem
    ? previewObject(root, "projects_v2_item", "project_v2_item")
    : previewObject(root, "projects_v2", "project_v2");
  if (!subject || !positiveInteger(subject.id)) {
    return { ok: false, reason: "malformed" };
  }
  const subjectId =
    firstString(subject, "node_id", "nodeId") ?? String(subject.id);
  const projectId = isItem
    ? (firstString(subject, "project_node_id", "projectNodeId") ??
      String(organization.id))
    : subjectId;
  const number = positiveInteger(subject.number) ? subject.number : null;
  const organizationLogin = organization.login.trim();
  const evidenceUrl =
    githubUrl(subject.html_url ?? subject.htmlUrl) ??
    (number
      ? `https://github.com/orgs/${encodeURIComponent(organizationLogin)}/projects/${number}`
      : `https://github.com/orgs/${encodeURIComponent(organizationLogin)}/projects`);
  const occurredAt = receivedAt.toISOString();

  return {
    ok: true,
    message: {
      version: 1,
      deliveryId,
      installationId: String(installation.id),
      receivedAt: occurredAt,
      project: {
        kind,
        deduplicationKey: `github:${kind}:${projectId}:${subjectId}:${deliveryId}`,
        organizationId: String(organization.id),
        organizationLogin,
        senderId: String(sender.id),
        senderLogin: sender.login.trim(),
        projectId,
        subjectId,
        subjectNumber: number,
        title: isItem ? null : boundedTitle(subject.title),
        evidenceUrl,
        occurredAt,
        completeness: "best-effort",
      },
    },
  };
}

const projectKindSet = new Set<string>(projectKinds);

export function parseProjectsDeliveryMessage(
  value: unknown,
): ProjectsDeliveryMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Partial<ProjectsDeliveryMessage>;
  const project = message.project;
  if (
    message.version !== 1 ||
    !validDeliveryId(message.deliveryId) ||
    !nonEmptyString(message.installationId) ||
    !parseDate(message.receivedAt) ||
    typeof project !== "object" ||
    project === null ||
    !projectKindSet.has(project.kind) ||
    !nonEmptyString(project.deduplicationKey) ||
    !nonEmptyString(project.organizationId) ||
    !nonEmptyString(project.organizationLogin) ||
    !nonEmptyString(project.senderId) ||
    !nonEmptyString(project.senderLogin) ||
    !nonEmptyString(project.projectId) ||
    !nonEmptyString(project.subjectId) ||
    (project.subjectNumber !== null &&
      !positiveInteger(project.subjectNumber)) ||
    (project.title !== null &&
      (!nonEmptyString(project.title) ||
        project.title.length > subjectTitleMaxLength)) ||
    !githubUrl(project.evidenceUrl) ||
    !parseDate(project.occurredAt) ||
    project.completeness !== "best-effort"
  ) {
    return null;
  }
  return message as ProjectsDeliveryMessage;
}

export function normalizeProjectsMessage(
  message: ProjectsDeliveryMessage,
  user: { githubAccountId: string; timeZone: string },
): ActivityRecord[] {
  const { project } = message;
  if (project.senderId !== user.githubAccountId) return [];
  const occurredAt = new Date(project.occurredAt);
  return [
    {
      deduplicationKey: project.deduplicationKey,
      localDate: getLocalDayWindow(occurredAt, user.timeZone).localDate,
      kind: project.kind,
      actorId: project.senderId,
      actorLogin: project.senderLogin,
      repositoryId: project.organizationId,
      repositoryName: `${project.organizationLogin}/Projects`,
      evidenceUrl: project.evidenceUrl,
      visibility: "private",
      source: "github-projects-preview",
      subjectId: project.subjectId,
      subjectNumber: project.subjectNumber,
      subjectTitle: project.title,
      occurredAt,
      observedAt: new Date(message.receivedAt),
      authoredBeforeDay: false,
      installationId: message.installationId,
    },
  ];
}
