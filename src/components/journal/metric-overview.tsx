import { ChevronDown } from "lucide-react";

import type { ActivityMetrics } from "@/lib/github-activity";
import { cn } from "@/lib/utils";

/**
 * Compact metric overview — direction 1e of the look-and-feel reference
 * (`docs/design/Coding Journal look and feel.html`, frames 1d–1f, and pattern 1
 * of frame 1n).
 *
 * The 16-card wall becomes one divided strip of the day's high-signal,
 * non-zero categories, with every category one disclosure away in a grouped
 * table. Zeroes are kept — the record must stay complete — but they drop to
 * `outline` and never take the same area as the day's real work.
 */

type MetricKey = keyof ActivityMetrics;

const metricLabels: Record<MetricKey, { one: string; many: string }> = {
  pushes: { one: "push", many: "pushes" },
  commits: { one: "commit", many: "commits" },
  refs: { one: "ref change", many: "ref changes" },
  releases: { one: "release", many: "releases" },
  discussions: { one: "discussion", many: "discussions" },
  issues: { one: "issue update", many: "issue updates" },
  pullRequests: { one: "pull request", many: "pull requests" },
  reviews: { one: "review", many: "reviews" },
  merges: { one: "merge", many: "merges" },
  comments: { one: "comment", many: "comments" },
  workflows: { one: "workflow run", many: "workflow runs" },
  deployments: { one: "deployment", many: "deployments" },
  packages: { one: "package update", many: "package updates" },
  projects: { one: "project update", many: "project updates" },
  gists: { one: "Gist update", many: "Gist updates" },
  social: { one: "social action", many: "social actions" },
};

/** Grouped by what the categories mean, not by the order GitHub sends them. */
const metricGroups: ReadonlyArray<{ name: string; keys: MetricKey[] }> = [
  { name: "Code", keys: ["commits", "pushes", "refs", "releases"] },
  {
    name: "Collaboration",
    keys: [
      "pullRequests",
      "reviews",
      "merges",
      "issues",
      "comments",
      "discussions",
    ],
  },
  { name: "Automation", keys: ["workflows", "deployments", "packages"] },
  { name: "Delayed sources", keys: ["projects", "gists", "social"] },
];

/** Which categories earn a place in the strip first when several are non-zero. */
const stripPriority: MetricKey[] = [
  "commits",
  "pullRequests",
  "reviews",
  "merges",
  "issues",
  "comments",
  "pushes",
  "workflows",
  "deployments",
  "releases",
  "refs",
  "discussions",
  "packages",
  "projects",
  "gists",
  "social",
];

const stripLimit = 4;

export const metricKeys = Object.keys(metricLabels) as MetricKey[];

export function metricNoun(key: MetricKey, value: number) {
  return value === 1 ? metricLabels[key].one : metricLabels[key].many;
}

export function metricHeading(key: MetricKey) {
  const many = metricLabels[key].many;
  return many.charAt(0).toUpperCase() + many.slice(1);
}

export function MetricOverview({
  metrics,
  eventCount,
  headingId,
  className,
}: {
  metrics: ActivityMetrics;
  eventCount: number;
  headingId: string;
  className?: string;
}) {
  const active = metricKeys.filter((key) => metrics[key] > 0);
  const quiet = metricKeys.length - active.length;
  const strip = stripPriority
    .filter((key) => metrics[key] > 0)
    .slice(0, stripLimit);

  return (
    <section aria-labelledby={headingId} className={className}>
      <h2 id={headingId} className="sr-only">
        Recorded activity
      </h2>
      <p className="text-m3-body-md text-m3-on-surface-variant">
        <span className="tabular-nums">{eventCount}</span>{" "}
        {eventCount === 1 ? "recorded event" : "recorded events"} ·{" "}
        <span className="tabular-nums">{active.length}</span>{" "}
        {active.length === 1 ? "category" : "categories"} with activity ·{" "}
        <span className="tabular-nums">{quiet}</span> quiet
      </p>

      {strip.length ? (
        <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-m3-sm bg-m3-outline-variant sm:flex sm:w-fit">
          {strip.map((key) => (
            <div
              key={key}
              className="flex flex-col-reverse bg-m3-surface-container-low px-4 py-3 last:odd:col-span-2 sm:min-w-28 sm:flex-none"
            >
              <dt className="mt-0.5 text-m3-label-md text-m3-on-surface-variant">
                {metricNoun(key, metrics[key])}
              </dt>
              <dd className="text-m3-headline-sm text-m3-on-surface tabular-nums">
                {metrics[key]}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <details className="group mt-3">
        <summary
          className={cn(
            "flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 rounded-m3-xs",
            "text-m3-label-lg text-m3-primary [&::-webkit-details-marker]:hidden",
          )}
        >
          All 16 categories
          <ChevronDown
            aria-hidden
            className="size-4 transition-transform duration-(--m3-spring-spatial-default-duration) ease-(--m3-spring-spatial-default) group-open:rotate-180"
          />
          <span className="text-m3-body-sm text-m3-on-surface-variant">
            {quiet === 0
              ? "every category recorded something"
              : `${quiet} ${quiet === 1 ? "category" : "categories"} quiet today`}
          </span>
        </summary>
        <div
          role="group"
          aria-label="All 16 categories"
          className="mt-3 divide-y divide-m3-outline-variant overflow-hidden rounded-m3-sm bg-m3-surface-container-low"
        >
          {metricGroups.map((group) => (
            <div key={group.name} className="px-4 py-3 sm:px-5">
              <h3 className="text-m3-label-md text-m3-on-surface-variant">
                {group.name}
              </h3>
              <dl className="mt-1">
                {group.keys.map((key) => (
                  <div
                    key={key}
                    className={cn(
                      "flex items-baseline justify-between gap-4 py-1 text-m3-body-md",
                      metrics[key] > 0
                        ? "text-m3-on-surface"
                        : "text-m3-outline",
                    )}
                  >
                    <dt className="wrap-anywhere">{metricHeading(key)}</dt>
                    <dd className="tabular-nums">{metrics[key]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
