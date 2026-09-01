import {
  validRepositoryName,
  type ActivityRecord,
} from "@/lib/github-activity";
import { subjectTitleMaxLength } from "@/lib/github-collaboration";
import { parseDate, type LocalDayWindow } from "@/lib/time-zone";

type GitHubActor = { id?: unknown; login?: unknown };

type GistMetadata = {
  id?: unknown;
  html_url?: unknown;
  public?: unknown;
  description?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  owner?: GitHubActor | null;
  fork_of?: { id?: unknown } | null;
  files?: unknown;
};

type GistCommitMetadata = {
  version?: unknown;
  committed_at?: unknown;
  user?: GitHubActor | null;
};

type GistCommentMetadata = {
  id?: unknown;
  created_at?: unknown;
  user?: GitHubActor | null;
  body?: unknown;
};

type SocialEventMetadata = {
  id?: unknown;
  type?: unknown;
  actor?: GitHubActor;
  repo?: { id?: unknown; name?: unknown };
  public?: unknown;
  created_at?: unknown;
  payload?: {
    action?: unknown;
    forkee?: { id?: unknown; full_name?: unknown; html_url?: unknown };
  };
};

export type SecondarySourceFreshness = {
  source: "social" | "gists";
  label: string;
  status: "best-effort" | "unavailable";
  refreshedAt: Date | null;
  detail: string;
};

export type StoredSecondarySourceFreshness = Omit<
  SecondarySourceFreshness,
  "refreshedAt"
> & {
  refreshedAt: string | null;
};

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function boundedDescription(value: unknown) {
  if (!nonEmptyString(value)) return null;
  const description = value.trim();
  return description.length > subjectTitleMaxLength
    ? `${description.slice(0, subjectTitleMaxLength - 1)}…`
    : description;
}

function sameActor(
  candidate: GitHubActor | null | undefined,
  actor: {
    id: number;
    login: string;
  },
) {
  return (
    candidate?.id === actor.id &&
    typeof candidate.login === "string" &&
    candidate.login.toLowerCase() === actor.login.toLowerCase()
  );
}

function withinWindow(date: Date, window: LocalDayWindow) {
  return date >= window.startsAt && date < window.endsAt;
}

function validGistUrl(value: unknown): value is string {
  if (!nonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "gist.github.com";
  } catch {
    return false;
  }
}

function validGitHubUrl(value: unknown): value is string {
  if (!nonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com";
  } catch {
    return false;
  }
}

export function normalizeGistActivity({
  gist,
  commits,
  comments,
  actor,
  window,
  observedAt,
}: {
  gist: GistMetadata;
  commits: GistCommitMetadata[];
  comments: GistCommentMetadata[];
  actor: { id: number; login: string };
  window: LocalDayWindow;
  observedAt: Date;
}): ActivityRecord[] {
  if (
    !nonEmptyString(gist.id) ||
    !validGistUrl(gist.html_url) ||
    typeof gist.public !== "boolean" ||
    !sameActor(gist.owner, actor)
  ) {
    return [];
  }

  const gistId = gist.id.trim();
  const evidenceUrl = gist.html_url;
  const visibility: ActivityRecord["visibility"] = gist.public
    ? "public"
    : "private";
  const title = boundedDescription(gist.description);
  const base = {
    localDate: window.localDate,
    actorId: String(actor.id),
    actorLogin: actor.login,
    repositoryId: `gists:${actor.id}`,
    repositoryName: `${actor.login}/Gists`,
    evidenceUrl,
    visibility,
    source: "github-gists" as const,
    subjectNumber: null,
    subjectTitle: title,
    observedAt,
    authoredBeforeDay: false,
    installationId: null,
    narrativeEligible: true,
  };
  const records: ActivityRecord[] = [];
  const createdAt = parseDate(gist.created_at);

  for (const commit of commits) {
    const committedAt = parseDate(commit.committed_at);
    if (
      !nonEmptyString(commit.version) ||
      !committedAt ||
      !withinWindow(committedAt, window) ||
      !sameActor(commit.user, actor)
    ) {
      continue;
    }
    const isCreation =
      createdAt !== null && committedAt.getTime() === createdAt.getTime();
    const kind = isCreation
      ? gist.fork_of
        ? "gist-forked"
        : "gist-created"
      : "gist-updated";
    records.push({
      ...base,
      kind,
      deduplicationKey: isCreation
        ? `github:${kind}:${gistId}`
        : `github:gist-updated:${gistId}:${commit.version.trim()}`,
      subjectId: isCreation ? gistId : commit.version.trim(),
      occurredAt: committedAt,
    });
  }

  // A list response can occasionally race the commits endpoint. Preserve a
  // metadata-only creation observation rather than reading Gist files.
  if (records.length === 0 && createdAt && withinWindow(createdAt, window)) {
    const kind = gist.fork_of ? "gist-forked" : "gist-created";
    records.push({
      ...base,
      kind,
      deduplicationKey: `github:${kind}:${gistId}`,
      subjectId: gistId,
      occurredAt: createdAt,
    });
  }

  for (const comment of comments) {
    const commentAt = parseDate(comment.created_at);
    if (
      !positiveInteger(comment.id) ||
      !commentAt ||
      !withinWindow(commentAt, window) ||
      !sameActor(comment.user, actor)
    ) {
      continue;
    }
    records.push({
      ...base,
      kind: "gist-comment",
      deduplicationKey: `github:gist-comment:${gistId}:${comment.id}`,
      subjectId: String(comment.id),
      occurredAt: commentAt,
    });
  }

  return records;
}

export function normalizeSocialEvent({
  event,
  actor,
  window,
  observedAt,
}: {
  event: SocialEventMetadata;
  actor: { id: number; login: string };
  window: LocalDayWindow;
  observedAt: Date;
}): ActivityRecord | null {
  const occurredAt = parseDate(event.created_at);
  const repositoryName = event.repo?.name;
  if (
    !nonEmptyString(event.id) ||
    !sameActor(event.actor, actor) ||
    !positiveInteger(event.repo?.id) ||
    !validRepositoryName(repositoryName) ||
    typeof event.public !== "boolean" ||
    !occurredAt ||
    !withinWindow(occurredAt, window)
  ) {
    return null;
  }

  let kind: "repository-starred" | "repository-forked";
  let evidenceUrl = `https://github.com/${repositoryName}`;
  let subjectId = String(event.repo.id);
  let subjectTitle: string | null = repositoryName;
  if (event.type === "WatchEvent" && event.payload?.action === "started") {
    kind = "repository-starred";
  } else if (
    event.type === "ForkEvent" &&
    positiveInteger(event.payload?.forkee?.id) &&
    validRepositoryName(event.payload.forkee.full_name) &&
    validGitHubUrl(event.payload.forkee.html_url)
  ) {
    kind = "repository-forked";
    evidenceUrl = event.payload.forkee.html_url;
    subjectId = String(event.payload.forkee.id);
    subjectTitle = event.payload.forkee.full_name;
  } else {
    return null;
  }

  return {
    deduplicationKey: `github:${kind}:${event.id.trim()}`,
    localDate: window.localDate,
    kind,
    actorId: String(actor.id),
    actorLogin: actor.login,
    repositoryId: String(event.repo.id),
    repositoryName,
    evidenceUrl,
    visibility: event.public ? "public" : "private",
    source: "github-events",
    subjectId,
    subjectNumber: null,
    subjectTitle,
    occurredAt,
    observedAt,
    authoredBeforeDay: false,
    installationId: null,
    narrativeEligible: false,
  };
}

export function secondarySourceFreshness({
  refreshedAt,
  eventsSucceeded,
  gistsSucceeded,
}: {
  refreshedAt: Date;
  eventsSucceeded: boolean;
  gistsSucceeded: boolean;
}): SecondarySourceFreshness[] {
  return [
    {
      source: "social",
      label: "Social activity",
      status: eventsSucceeded ? "best-effort" : "unavailable",
      refreshedAt: eventsSucceeded ? refreshedAt : null,
      detail: eventsSucceeded
        ? "GitHub's activity feed may be delayed by up to 6 hours; follows, watches, and sponsorships are shown only when GitHub exposes them."
        : "GitHub's delayed activity feed was unavailable during this refresh.",
    },
    {
      source: "gists",
      label: "Gists",
      status: gistsSucceeded ? "best-effort" : "unavailable",
      refreshedAt: gistsSucceeded ? refreshedAt : null,
      detail: gistsSucceeded
        ? "Metadata-only reconciliation; Gist stars have no reliable action timestamp and may be unavailable."
        : "Gist metadata reconciliation was unavailable during this refresh.",
    },
  ];
}
