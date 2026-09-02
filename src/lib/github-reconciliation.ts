import {
  commitDeduplicationKey,
  pushDeduplicationKey,
  pushEvidenceUrl,
  validRepositoryName,
  validSha,
  type ActivityMetrics,
  type ActivityRecord,
} from "@/lib/github-activity";
import {
  collaborationEventForApiType,
  deriveCollaborationSubject,
} from "@/lib/github-collaboration";
import {
  normalizeGistActivity,
  normalizeGistStarActivity,
  normalizeSocialEvent,
  secondarySourceFreshness,
  type SecondarySourceFreshness,
} from "@/lib/github-secondary";
import {
  isJsonObject,
  readBoolean,
  readNonEmptyString,
  readNumber,
  readObject,
  readObjectArray,
  readPositiveInteger,
  readString,
  type JsonObject,
} from "@/lib/json-payload";
import {
  getLocalDayWindow,
  getLocalDayWindowForDate,
  parseDate,
} from "@/lib/time-zone";

// These moved to their shared homes; re-exported so existing importers of the
// reconciliation module keep working.
export {
  commitDeduplicationKey,
  pushDeduplicationKey,
  pushEvidenceUrl,
  validRepositoryName,
  validSha,
  computeActivityMetrics,
  type ActivityMetrics,
  type ActivityRecord,
} from "@/lib/github-activity";
export {
  getLocalDayWindow,
  parseDate,
  type LocalDayWindow,
} from "@/lib/time-zone";

const githubApiVersion = "2026-03-10";
const githubEventsPageSize = 100;
// The events feed exposes at most 300 events; page 4 answers 422.
const githubEventsMaxPages = 3;
export const reconciliationCooldownMs = 15 * 60 * 1000;

export type TodayJournal = {
  localDate: string;
  timeZone: string;
  status: "loading" | "complete" | "partial" | "error";
  refreshedAt: Date | null;
  /** Last persisted mutation of this day's journal. */
  storedAt?: Date;
  /** Last time a GitHub reconciliation claimed the cooldown window. */
  lastAttemptAt?: Date;
  /** Transient provider limit returned by an attempted reconciliation. */
  rateLimitedUntil?: Date;
  /** True only for an empty stored view before the first manual reconciliation. */
  awaitingReconciliation?: boolean;
  metrics: ActivityMetrics;
  activities: ActivityRecord[];
  sourceFreshness?: SecondarySourceFreshness[];
};

export type ReconciliationStore = {
  tryStart(
    userId: string,
    localDate: string,
    now: Date,
    cutoff: Date,
    timeZone: string,
  ): Promise<boolean>;
  finish(
    userId: string,
    journal: Omit<TodayJournal, "activities" | "metrics">,
    records: ActivityRecord[],
  ): Promise<void>;
  read(userId: string, localDate: string): Promise<TodayJournal>;
};

// Reconciliation swallows provider failures by design; this reports what
// failed without exposing request bodies, payloads, or credentials.
export type ReconciliationDiagnostic = {
  stage:
    | "user-access-token"
    | "actor"
    | "events"
    | "gists"
    | "gist-metadata"
    | "push-commits"
    | "installation-repositories"
    | "repository-commits";
  errorName: string;
  errorMessage: string;
  rateLimitResetAt?: Date;
};

export type DiagnosticReporter = (diagnostic: ReconciliationDiagnostic) => void;

/** What a failed reconciliation stage reports about the error that stopped it. */
type ErrorDescription = Pick<
  ReconciliationDiagnostic,
  "errorName" | "errorMessage" | "rateLimitResetAt"
>;

export function describeError(cause: unknown): ErrorDescription {
  if (cause instanceof GitHubRequestError) {
    const described: ErrorDescription = {
      errorName: cause.name,
      errorMessage: cause.message,
    };
    // Only rate-limit failures carry a reset instant; the others must not
    // report one at all.
    if (cause.rateLimitResetAt) {
      described.rateLimitResetAt = cause.rateLimitResetAt;
    }
    return described;
  }
  if (cause instanceof Error) {
    return { errorName: cause.name, errorMessage: cause.message };
  }
  return {
    errorName: "UnknownError",
    errorMessage: "A non-error value was thrown",
  };
}

/** The actor whose activity this pass reconciles. */
type GitHubActor = { id: number; login: string };

/**
 * A decoded GitHub REST body. Every endpoint this module calls answers with
 * either a single object or a list of them, so the decode happens once in
 * `fetchJson` and callers pick the arm they expect.
 */
type GitHubJsonBody =
  | { kind: "object"; value: JsonObject }
  | { kind: "list"; value: readonly JsonObject[] }
  | { kind: "other" };

/** Narrows a decoded body to the single object an endpoint promised. */
function objectBody(body: GitHubJsonBody): JsonObject | null {
  return body.kind === "object" ? body.value : null;
}

/** Narrows a decoded body to the list an endpoint promised. */
function listBody(body: GitHubJsonBody): readonly JsonObject[] | null {
  return body.kind === "list" ? body.value : null;
}

function githubHeaders(accessToken: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": githubApiVersion,
  };
}

export class GitHubRequestError extends Error {
  readonly status: number;
  readonly rateLimitResetAt: Date | null;

  constructor(status: number, rateLimitResetAt: Date | null = null) {
    super(`GitHub request failed (${status})`);
    this.name = "GitHubRequestError";
    this.status = status;
    this.rateLimitResetAt = rateLimitResetAt;
  }
}

async function fetchJson(
  url: string,
  accessToken: string,
  fetchImplementation: typeof fetch,
): Promise<GitHubJsonBody> {
  const response = await fetchImplementation(url, {
    headers: githubHeaders(accessToken),
    cache: "no-store",
  });
  if (!response.ok) {
    const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const rateLimited =
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" ||
          response.headers.has("retry-after")));
    const rateLimitResetAt = rateLimited
      ? Number.isFinite(resetSeconds) && resetSeconds > 0
        ? new Date(resetSeconds * 1000)
        : Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? new Date(Date.now() + retryAfterSeconds * 1000)
          : new Date(Date.now() + reconciliationCooldownMs)
      : null;
    throw new GitHubRequestError(response.status, rateLimitResetAt);
  }
  const body: unknown = await response.json();
  if (isJsonObject(body)) return { kind: "object", value: body };
  if (!Array.isArray(body)) return { kind: "other" };
  return { kind: "list", value: body.filter((entry) => isJsonObject(entry)) };
}

export async function reconcileGitHubActivity({
  userId,
  timeZone,
  accessMode,
  installationIds,
  accessToken,
  now,
  localDate,
  fetchImplementation = fetch,
  store,
  reportDiagnostic = () => {},
}: {
  userId: string;
  timeZone: string;
  accessMode: "best-effort" | "app";
  installationIds: string[];
  accessToken: string | null;
  now: Date;
  localDate?: string;
  fetchImplementation?: typeof fetch;
  store: ReconciliationStore;
  reportDiagnostic?: DiagnosticReporter;
}): Promise<TodayJournal> {
  const window = localDate
    ? getLocalDayWindowForDate(localDate, timeZone)
    : getLocalDayWindow(now, timeZone);
  const started = await store.tryStart(
    userId,
    window.localDate,
    now,
    new Date(now.getTime() - reconciliationCooldownMs),
    timeZone,
  );
  if (!started) return store.read(userId, window.localDate);

  if (!accessToken) {
    const sourceFreshness = secondarySourceFreshness({
      refreshedAt: now,
      eventsSucceeded: false,
      gistsSucceeded: false,
    });
    await store.finish(
      userId,
      {
        localDate: window.localDate,
        timeZone,
        status: "error",
        refreshedAt: null,
        sourceFreshness,
      },
      [],
    );
    return store.read(userId, window.localDate);
  }

  const records = new Map<string, ActivityRecord>();
  let actor: GitHubActor | null = null;
  let eventsSucceeded = false;
  let gistsSucceeded = false;
  let repositoryCommitsSucceeded = false;
  let degraded = false;

  try {
    const rawActor = objectBody(
      await fetchJson(
        "https://api.github.com/user",
        accessToken,
        fetchImplementation,
      ),
    );
    const actorId = readPositiveInteger(rawActor, "id");
    const actorLogin = readString(rawActor, "login");
    if (actorId === null || actorLogin === null) {
      throw new Error("GitHub actor response was invalid");
    }
    actor = { id: actorId, login: actorLogin };
  } catch (error) {
    reportDiagnostic({ stage: "actor", ...describeError(error) });
    degraded = true;
  }

  if (actor) {
    try {
      const rawEvents: JsonObject[] = [];
      for (let page = 1; page <= githubEventsMaxPages; page += 1) {
        let response: GitHubJsonBody;
        try {
          response = await fetchJson(
            `https://api.github.com/users/${encodeURIComponent(actor.login)}/events?per_page=${githubEventsPageSize}&page=${page}`,
            accessToken,
            fetchImplementation,
          );
        } catch (error) {
          // Past the feed's pagination limit GitHub answers 422. Keep the
          // events collected so far rather than losing the whole pass.
          if (error instanceof GitHubRequestError && error.status === 422) {
            reportDiagnostic({ stage: "events", ...describeError(error) });
            degraded = true;
            break;
          }
          throw error;
        }
        const events = listBody(response);
        if (events === null) throw new Error("Invalid GitHub events");
        rawEvents.push(...events);
        if (events.length < githubEventsPageSize) break;
        // A full final page means GitHub is still withholding older events.
        if (page === githubEventsMaxPages) degraded = true;
      }

      for (const rawEvent of rawEvents) {
        const eventId = readString(rawEvent, "id");
        const repository = readObject(rawEvent, "repo");
        const repositoryId = readPositiveInteger(repository, "id");
        const repositoryName = readString(repository, "name");
        const eventActor = readObject(rawEvent, "actor");
        const eventActorId = readPositiveInteger(eventActor, "id");
        const eventActorLogin = readString(eventActor, "login");
        const isPublic = readBoolean(rawEvent, "public");
        const payload = readObject(rawEvent, "payload");
        if (
          eventId === null ||
          eventActorId === null ||
          eventActorId !== actor.id ||
          eventActorLogin === null ||
          repositoryId === null ||
          !validRepositoryName(repositoryName) ||
          isPublic === null
        ) {
          continue;
        }

        const visibility = isPublic ? "public" : "private";
        const eventOccurredAt = parseDate(readString(rawEvent, "created_at"));

        const socialRecord = normalizeSocialEvent({
          event: rawEvent,
          actor,
          window,
          observedAt: now,
        });
        if (socialRecord) {
          records.set(socialRecord.deduplicationKey, socialRecord);
          continue;
        }

        const eventType = readString(rawEvent, "type");
        const collaborationEvent = collaborationEventForApiType(eventType);
        if (collaborationEvent) {
          // Ref webhooks have no action timestamp, so there is no exact
          // content identity shared with the Events API. App mode uses its
          // durable webhook observation; best-effort mode uses the event id.
          // Keeping the sources disjoint avoids both double-counting and
          // collapsing a create-delete-recreate cycle.
          if (
            accessMode === "app" &&
            installationIds.length > 0 &&
            (collaborationEvent === "create" || collaborationEvent === "delete")
          ) {
            continue;
          }
          const derivation = deriveCollaborationSubject(
            collaborationEvent,
            payload,
            { id: String(repositoryId), name: repositoryName },
            eventOccurredAt ?? undefined,
            eventId,
          );
          if (!derivation.ok) continue;
          const { subject } = derivation;
          // The feed timestamps events at delivery; the subject carries the
          // content instant shared with webhook copies of the same action.
          if (
            subject.occurredAt < window.startsAt ||
            subject.occurredAt >= window.endsAt ||
            records.has(subject.deduplicationKey)
          ) {
            continue;
          }
          records.set(subject.deduplicationKey, {
            deduplicationKey: subject.deduplicationKey,
            localDate: window.localDate,
            kind: subject.kind,
            actorId: String(eventActorId),
            actorLogin: eventActorLogin,
            repositoryId: String(repositoryId),
            repositoryName,
            evidenceUrl: subject.evidenceUrl,
            visibility,
            source: "github-events",
            subjectId: subject.subjectId,
            subjectNumber: subject.subjectNumber,
            subjectTitle: subject.title,
            occurredAt: subject.occurredAt,
            observedAt: now,
            authoredBeforeDay: false,
            installationId: null,
          });
          continue;
        }

        const occurredAt = eventOccurredAt;
        const pushHead = readString(payload, "head");
        const pushBefore = readString(payload, "before");
        if (
          eventType !== "PushEvent" ||
          !occurredAt ||
          occurredAt < window.startsAt ||
          occurredAt >= window.endsAt ||
          !validSha(pushHead) ||
          !validSha(pushBefore)
        ) {
          continue;
        }
        // Keyed on content, not the events API id, so webhook-ingested copies
        // of the same push collapse into one canonical record.
        const pushKey = pushDeduplicationKey(
          String(repositoryId),
          pushBefore,
          pushHead,
        );
        if (records.has(pushKey)) continue;
        records.set(pushKey, {
          deduplicationKey: pushKey,
          localDate: window.localDate,
          kind: "push",
          actorId: String(eventActorId),
          actorLogin: eventActorLogin,
          repositoryId: String(repositoryId),
          repositoryName,
          evidenceUrl: pushEvidenceUrl(repositoryName, pushBefore, pushHead),
          visibility,
          source: "github-events",
          subjectId: eventId,
          subjectNumber: null,
          subjectTitle: null,
          occurredAt,
          observedAt: now,
          authoredBeforeDay: false,
          installationId: null,
        });

        try {
          const pushedCommits: JsonObject[] = [];
          const announcedCommits = readObjectArray(payload, "commits") ?? [];
          if (!/^0+$/.test(pushBefore)) {
            let totalCommits = Number.POSITIVE_INFINITY;
            for (let page = 1; page <= 10; page += 1) {
              const comparison = objectBody(
                await fetchJson(
                  `https://api.github.com/repos/${repositoryName}/compare/${pushBefore}...${pushHead}?per_page=100&page=${page}`,
                  accessToken,
                  fetchImplementation,
                ),
              );
              const commits = readObjectArray(comparison, "commits");
              const reportedTotal = readNumber(comparison, "total_commits");
              if (
                commits === null ||
                reportedTotal === null ||
                !Number.isSafeInteger(reportedTotal) ||
                reportedTotal < 0
              ) {
                throw new Error("Invalid GitHub comparison response");
              }
              totalCommits = reportedTotal;
              pushedCommits.push(...commits);
              if (
                commits.length < 100 ||
                pushedCommits.length >= totalCommits
              ) {
                break;
              }
            }
            if (pushedCommits.length < totalCommits) degraded = true;
          } else if (announcedCommits.length > 0) {
            for (const candidate of announcedCommits) {
              const candidateSha = readString(candidate, "sha");
              if (!validSha(candidateSha)) continue;
              const commit = objectBody(
                await fetchJson(
                  `https://api.github.com/repos/${repositoryName}/commits/${candidateSha}`,
                  accessToken,
                  fetchImplementation,
                ),
              );
              if (commit !== null) pushedCommits.push(commit);
            }
            if (readNumber(payload, "size") !== pushedCommits.length) {
              degraded = true;
            }
          } else {
            const commit = objectBody(
              await fetchJson(
                `https://api.github.com/repos/${repositoryName}/commits/${pushHead}`,
                accessToken,
                fetchImplementation,
              ),
            );
            if (commit !== null) pushedCommits.push(commit);
            degraded = true;
          }

          for (const commit of pushedCommits) {
            const commitSha = readString(commit, "sha");
            const authoredAt = parseDate(
              readString(
                readObject(readObject(commit, "commit"), "author"),
                "date",
              ),
            );
            if (
              !validSha(commitSha) ||
              !authoredAt ||
              readPositiveInteger(readObject(commit, "author"), "id") !==
                actor.id
            ) {
              continue;
            }
            const commitKey = commitDeduplicationKey(
              String(repositoryId),
              commitSha,
            );
            if (records.has(commitKey)) continue;
            records.set(commitKey, {
              deduplicationKey: commitKey,
              localDate: window.localDate,
              kind: "commit",
              actorId: String(actor.id),
              actorLogin: actor.login,
              repositoryId: String(repositoryId),
              repositoryName,
              evidenceUrl: `https://github.com/${repositoryName}/commit/${commitSha}`,
              visibility,
              source: "github-events",
              subjectId: commitSha,
              subjectNumber: null,
              subjectTitle: null,
              occurredAt: authoredAt,
              observedAt: now,
              authoredBeforeDay: authoredAt < window.startsAt,
              installationId: null,
            });
          }
        } catch (error) {
          reportDiagnostic({ stage: "push-commits", ...describeError(error) });
          degraded = true;
        }
      }
      eventsSucceeded = true;
    } catch (error) {
      reportDiagnostic({ stage: "events", ...describeError(error) });
      degraded = true;
    }
  }

  if (actor) {
    try {
      const query = new URLSearchParams({
        since: window.startsAt.toISOString(),
        per_page: "100",
      });
      const [response, starredResponse] = await Promise.all([
        fetchJson(
          `https://api.github.com/gists?${query}`,
          accessToken,
          fetchImplementation,
        ),
        fetchJson(
          "https://api.github.com/gists/starred?per_page=100",
          accessToken,
          fetchImplementation,
        ),
      ]);
      const gists = listBody(response);
      const starredGists = listBody(starredResponse);
      if (gists === null || starredGists === null)
        throw new Error("Invalid GitHub Gists response");

      for (const gist of gists) {
        const gistIdentifier = readNonEmptyString(gist, "id");
        if (gistIdentifier === null) {
          degraded = true;
          continue;
        }
        try {
          const gistId = encodeURIComponent(gistIdentifier);
          const [commits, comments] = await Promise.all([
            fetchJson(
              `https://api.github.com/gists/${gistId}/commits?per_page=100`,
              accessToken,
              fetchImplementation,
            ),
            fetchJson(
              `https://api.github.com/gists/${gistId}/comments?per_page=100`,
              accessToken,
              fetchImplementation,
            ),
          ]);
          const gistCommits = listBody(commits);
          const gistComments = listBody(comments);
          if (gistCommits === null || gistComments === null) {
            throw new Error("Invalid GitHub Gist metadata response");
          }
          for (const record of normalizeGistActivity({
            gist,
            commits: gistCommits,
            comments: gistComments,
            actor,
            window,
            observedAt: now,
          })) {
            records.set(record.deduplicationKey, record);
          }
        } catch (error) {
          reportDiagnostic({ stage: "gist-metadata", ...describeError(error) });
          degraded = true;
        }
      }
      for (const gist of starredGists) {
        const record = normalizeGistStarActivity({
          gist,
          actor,
          window,
          observedAt: now,
        });
        if (record) records.set(record.deduplicationKey, record);
        else degraded = true;
      }
      gistsSucceeded = true;
    } catch (error) {
      reportDiagnostic({ stage: "gists", ...describeError(error) });
      degraded = true;
    }
  }

  if (accessMode === "app") {
    if (!actor || installationIds.length === 0) {
      degraded = true;
    } else {
      for (const installationId of installationIds) {
        try {
          const repositories: JsonObject[] = [];
          let page = 1;
          let totalCount = Number.POSITIVE_INFINITY;

          while (repositories.length < totalCount) {
            const response = objectBody(
              await fetchJson(
                `https://api.github.com/user/installations/${encodeURIComponent(installationId)}/repositories?per_page=100&page=${page}`,
                accessToken,
                fetchImplementation,
              ),
            );
            const page_ = readObjectArray(response, "repositories");
            const reportedTotal = readNumber(response, "total_count");
            if (page_ === null || reportedTotal === null) {
              throw new Error("Invalid GitHub repositories response");
            }
            totalCount = reportedTotal;
            repositories.push(...page_);
            if (page_.length < 100) break;
            page += 1;
          }

          for (const repository of repositories) {
            const repositoryId = readPositiveInteger(repository, "id");
            const repositoryName = readString(repository, "full_name");
            const isPrivate = readBoolean(repository, "private");
            if (
              repositoryId === null ||
              !validRepositoryName(repositoryName) ||
              isPrivate === null
            ) {
              degraded = true;
              continue;
            }

            try {
              const query = new URLSearchParams({
                author: actor.login,
                since: window.startsAt.toISOString(),
                until: now.toISOString(),
                per_page: "100",
              });
              const rawCommits: JsonObject[] = [];
              for (let page = 1; page <= 10; page += 1) {
                query.set("page", String(page));
                const commitsPage = listBody(
                  await fetchJson(
                    `https://api.github.com/repos/${repositoryName}/commits?${query}`,
                    accessToken,
                    fetchImplementation,
                  ),
                );
                if (commitsPage === null) {
                  throw new Error("Invalid GitHub commits response");
                }
                rawCommits.push(...commitsPage);
                if (commitsPage.length < 100) break;
              }

              for (const commit of rawCommits) {
                const commitSha = readString(commit, "sha");
                const authoredAt = parseDate(
                  readString(
                    readObject(readObject(commit, "commit"), "author"),
                    "date",
                  ),
                );
                if (
                  !validSha(commitSha) ||
                  !authoredAt ||
                  authoredAt < window.startsAt ||
                  authoredAt >= window.endsAt ||
                  readPositiveInteger(readObject(commit, "author"), "id") !==
                    actor.id
                ) {
                  continue;
                }
                const commitKey = commitDeduplicationKey(
                  String(repositoryId),
                  commitSha,
                );
                records.set(commitKey, {
                  deduplicationKey: commitKey,
                  localDate: window.localDate,
                  kind: "commit",
                  actorId: String(actor.id),
                  actorLogin: actor.login,
                  repositoryId: String(repositoryId),
                  repositoryName,
                  evidenceUrl: `https://github.com/${repositoryName}/commit/${commitSha}`,
                  visibility: isPrivate ? "private" : "public",
                  source: "github-repository-commits",
                  subjectId: commitSha,
                  subjectNumber: null,
                  subjectTitle: null,
                  occurredAt: authoredAt,
                  observedAt: now,
                  authoredBeforeDay: false,
                  installationId,
                });
              }
            } catch (error) {
              reportDiagnostic({
                stage: "repository-commits",
                ...describeError(error),
              });
              degraded = true;
            }
          }

          repositoryCommitsSucceeded = true;
        } catch (error) {
          reportDiagnostic({
            stage: "installation-repositories",
            ...describeError(error),
          });
          degraded = true;
        }
      }
    }
  }

  const successfulSource =
    eventsSucceeded || gistsSucceeded || repositoryCommitsSucceeded;
  const status = !successfulSource
    ? "error"
    : degraded
      ? "partial"
      : "complete";
  const sourceFreshness = secondarySourceFreshness({
    refreshedAt: now,
    eventsSucceeded,
    gistsSucceeded,
  });

  await store.finish(
    userId,
    {
      localDate: window.localDate,
      timeZone,
      status,
      refreshedAt: successfulSource ? now : null,
      sourceFreshness,
    },
    [...records.values()],
  );

  return store.read(userId, window.localDate);
}
