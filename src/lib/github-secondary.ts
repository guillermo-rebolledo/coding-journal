import {
  activityIdentity,
  createActivityRecord,
  validRepositoryName,
  type ActivityRecord,
} from "@/lib/github-activity";
import { subjectTitleMaxLength } from "@/lib/github-collaboration";
import {
  readBoolean,
  readNonEmptyString,
  readObject,
  readPositiveInteger,
  readString,
  type JsonObject,
} from "@/lib/json-payload";
import { parseDate, type LocalDayWindow } from "@/lib/time-zone";

/** The actor whose activity the reconciliation pass is collecting. */
type ReconciledActor = { id: number; login: string };

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

function boundedDescription(value: string | null) {
  if (value === null) return null;
  const description = value.trim();
  if (!description) return null;
  return description.length > subjectTitleMaxLength
    ? `${description.slice(0, subjectTitleMaxLength - 1)}…`
    : description;
}

/** Whether a decoded `user`/`owner`/`actor` member is the reconciled actor. */
function sameActor(
  candidate: JsonObject | null,
  actor: ReconciledActor,
): boolean {
  const login = readString(candidate, "login");
  return (
    readPositiveInteger(candidate, "id") === actor.id &&
    login !== null &&
    login.toLowerCase() === actor.login.toLowerCase()
  );
}

function withinWindow(date: Date, window: LocalDayWindow) {
  return date >= window.startsAt && date < window.endsAt;
}

/** Narrows a decoded string to an absolute URL on the given host. */
function validUrlOn(host: string, value: string | null): value is string {
  if (value === null || value.trim().length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === host;
  } catch {
    return false;
  }
}

function validGistUrl(value: string | null): value is string {
  return validUrlOn("gist.github.com", value);
}

function validGitHubUrl(value: string | null): value is string {
  return validUrlOn("github.com", value);
}

export function normalizeGistActivity({
  gist,
  commits,
  comments,
  actor,
  window,
  observedAt,
}: {
  gist: JsonObject;
  commits: readonly JsonObject[];
  comments: readonly JsonObject[];
  actor: ReconciledActor;
  window: LocalDayWindow;
  observedAt: Date;
}): ActivityRecord[] {
  const gistId = readNonEmptyString(gist, "id");
  const evidenceUrl = readString(gist, "html_url");
  const isPublic = readBoolean(gist, "public");
  if (
    gistId === null ||
    !validGistUrl(evidenceUrl) ||
    isPublic === null ||
    !sameActor(readObject(gist, "owner"), actor)
  ) {
    return [];
  }

  const title = boundedDescription(readString(gist, "description"));
  const forkOf = readObject(gist, "fork_of");
  const base = {
    actor: { id: String(actor.id), login: actor.login },
    repository: {
      id: `gists:${actor.id}`,
      name: `${actor.login}/Gists`,
      private: !isPublic,
    },
    evidence: { shape: "absolute", url: evidenceUrl } as const,
    source: "github-gists" as const,
    observedAt,
    window,
    installationId: null,
    narrativeEligible: true,
  };
  const records: ActivityRecord[] = [];
  const createdAt = parseDate(readString(gist, "created_at"));

  for (const commit of commits) {
    const version = readNonEmptyString(commit, "version");
    const committedAt = parseDate(readString(commit, "committed_at"));
    if (
      version === null ||
      !committedAt ||
      !withinWindow(committedAt, window) ||
      !sameActor(readObject(commit, "user"), actor)
    ) {
      continue;
    }
    const isCreation =
      createdAt !== null && committedAt.getTime() === createdAt.getTime();
    const kind = isCreation
      ? forkOf !== null
        ? "gist-forked"
        : "gist-created"
      : "gist-updated";
    records.push(
      createActivityRecord({
        ...base,
        kind,
        identity: activityIdentity.global(
          kind,
          isCreation ? gistId : `${gistId}:${version}`,
        ),
        subject: {
          id: isCreation ? gistId : version,
          number: null,
          title,
        },
        occurredAt: committedAt,
      }),
    );
  }

  // A list response can occasionally race the commits endpoint. Preserve a
  // metadata-only creation observation rather than reading Gist files.
  if (records.length === 0 && createdAt && withinWindow(createdAt, window)) {
    const kind = forkOf !== null ? "gist-forked" : "gist-created";
    records.push(
      createActivityRecord({
        ...base,
        kind,
        identity: activityIdentity.global(kind, gistId),
        subject: { id: gistId, number: null, title },
        occurredAt: createdAt,
      }),
    );
  }

  for (const comment of comments) {
    const commentId = readPositiveInteger(comment, "id");
    const commentAt = parseDate(readString(comment, "created_at"));
    if (
      commentId === null ||
      !commentAt ||
      !withinWindow(commentAt, window) ||
      !sameActor(readObject(comment, "user"), actor)
    ) {
      continue;
    }
    records.push(
      createActivityRecord({
        ...base,
        kind: "gist-comment",
        identity: activityIdentity.global(
          "gist-comment",
          `${gistId}:${commentId}`,
        ),
        subject: { id: String(commentId), number: null, title },
        occurredAt: commentAt,
      }),
    );
  }

  return records;
}

// GitHub exposes the current set of starred Gists, but not the time each star
// was created. Record the stable metadata the first time reconciliation sees
// it; the canonical deduplication key prevents later refreshes from recounting
// the same star.
export function normalizeGistStarActivity({
  gist,
  actor,
  window,
  observedAt,
}: {
  gist: JsonObject;
  actor: ReconciledActor;
  window: LocalDayWindow;
  observedAt: Date;
}): ActivityRecord | null {
  const gistId = readNonEmptyString(gist, "id");
  const evidenceUrl = readString(gist, "html_url");
  const isPublic = readBoolean(gist, "public");
  if (gistId === null || !validGistUrl(evidenceUrl) || isPublic === null) {
    return null;
  }

  return createActivityRecord({
    kind: "gist-starred",
    identity: activityIdentity.global("gist-starred", gistId),
    evidence: { shape: "absolute", url: evidenceUrl },
    actor: { id: String(actor.id), login: actor.login },
    repository: {
      id: `gists:${actor.id}`,
      name: `${actor.login}/Gists`,
      private: !isPublic,
    },
    subject: {
      id: gistId,
      number: null,
      title: boundedDescription(readString(gist, "description")),
    },
    source: "github-gists",
    occurredAt: observedAt,
    observedAt,
    window,
    installationId: null,
    narrativeEligible: false,
  });
}

export function normalizeSocialEvent({
  event,
  actor,
  window,
  observedAt,
}: {
  event: JsonObject;
  actor: ReconciledActor;
  window: LocalDayWindow;
  observedAt: Date;
}): ActivityRecord | null {
  const eventId = readNonEmptyString(event, "id");
  const occurredAt = parseDate(readString(event, "created_at"));
  const repository = readObject(event, "repo");
  const repositoryId = readPositiveInteger(repository, "id");
  const repositoryName = readString(repository, "name");
  const isPublic = readBoolean(event, "public");
  if (
    eventId === null ||
    !sameActor(readObject(event, "actor"), actor) ||
    repositoryId === null ||
    !validRepositoryName(repositoryName) ||
    isPublic === null ||
    !occurredAt ||
    !withinWindow(occurredAt, window)
  ) {
    return null;
  }

  const eventType = readString(event, "type");
  const payload = readObject(event, "payload");
  const forkee = readObject(payload, "forkee");
  const forkeeId = readPositiveInteger(forkee, "id");
  const forkeeName = readString(forkee, "full_name");
  const forkeeUrl = readString(forkee, "html_url");

  let kind: "repository-starred" | "repository-forked";
  let evidenceUrl = `https://github.com/${repositoryName}`;
  let subjectId = String(repositoryId);
  let subjectTitle: string | null = repositoryName;
  if (
    eventType === "WatchEvent" &&
    readString(payload, "action") === "started"
  ) {
    kind = "repository-starred";
  } else if (
    eventType === "ForkEvent" &&
    forkeeId !== null &&
    validRepositoryName(forkeeName) &&
    validGitHubUrl(forkeeUrl)
  ) {
    kind = "repository-forked";
    evidenceUrl = forkeeUrl;
    subjectId = String(forkeeId);
    subjectTitle = forkeeName;
  } else {
    return null;
  }

  return createActivityRecord({
    kind,
    identity: activityIdentity.global(kind, eventId),
    evidence: { shape: "absolute", url: evidenceUrl },
    actor: { id: String(actor.id), login: actor.login },
    repository: {
      id: String(repositoryId),
      name: repositoryName,
      private: !isPublic,
    },
    subject: { id: subjectId, number: null, title: subjectTitle },
    source: "github-events",
    occurredAt,
    observedAt,
    window,
    installationId: null,
    narrativeEligible: false,
  });
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
        ? "GitHub's activity feed may be delayed by up to 6 hours. It exposes repository stars and forks; follows, watches, and sponsorships are unavailable from this source."
        : "GitHub's delayed activity feed was unavailable during this refresh.",
    },
    {
      source: "gists",
      label: "Gists",
      status: gistsSucceeded ? "best-effort" : "unavailable",
      refreshedAt: gistsSucceeded ? refreshedAt : null,
      detail: gistsSucceeded
        ? "Metadata-only reconciliation. Gist stars are recorded when first observed because GitHub does not expose the action timestamp."
        : "Gist metadata reconciliation was unavailable during this refresh.",
    },
  ];
}
