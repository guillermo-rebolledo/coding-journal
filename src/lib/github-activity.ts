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
  return `github:push:${repositoryId}:${before}:${head}`;
}

export function commitDeduplicationKey(repositoryId: string, sha: string) {
  return `github:commit:${repositoryId}:${sha}`;
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
