"use client";

import {
  ArrowUpRight,
  CircleDot,
  GitBranch,
  GitCommitHorizontal,
  LockKeyhole,
  MessageSquare,
  Rocket,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

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

const activityIcons: Partial<Record<ActivityKind, LucideIcon>> = {
  push: Upload,
  commit: GitCommitHorizontal,
  "branch-created": GitBranch,
  "branch-deleted": GitBranch,
  "tag-created": GitBranch,
  "tag-deleted": GitBranch,
  "release-published": Rocket,
  "release-updated": Rocket,
  deployment: Rocket,
  "discussion-created": MessageSquare,
  "discussion-comment": MessageSquare,
  "discussion-answered": MessageSquare,
  "issue-comment": MessageSquare,
  "pull-request-comment": MessageSquare,
  "pull-request-review-comment": MessageSquare,
};

function coverageLabel(activity: ActivityRecord) {
  if (activity.kind === "gist-starred") return "First observed · best-effort";
  if (activity.source === "github-projects-preview")
    return "Preview · best-effort";
  if (activity.source === "github-gists") return "Reconciliation · best-effort";
  if (secondaryKinds.includes(activity.kind as never))
    return "Delayed source · best-effort";
  return null;
}

function ActivityItem({
  activity,
  timeZone,
}: {
  activity: ActivityRecord;
  timeZone: string;
}) {
  const [label, evidenceNoun] = activityLabels[activity.kind];
  const Icon = activityIcons[activity.kind] ?? CircleDot;
  const bestEffortLabel = coverageLabel(activity);

  return (
    <li className="rounded-m3-xl bg-m3-surface-container-low p-5 sm:p-6">
      <div className="flex gap-4">
        <span className="bg-surface grid size-11 shrink-0 place-items-center rounded-m3-lg text-primary shadow-m3-1">
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-m3-title-md-emphasized">
              {label}
              {activity.subjectNumber !== null
                ? ` #${activity.subjectNumber}`
                : ""}
            </h3>
            {activity.visibility === "private" ? (
              <span className="bg-secondary-container inline-flex items-center gap-1 rounded-m3-full px-2.5 py-1 text-m3-label-sm text-secondary-foreground">
                <LockKeyhole aria-hidden className="size-3.5" /> Private
                repository
              </span>
            ) : null}
            {activity.authoredBeforeDay ? (
              <span className="rounded-m3-full bg-m3-warning-container px-2.5 py-1 text-m3-label-sm text-m3-on-warning-container">
                Authored before today
              </span>
            ) : null}
            {activity.status ? (
              <span className="bg-secondary-container rounded-m3-full px-2.5 py-1 text-m3-label-sm text-secondary-foreground">
                {statusLabels[activity.status]}
              </span>
            ) : null}
            {activity.narrativeEligible === false ? (
              <span className="rounded-m3-full bg-m3-warning-container px-2.5 py-1 text-m3-label-sm text-m3-on-warning-container">
                Excluded from narrative
              </span>
            ) : null}
            {bestEffortLabel ? (
              <span className="bg-secondary-container rounded-m3-full px-2.5 py-1 text-m3-label-sm text-secondary-foreground">
                {bestEffortLabel}
              </span>
            ) : null}
          </div>
          {activity.subjectTitle ? (
            <p className="mt-2 text-m3-body-md break-words">
              {activity.subjectTitle}
            </p>
          ) : null}
          <p
            className={cn(
              "break-words",
              activity.subjectTitle
                ? "mt-1 text-m3-body-sm text-muted-foreground"
                : "mt-2 text-m3-body-md",
            )}
          >
            {activity.repositoryName}
          </p>
          <p className="mt-1 text-m3-body-sm text-muted-foreground">
            <time dateTime={activity.occurredAt.toISOString()}>
              {new Intl.DateTimeFormat("en-US", {
                timeZone,
                hour: "numeric",
                minute: "2-digit",
                month: activity.authoredBeforeDay ? "short" : undefined,
                day: activity.authoredBeforeDay ? "numeric" : undefined,
              }).format(activity.occurredAt)}
            </time>
            {` · @${activity.actorLogin}`}
          </p>
          {activity.evidenceUrl ? (
            <a
              href={activity.evidenceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-m3-label-lg-emphasized mt-3 inline-flex min-h-11 items-center gap-2 text-primary underline-offset-4 hover:underline"
            >
              View {evidenceNoun} evidence{" "}
              <ArrowUpRight aria-hidden className="size-4" />
            </a>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function JournalExplorer({
  activities,
  timeZone,
  title = "Today's activity",
  eyebrow = "EXPLORE",
  headingId = "journal-timeline-heading",
}: {
  activities: ActivityRecord[];
  timeZone: string;
  title?: string;
  eyebrow?: string;
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

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-m3-label-lg-emphasized text-primary">{eyebrow}</p>
          <h2 id={headingId} className="mt-2 text-m3-headline-sm">
            {title}
          </h2>
        </div>
        <div
          className="flex rounded-m3-full bg-m3-surface-container p-1"
          aria-label="Activity layout"
        >
          <button
            type="button"
            aria-pressed={view === "chronological"}
            onClick={() => setView("chronological")}
            className={cn(
              "text-m3-label-lg-emphasized min-h-11 rounded-m3-full px-4",
              view === "chronological" && "bg-card text-primary shadow-m3-1",
            )}
          >
            Chronological
          </button>
          <button
            type="button"
            aria-pressed={view === "repository"}
            onClick={() => setView("repository")}
            className={cn(
              "text-m3-label-lg-emphasized min-h-11 rounded-m3-full px-4",
              view === "repository" && "bg-card text-primary shadow-m3-1",
            )}
          >
            Group by repository
          </button>
        </div>
      </div>
      <div className="mt-5 grid gap-4 rounded-m3-xl bg-m3-surface-container-low p-4 sm:grid-cols-2">
        <label className="text-m3-label-lg-emphasized">
          Repository
          <select
            aria-label="Repository"
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
            className="mt-2 min-h-12 w-full rounded-m3-md border border-border bg-card px-3 text-m3-body-md"
          >
            <option value="all">All repositories</option>
            {repositories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-m3-label-lg-emphasized">
          Activity type
          <select
            aria-label="Activity type"
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as ActivityCategory)
            }
            className="mt-2 min-h-12 w-full rounded-m3-md border border-border bg-card px-3 text-m3-body-md"
          >
            {(
              Object.entries(categoryLabels) as Array<
                [ActivityCategory, string]
              >
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p
        aria-live="polite"
        className="mt-4 text-m3-body-sm text-muted-foreground"
      >
        Showing {filtered.length} of {activities.length} activities
      </p>
      {filtered.length === 0 ? (
        <p className="mt-5 rounded-m3-xl bg-m3-surface-container-low p-6 text-m3-body-md">
          No activity matches these filters.
        </p>
      ) : view === "chronological" ? (
        <ol className="mt-5 space-y-3">
          {filtered.map((activity) => (
            <ActivityItem
              key={activity.deduplicationKey}
              activity={activity}
              timeZone={timeZone}
            />
          ))}
        </ol>
      ) : (
        <div className="mt-5 space-y-6">
          {groups.map((group) => (
            <section key={group.name} role="region" aria-label={group.name}>
              <h3 className="text-m3-title-lg-emphasized break-words">
                {group.name}
              </h3>
              <ol className="mt-3 space-y-3">
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
