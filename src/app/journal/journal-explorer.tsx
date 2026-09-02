"use client";

import { useMemo, useState } from "react";

import { EvidenceLink } from "@/components/journal/evidence-link";
import { StatusChip } from "@/components/journal/status-chip";
import {
  projectKinds,
  secondaryKinds,
  type ActivityKind,
  type ActivityRecord,
} from "@/lib/github-activity";
import { cn } from "@/lib/utils";

type ActivityCategory =
  | "all"
  | "pushes"
  | "commits"
  | "refs"
  | "releases"
  | "discussions"
  | "issues"
  | "pullRequests"
  | "reviews"
  | "merges"
  | "comments"
  | "workflows"
  | "deployments"
  | "packages"
  | "projects"
  | "gists"
  | "social";

const categoryLabels: Record<ActivityCategory, string> = {
  all: "All activity",
  pushes: "Pushes",
  commits: "Commits",
  refs: "Refs",
  releases: "Releases",
  discussions: "Discussions",
  issues: "Issues",
  pullRequests: "Pull requests",
  reviews: "Reviews",
  merges: "Merges",
  comments: "Comments",
  workflows: "Workflow runs",
  deployments: "Deployments",
  packages: "Packages",
  projects: "Projects",
  gists: "Gists",
  social: "Social activity",
};

const categoryKinds: Record<
  Exclude<ActivityCategory, "all">,
  ActivityKind[]
> = {
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
  packages: [
    "package-published",
    "package-updated",
    "package-deleted",
    "package-restored",
  ],
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

const activityLabels: Record<ActivityKind, [string, string]> = {
  push: ["Push", "push"],
  commit: ["Commit", "commit"],
  "branch-created": ["Created branch", "branches"],
  "branch-deleted": ["Deleted branch", "branches"],
  "tag-created": ["Created tag", "tags"],
  "tag-deleted": ["Deleted tag", "tags"],
  "release-published": ["Published release", "release"],
  "release-updated": ["Updated release", "release"],
  "discussion-created": ["Started discussion", "discussion"],
  "discussion-comment": ["Commented on discussion", "comment"],
  "discussion-answered": ["Marked discussion answer", "answer"],
  "issue-opened": ["Opened issue", "issue"],
  "issue-closed": ["Closed issue", "issue"],
  "issue-reopened": ["Reopened issue", "issue"],
  "issue-comment": ["Commented on issue", "comment"],
  "pull-request-opened": ["Opened pull request", "pull request"],
  "pull-request-updated": ["Updated pull request", "pull request"],
  "pull-request-merged": ["Merged pull request", "pull request"],
  "pull-request-closed": ["Closed pull request", "pull request"],
  "pull-request-reopened": ["Reopened pull request", "pull request"],
  "pull-request-comment": ["Commented on pull request", "comment"],
  "pull-request-review": ["Reviewed pull request", "review"],
  "pull-request-review-comment": ["Commented on a diff", "comment"],
  "workflow-run": ["Ran workflow", "workflow run"],
  deployment: ["Deployment", "deployment"],
  "package-published": ["Published package", "package"],
  "package-updated": ["Updated package", "package"],
  "package-deleted": ["Deleted package", "package"],
  "package-restored": ["Restored package", "package"],
  "project-created": ["Created project", "project"],
  "project-updated": ["Updated project", "project"],
  "project-closed": ["Closed project", "project"],
  "project-reopened": ["Reopened project", "project"],
  "project-deleted": ["Deleted project", "organization projects"],
  "project-item-added": ["Added project item", "organization projects"],
  "project-item-archived": ["Archived project item", "organization projects"],
  "project-item-converted": ["Converted project item", "organization projects"],
  "project-item-edited": ["Edited project item", "organization projects"],
  "project-item-deleted": ["Deleted project item", "organization projects"],
  "project-item-reordered": ["Reordered project item", "organization projects"],
  "project-item-restored": ["Restored project item", "organization projects"],
  "gist-created": ["Created Gist", "Gist"],
  "gist-updated": ["Updated Gist", "Gist"],
  "gist-comment": ["Commented on Gist", "Gist"],
  "gist-forked": ["Forked Gist", "Gist"],
  "gist-starred": ["Observed starred Gist", "Gist"],
  "repository-starred": ["Starred repository", "repository"],
  "repository-watched": ["Watched repository", "repository"],
  "repository-forked": ["Forked repository", "fork"],
  "user-followed": ["Followed user", "profile"],
  "sponsorship-created": ["Started sponsorship", "sponsorship"],
};

const statusLabels = {
  pending: "In progress",
  approved: "Approved",
  success: "Succeeded",
  failure: "Failed",
  cancelled: "Cancelled",
} as const;

// SAFETY: `categoryLabels` is keyed by `ActivityCategory`, so its entries are
// exactly that union paired with a label; `Object.entries` widens the key.
const categoryEntries = Object.entries(categoryLabels) as Array<
  [ActivityCategory, string]
>;

function coverageLabel(activity: ActivityRecord) {
  if (activity.kind === "gist-starred") return "First observed · best-effort";
  if (activity.source === "github-projects-preview")
    return "Preview · best-effort";
  if (activity.source === "github-gists") return "Reconciliation · best-effort";
  if (secondaryKinds.some((kind) => kind === activity.kind))
    return "Delayed source · best-effort";
  return null;
}

/**
 * Activity row — pattern 2 of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`, frames 1g and 1n).
 *
 * Time · subject · source · evidence. No icon and no container per row: rows
 * live on one shared surface separated by hairline rules, so a thirty-event
 * day reads as a list instead of four screens of floating tiles. Long
 * repository and subject names wrap rather than ellipsize.
 */
function ActivityItem({
  activity,
  timeZone,
}: {
  activity: ActivityRecord;
  timeZone: string;
}) {
  const [label, evidenceNoun] = activityLabels[activity.kind];
  const bestEffortLabel = coverageLabel(activity);

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
      <p className="pt-0.5 text-m3-label-lg text-m3-on-surface-variant tabular-nums">
        <time dateTime={activity.occurredAt.toISOString()}>
          {new Intl.DateTimeFormat("en-US", {
            timeZone,
            hour: "numeric",
            minute: "2-digit",
            month: activity.authoredBeforeDay ? "short" : undefined,
            day: activity.authoredBeforeDay ? "numeric" : undefined,
          }).format(activity.occurredAt)}
        </time>
      </p>
      <div className="min-w-0">
        <p className="text-m3-body-md wrap-anywhere">
          <span className="text-m3-title-sm text-m3-on-surface">
            {label}
            {activity.subjectNumber !== null
              ? ` #${activity.subjectNumber}`
              : ""}
          </span>
          {activity.subjectTitle ? (
            <>
              <span className="text-m3-on-surface-variant">{" — "}</span>
              <span className="text-m3-on-surface-variant">
                {activity.subjectTitle}
              </span>
            </>
          ) : null}
        </p>
        <p className="mt-0.5 text-m3-body-sm wrap-anywhere text-m3-on-surface-variant">
          <span>{activity.repositoryName}</span>
          <span>{` · @${activity.actorLogin}`}</span>
        </p>
        {activity.visibility === "private" ||
        activity.authoredBeforeDay ||
        activity.status ||
        activity.narrativeEligible === false ||
        bestEffortLabel ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {activity.visibility === "private" ? (
              <StatusChip>Private repository</StatusChip>
            ) : null}
            {activity.authoredBeforeDay ? (
              <StatusChip tone="warning">Authored before today</StatusChip>
            ) : null}
            {activity.status ? (
              <StatusChip>{statusLabels[activity.status]}</StatusChip>
            ) : null}
            {activity.narrativeEligible === false ? (
              <StatusChip tone="warning">Excluded from narrative</StatusChip>
            ) : null}
            {bestEffortLabel ? (
              <StatusChip>{bestEffortLabel}</StatusChip>
            ) : null}
          </div>
        ) : null}
        {activity.evidenceUrl ? (
          <EvidenceLink href={activity.evidenceUrl} noun={evidenceNoun} />
        ) : (
          <p className="mt-1.5 text-m3-body-sm text-m3-on-surface-variant">
            No evidence link
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * Activity explorer — frames 1g/1h and pattern 8 of the look-and-feel
 * reference. Switching between the chronological and repository views
 * preserves the filters, and the result count lives in a polite live region.
 */
export function JournalExplorer({
  activities,
  timeZone,
  title = "Activity",
  headingId = "journal-timeline-heading",
}: {
  activities: ActivityRecord[];
  timeZone: string;
  title?: string;
  headingId?: string;
}) {
  const [repository, setRepository] = useState("all");
  const [category, setCategory] = useState<ActivityCategory>("all");
  const [view, setView] = useState<"chronological" | "repository">(
    "chronological",
  );
  const repositories = useMemo(
    () =>
      [
        ...new Set(activities.map((activity) => activity.repositoryName)),
      ].sort(),
    [activities],
  );
  const filtered = useMemo(
    () =>
      activities
        .filter(
          (activity) =>
            repository === "all" || activity.repositoryName === repository,
        )
        .filter(
          (activity) =>
            category === "all" ||
            categoryKinds[category].includes(activity.kind),
        )
        .sort(
          (left, right) =>
            right.occurredAt.getTime() - left.occurredAt.getTime(),
        ),
    [activities, category, repository],
  );
  const groups = useMemo(
    () =>
      repositories
        .map((name) => ({
          name,
          activities: filtered.filter(
            (activity) => activity.repositoryName === name,
          ),
        }))
        .filter((group) => group.activities.length > 0),
    [filtered, repositories],
  );
  const filtersApplied = repository !== "all" || category !== "all";

  return (
    <section aria-labelledby={headingId} className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id={headingId} className="text-m3-title-lg text-m3-on-surface">
          {title}
        </h2>
        <p
          aria-live="polite"
          className="text-m3-body-sm text-m3-on-surface-variant"
        >
          <span className="tabular-nums">{filtered.length}</span> of{" "}
          <span className="tabular-nums">{activities.length}</span>{" "}
          {activities.length === 1 ? "event" : "events"} shown
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div
          className="flex rounded-m3-full bg-m3-surface-container p-1"
          aria-label="Activity layout"
        >
          {(
            [
              ["chronological", "Chronological"],
              ["repository", "Group by repository"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={cn(
                "min-h-11 rounded-m3-full px-4 text-m3-label-lg",
                "transition-colors duration-(--m3-spring-effects-fast-duration) ease-(--m3-spring-effects-fast)",
                view === value
                  ? "bg-m3-secondary-container text-m3-on-secondary-container"
                  : "text-m3-on-surface-variant",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          aria-label="Repository"
          value={repository}
          onChange={(event) => setRepository(event.target.value)}
          className="min-h-11 max-w-full rounded-m3-xs border border-m3-outline-variant bg-transparent px-3 text-m3-body-md text-m3-on-surface"
        >
          <option value="all">All repositories</option>
          {repositories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Activity type"
          value={category}
          onChange={(event) => {
            // SAFETY: every option below is rendered from `categoryLabels`,
            // so the selected value is one of its keys.
            setCategory(event.target.value as ActivityCategory);
          }}
          className="min-h-11 max-w-full rounded-m3-xs border border-m3-outline-variant bg-transparent px-3 text-m3-body-md text-m3-on-surface"
        >
          {categoryEntries.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {filtersApplied ? (
          <button
            type="button"
            onClick={() => {
              setRepository("all");
              setCategory("all");
            }}
            className="min-h-11 rounded-m3-xs px-2 text-m3-label-lg text-m3-primary underline-offset-4 hover:underline"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className="mt-4 rounded-m3-sm bg-m3-surface-container-low px-4 py-4 text-m3-body-md text-m3-on-surface-variant sm:px-5">
          No activity matches these filters. {activities.length} recorded{" "}
          {activities.length === 1 ? "event" : "events"} are still stored.
        </p>
      ) : view === "chronological" ? (
        <ol className="mt-4 divide-y divide-m3-outline-variant overflow-hidden rounded-m3-sm bg-m3-surface-container-low">
          {filtered.map((activity) => (
            <ActivityItem
              key={activity.deduplicationKey}
              activity={activity}
              timeZone={timeZone}
            />
          ))}
        </ol>
      ) : (
        <div className="mt-4 grid gap-5">
          {groups.map((group) => (
            <section key={group.name} role="region" aria-label={group.name}>
              <h3 className="text-m3-title-sm wrap-anywhere text-m3-on-surface">
                {group.name}
              </h3>
              <ol className="mt-2 divide-y divide-m3-outline-variant overflow-hidden rounded-m3-sm bg-m3-surface-container-low">
                {group.activities.map((activity) => (
                  <ActivityItem
                    key={activity.deduplicationKey}
                    activity={activity}
                    timeZone={timeZone}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
