import {
  projectKinds,
  type ActivityRecord,
  type ProjectKind,
} from "@/lib/github-activity";
import { subjectTitleMaxLength } from "@/lib/github-collaboration";
import {
  readNonEmptyString,
  readNumber,
  readObject,
  readPositiveInteger,
  readString,
  type JsonObject,
} from "@/lib/json-payload";
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

/** The activity each `projects_v2` action records. */
const projectActions = {
  created: "project-created",
  edited: "project-updated",
  closed: "project-closed",
  reopened: "project-reopened",
  deleted: "project-deleted",
} as const satisfies Readonly<Record<string, ProjectKind>>;

/** The activity each `projects_v2_item` action records. */
const projectItemActions = {
  archived: "project-item-archived",
  converted: "project-item-converted",
  created: "project-item-added",
  deleted: "project-item-deleted",
  edited: "project-item-edited",
  reordered: "project-item-reordered",
  restored: "project-item-restored",
} as const satisfies Readonly<Record<string, ProjectKind>>;

function projectKindFor(
  actions: Readonly<Record<string, ProjectKind>>,
  action: string,
): ProjectKind | null {
  return Object.hasOwn(actions, action) ? (actions[action] ?? null) : null;
}

function validDeliveryId(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9-]{1,100}$/.test(value);
}

function boundedTitle(value: string | null) {
  if (value === null) return null;
  const title = value.trim();
  if (!title) return null;
  return title.length > subjectTitleMaxLength
    ? `${title.slice(0, subjectTitleMaxLength - 1)}…`
    : title;
}

/** Narrows a decoded string to an absolute github.com URL. */
function githubUrl(value: string | null) {
  if (value === null || value.trim().length === 0) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Preview Project payloads name the same member in snake and camel case
 * depending on the delivery, so both spellings are tried in order.
 */
function readEitherObject(
  source: JsonObject | null,
  ...keys: readonly string[]
): JsonObject | null {
  for (const key of keys) {
    const value = readObject(source, key);
    if (value !== null) return value;
  }
  return null;
}

function readEitherString(
  source: JsonObject | null,
  ...keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = readNonEmptyString(source, key);
    if (value !== null) return value;
  }
  return null;
}

export function isProjectsWebhookEvent(
  value: string,
): value is ProjectsWebhookEvent {
  return projectsWebhookEvents.some((event) => event === value);
}

export function extractProjectsDelivery({
  eventType,
  payload,
  deliveryId,
  receivedAt,
}: {
  eventType: ProjectsWebhookEvent;
  payload: JsonObject | null;
  deliveryId: string;
  receivedAt: Date;
}): ProjectsExtraction {
  if (payload === null) return { ok: false, reason: "malformed" };

  const organization = readObject(payload, "organization");
  // Preview Project webhooks are organization-only. A payload without this
  // boundary is either personal Projects activity or an incompatible schema.
  if (organization === null) return { ok: false, reason: "no-activity" };

  const organizationId = readPositiveInteger(organization, "id");
  const organizationLogin = readNonEmptyString(organization, "login");
  const sender = readObject(payload, "sender");
  const senderId = readPositiveInteger(sender, "id");
  const senderLogin = readNonEmptyString(sender, "login");
  const installationId = readPositiveInteger(
    readObject(payload, "installation"),
    "id",
  );
  const action = readString(payload, "action");
  if (
    organizationId === null ||
    organizationLogin === null ||
    senderId === null ||
    senderLogin === null ||
    installationId === null ||
    action === null
  ) {
    return { ok: false, reason: "malformed" };
  }

  const isItem = eventType === "projects_v2_item";
  const kind = projectKindFor(
    isItem ? projectItemActions : projectActions,
    action,
  );
  if (kind === null) return { ok: false, reason: "no-activity" };

  const subject = isItem
    ? readEitherObject(payload, "projects_v2_item", "project_v2_item")
    : readEitherObject(payload, "projects_v2", "project_v2");
  const subjectNumericId = readPositiveInteger(subject, "id");
  if (subject === null || subjectNumericId === null) {
    return { ok: false, reason: "malformed" };
  }

  const subjectId =
    readEitherString(subject, "node_id", "nodeId") ?? String(subjectNumericId);
  const projectId = isItem
    ? (readEitherString(subject, "project_node_id", "projectNodeId") ??
      String(organizationId))
    : subjectId;
  const number = readPositiveInteger(subject, "number");
  const evidenceUrl =
    githubUrl(readEitherString(subject, "html_url", "htmlUrl")) ??
    (number
      ? `https://github.com/orgs/${encodeURIComponent(organizationLogin)}/projects/${number}`
      : `https://github.com/orgs/${encodeURIComponent(organizationLogin)}/projects`);
  const occurredAt = receivedAt.toISOString();

  return {
    ok: true,
    message: {
      version: 1,
      deliveryId,
      installationId: String(installationId),
      receivedAt: occurredAt,
      project: {
        kind,
        deduplicationKey: `github:${kind}:${projectId}:${subjectId}:${deliveryId}`,
        organizationId: String(organizationId),
        organizationLogin,
        senderId: String(senderId),
        senderLogin,
        projectId,
        subjectId,
        subjectNumber: number,
        title: isItem ? null : boundedTitle(readString(subject, "title")),
        evidenceUrl,
        occurredAt,
        completeness: "best-effort",
      },
    },
  };
}

const projectKindSet = new Set<string>(projectKinds);

function isProjectKind(value: string | null): value is ProjectKind {
  return value !== null && projectKindSet.has(value);
}

/**
 * Decodes a queue message this service published earlier. The message crossed
 * a queue, so every field is read and checked before the message is rebuilt.
 */
export function parseProjectsDeliveryMessage(
  value: JsonObject | null,
): ProjectsDeliveryMessage | null {
  if (value === null || readNumber(value, "version") !== 1) return null;

  const deliveryId = readString(value, "deliveryId");
  const installationId = readNonEmptyString(value, "installationId");
  const receivedAt = readString(value, "receivedAt");
  const project = readObject(value, "project");
  const kind = readString(project, "kind");
  const deduplicationKey = readNonEmptyString(project, "deduplicationKey");
  const organizationId = readNonEmptyString(project, "organizationId");
  const organizationLogin = readNonEmptyString(project, "organizationLogin");
  const senderId = readNonEmptyString(project, "senderId");
  const senderLogin = readNonEmptyString(project, "senderLogin");
  const projectId = readNonEmptyString(project, "projectId");
  const subjectId = readNonEmptyString(project, "subjectId");
  const subjectNumber = readNumber(project, "subjectNumber");
  const evidenceUrl = readString(project, "evidenceUrl");
  const occurredAt = readString(project, "occurredAt");

  if (project === null) return null;

  // `subjectNumber` and `title` are nullable rather than optional: an absent
  // member is malformed, an explicit null is a project that has neither.
  const numberMember = project["subjectNumber"];
  if (
    numberMember !== null &&
    (subjectNumber === null ||
      !Number.isSafeInteger(subjectNumber) ||
      subjectNumber <= 0)
  ) {
    return null;
  }
  const titleMember = project["title"];
  const title = readNonEmptyString(project, "title");
  if (
    titleMember !== null &&
    (title === null || title.length > subjectTitleMaxLength)
  ) {
    return null;
  }

  if (
    !validDeliveryId(deliveryId) ||
    installationId === null ||
    receivedAt === null ||
    !parseDate(receivedAt) ||
    !isProjectKind(kind) ||
    deduplicationKey === null ||
    organizationId === null ||
    organizationLogin === null ||
    senderId === null ||
    senderLogin === null ||
    projectId === null ||
    subjectId === null ||
    evidenceUrl === null ||
    githubUrl(evidenceUrl) === null ||
    occurredAt === null ||
    !parseDate(occurredAt) ||
    readString(project, "completeness") !== "best-effort"
  ) {
    return null;
  }

  return {
    version: 1,
    deliveryId,
    installationId,
    receivedAt,
    project: {
      kind,
      deduplicationKey,
      organizationId,
      organizationLogin,
      senderId,
      senderLogin,
      projectId,
      subjectId,
      subjectNumber,
      title,
      evidenceUrl,
      occurredAt,
      completeness: "best-effort",
    },
  };
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
