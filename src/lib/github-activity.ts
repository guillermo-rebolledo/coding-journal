import {
  asString,
  readArray,
  readNonEmptyString,
  readNumber,
  type JsonObject,
} from "@/lib/json-payload";
import type { LocalDayWindow } from "@/lib/time-zone";

// Shared GitHub activity primitives. Both ingestion paths (Events API
// reconciliation and durable webhooks) build the same canonical records from
// these, so overlapping observations collapse on identical deduplication keys.

export const collaborationKinds = [
  "branch-created",
  "branch-deleted",
  "tag-created",
  "tag-deleted",
  "release-published",
  "release-updated",
  "discussion-created",
  "discussion-comment",
  "discussion-answered",
  "issue-opened",
  "issue-closed",
  "issue-reopened",
  "issue-comment",
  "pull-request-opened",
  "pull-request-updated",
  "pull-request-merged",
  "pull-request-closed",
  "pull-request-reopened",
  "pull-request-comment",
  "pull-request-review",
  "pull-request-review-comment",
] as const;

export type CollaborationKind = (typeof collaborationKinds)[number];

export const operationsKinds = [
  "workflow-run",
  "deployment",
  "package-published",
  "package-updated",
  "package-deleted",
  "package-restored",
] as const;

export type OperationsKind = (typeof operationsKinds)[number];

export const projectKinds = [
  "project-created",
  "project-updated",
  "project-closed",
  "project-reopened",
  "project-deleted",
  "project-item-added",
  "project-item-archived",
  "project-item-converted",
  "project-item-edited",
  "project-item-deleted",
  "project-item-reordered",
  "project-item-restored",
] as const;

export type ProjectKind = (typeof projectKinds)[number];

export const secondaryKinds = [
  "gist-created",
  "gist-updated",
  "gist-comment",
  "gist-forked",
  "gist-starred",
  "repository-starred",
  "repository-watched",
  "repository-forked",
  "user-followed",
  "sponsorship-created",
] as const;

export type SecondaryKind = (typeof secondaryKinds)[number];

export type ActivityKind =
  | "push"
  | "commit"
  | CollaborationKind
  | OperationsKind
  | ProjectKind
  | SecondaryKind;

export type ActivityStatus =
  | "pending"
  | "approved"
  | "success"
  | "failure"
  | "cancelled";

export type ActivityRecord = {
  deduplicationKey: string;
  localDate: string;
  kind: ActivityKind;
  actorId: string;
  actorLogin: string;
  repositoryId: string;
  repositoryName: string;
  evidenceUrl: string;
  visibility: "public" | "private";
  source:
    | "github-events"
    | "github-repository-commits"
    | "github-webhook"
    | "github-projects-preview"
    | "github-gists";
  subjectId: string;
  subjectNumber: number | null;
  subjectTitle: string | null;
  occurredAt: Date;
  observedAt: Date;
  authoredBeforeDay: boolean;
  installationId: string | null;
  status?: ActivityStatus | null;
  statusOccurredAt?: Date | null;
  narrativeEligible?: boolean;
  attributionKey?: string | null;
  attributionKeys?: string[];
  attributed?: boolean;
};

export type ActivityIdentity = { deduplicationKey: string };

export const activityIdentity = {
  push(repositoryId: string, before: string, head: string): ActivityIdentity {
    return {
      deduplicationKey: `github:push:${repositoryId}:${before}:${head}`,
    };
  },
  commit(repositoryId: string, sha: string): ActivityIdentity {
    return { deduplicationKey: `github:commit:${repositoryId}:${sha}` };
  },
  repository(
    kind: ActivityKind,
    repositoryId: string,
    discriminator: string,
  ): ActivityIdentity {
    return {
      deduplicationKey: `github:${kind}:${repositoryId}:${discriminator}`,
    };
  },
  global(kind: ActivityKind, discriminator: string): ActivityIdentity {
    return { deduplicationKey: `github:${kind}:${discriminator}` };
  },
  project(
    kind: ProjectKind,
    projectId: string,
    subjectId: string,
    deliveryId: string,
  ): ActivityIdentity {
    return {
      deduplicationKey: `github:${kind}:${projectId}:${subjectId}:${deliveryId}`,
    };
  },
};

export type ActivityEvidence =
  | { shape: "push"; before: string; head: string }
  | { shape: "commit"; sha: string }
  | { shape: "repository" }
  | { shape: "repository-path"; path: string }
  | { shape: "absolute"; url: string };

/** Narrows decoded evidence to an HTTPS URL on a GitHub-owned web host. */
export function validEvidenceUrl(value: string | null): value is string {
  if (value === null || value.trim().length === 0) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "github.com" || url.hostname === "gist.github.com")
    );
  } catch {
    return false;
  }
}

function evidenceUrlFor(
  repositoryName: string,
  evidence: ActivityEvidence,
): string {
  switch (evidence.shape) {
    case "push":
      return pushEvidenceUrl(repositoryName, evidence.before, evidence.head);
    case "commit":
      return `https://github.com/${repositoryName}/commit/${evidence.sha}`;
    case "repository":
      return `https://github.com/${repositoryName}`;
    case "repository-path":
      return `https://github.com/${repositoryName}/${evidence.path.replace(/^\//, "")}`;
    case "absolute":
      if (!validEvidenceUrl(evidence.url)) {
        throw new Error("Invalid GitHub evidence URL");
      }
      return evidence.url;
  }
}

/**
 * The one constructor for persisted journal activity. Producers describe what
 * happened; this boundary derives storage identity, evidence, day placement,
 * visibility and authored-before-day consistently.
 */
export function createActivityRecord({
  kind,
  identity,
  evidence,
  actor,
  repository,
  subject,
  occurredAt,
  observedAt,
  source,
  window,
  installationId,
  ...optional
}: {
  kind: ActivityKind;
  identity: ActivityIdentity;
  evidence: ActivityEvidence;
  actor: { id: string; login: string };
  repository: { id: string; name: string; private: boolean };
  subject: { id: string; number: number | null; title: string | null };
  occurredAt: Date;
  observedAt: Date;
  source: ActivityRecord["source"];
  window: LocalDayWindow;
  installationId: string | null;
} & Pick<
  ActivityRecord,
  | "status"
  | "statusOccurredAt"
  | "narrativeEligible"
  | "attributionKey"
  | "attributionKeys"
  | "attributed"
>): ActivityRecord {
  if (!validRepositoryName(repository.name)) {
    throw new Error("Invalid GitHub repository name");
  }
  return {
    deduplicationKey: identity.deduplicationKey,
    localDate: window.localDate,
    kind,
    actorId: actor.id,
    actorLogin: actor.login,
    repositoryId: repository.id,
    repositoryName: repository.name,
    evidenceUrl: evidenceUrlFor(repository.name, evidence),
    visibility: repository.private ? "private" : "public",
    source,
    subjectId: subject.id,
    subjectNumber: subject.number,
    subjectTitle: subject.title,
    occurredAt,
    observedAt,
    authoredBeforeDay: occurredAt < window.startsAt,
    installationId,
    ...optional,
  };
}

/** Maps database or JSON activity rows back to the canonical record once. */
export function activityRecordFromRow(
  row: Omit<ActivityRecord, "attributionKeys"> & {
    attributionKeys?: string[] | null;
  },
): ActivityRecord {
  return {
    deduplicationKey: row.deduplicationKey,
    localDate: row.localDate,
    kind: row.kind,
    actorId: row.actorId,
    actorLogin: row.actorLogin,
    repositoryId: row.repositoryId,
    repositoryName: row.repositoryName,
    evidenceUrl: row.evidenceUrl,
    visibility: row.visibility,
    source: row.source,
    subjectId: row.subjectId,
    subjectNumber: row.subjectNumber,
    subjectTitle: row.subjectTitle,
    occurredAt: new Date(row.occurredAt),
    observedAt: new Date(row.observedAt),
    authoredBeforeDay: row.authoredBeforeDay,
    installationId: row.installationId,
    status: row.status,
    statusOccurredAt: row.statusOccurredAt
      ? new Date(row.statusOccurredAt)
      : row.statusOccurredAt,
    narrativeEligible: row.narrativeEligible,
    attributionKey: row.attributionKey,
    attributionKeys: row.attributionKeys ?? undefined,
    attributed: row.attributed,
  };
}

export type ActivityMetrics = {
  pushes: number;
  commits: number;
  refs: number;
  releases: number;
  discussions: number;
  issues: number;
  pullRequests: number;
  reviews: number;
  merges: number;
  comments: number;
  workflows: number;
  deployments: number;
  packages: number;
  projects: number;
  gists: number;
  social: number;
};

const metricKinds: Record<keyof ActivityMetrics, ActivityKind[]> = {
  pushes: ["push"],
  commits: ["commit"],
  refs: ["branch-created", "branch-deleted", "tag-created", "tag-deleted"],
  releases: ["release-published", "release-updated"],
  discussions: [
    "discussion-created",
    "discussion-comment",
    "discussion-answered",
  ],
  issues: ["issue-opened", "issue-closed", "issue-reopened"],
  pullRequests: [
    "pull-request-opened",
    "pull-request-updated",
    "pull-request-closed",
    "pull-request-reopened",
  ],
  reviews: ["pull-request-review"],
  merges: ["pull-request-merged"],
  comments: [
    "issue-comment",
    "pull-request-comment",
    "pull-request-review-comment",
  ],
  workflows: ["workflow-run"],
  deployments: ["deployment"],
  packages: ["package-published", "package-updated"],
  projects: [...projectKinds],
  gists: [
    "gist-created",
    "gist-updated",
    "gist-comment",
    "gist-forked",
    "gist-starred",
  ],
  social: [
    "repository-starred",
    "repository-watched",
    "repository-forked",
    "user-followed",
    "sponsorship-created",
  ],
};

export function computeActivityMetrics(
  activities: Array<{ kind: ActivityKind }>,
): ActivityMetrics {
  // SAFETY: the entries come straight from `metricKinds`, whose keys are the
  // metric names `ActivityMetrics` declares, so the rebuilt record is total.
  return Object.fromEntries(
    Object.entries(metricKinds).map(([metric, kinds]) => [
      metric,
      activities.filter((activity) => kinds.includes(activity.kind)).length,
    ]),
  ) as ActivityMetrics;
}

/**
 * GitHub numbers its entities, but a few payloads quote the same id as a
 * string. Both denote the same entity, so the identifier is read either way
 * and always returned as text. An empty or blank id is not an identifier.
 */
export function readIdentifier(
  source: JsonObject | null,
  key: string,
): string | null {
  const text = readNonEmptyString(source, key);
  if (text !== null) return text;
  const numeric = readNumber(source, key);
  return numeric === null ? null : String(numeric);
}

/** The most attribution keys one activity may carry. */
const maximumAttributionKeys = 4;

/**
 * Reads the optional `attributionKeys` list shared by the queue messages.
 * Returns `undefined` when the member is absent and the sentinel `"invalid"`
 * when it is present but is not a list of between one and four bounded keys.
 *
 * `isBounded` is a parameter because the two producers disagree about the
 * empty key: operations rejects it, collaboration has always allowed it.
 */
export function readAttributionKeys(
  source: JsonObject,
  isBounded: (key: string | null) => key is string,
): string[] | undefined | "invalid" {
  if (source["attributionKeys"] === undefined) return undefined;
  const entries = readArray(source, "attributionKeys");
  if (
    entries === null ||
    entries.length === 0 ||
    entries.length > maximumAttributionKeys
  ) {
    return "invalid";
  }
  const keys = entries.map((entry) => asString(entry));
  return keys.every((key) => isBounded(key)) ? keys : "invalid";
}

/** Narrows a decoded string to GitHub's `owner/name` repository form. */
export function validRepositoryName(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

/** Narrows a decoded string to an abbreviated or full commit SHA. */
export function validSha(value: string | null): value is string {
  return value !== null && /^[a-fA-F0-9]{7,64}$/.test(value);
}

export function pushDeduplicationKey(
  repositoryId: string,
  before: string,
  head: string,
) {
  return activityIdentity.push(repositoryId, before, head).deduplicationKey;
}

export function commitDeduplicationKey(repositoryId: string, sha: string) {
  return activityIdentity.commit(repositoryId, sha).deduplicationKey;
}

export function pushEvidenceUrl(
  repositoryName: string,
  before: string,
  head: string,
) {
  return before && !/^0+$/.test(before)
    ? `https://github.com/${repositoryName}/compare/${before}...${head}`
    : `https://github.com/${repositoryName}/commit/${head}`;
}
