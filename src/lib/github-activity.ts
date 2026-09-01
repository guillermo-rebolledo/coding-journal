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

export type ActivityKind = "push" | "commit" | CollaborationKind;

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
  source: "github-events" | "github-repository-commits" | "github-webhook";
  subjectId: string;
  subjectNumber: number | null;
  subjectTitle: string | null;
  occurredAt: Date;
  observedAt: Date;
  authoredBeforeDay: boolean;
  installationId: string | null;
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
};

export function computeActivityMetrics(
  activities: Array<{ kind: ActivityKind }>,
): ActivityMetrics {
  return Object.fromEntries(
    Object.entries(metricKinds).map(([metric, kinds]) => [
      metric,
      activities.filter((activity) => kinds.includes(activity.kind)).length,
    ]),
  ) as ActivityMetrics;
}

export function validRepositoryName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
  );
}

export function validSha(value: unknown): value is string {
  return typeof value === "string" && /^[a-fA-F0-9]{7,64}$/.test(value);
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
