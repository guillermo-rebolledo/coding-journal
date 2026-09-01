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
import { getLocalDayWindow, parseDate } from "@/lib/time-zone";

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

export function describeError(
  error: unknown,
): Pick<
  ReconciliationDiagnostic,
  "errorName" | "errorMessage" | "rateLimitResetAt"
> {
  return error instanceof GitHubRequestError
    ? {
        errorName: error.name,
        errorMessage: error.message,
        ...(error.rateLimitResetAt
          ? { rateLimitResetAt: error.rateLimitResetAt }
          : {}),
      }
    : error instanceof Error
      ? { errorName: error.name, errorMessage: error.message }
      : {
          errorName: "UnknownError",
          errorMessage: "A non-error value was thrown",
        };
}

type GitHubActor = { id?: number; login?: string };
type GitHubEvent = {
  id?: string;
  type?: string;
  actor?: GitHubActor;
  repo?: { id?: number; name?: string };
  public?: boolean;
  created_at?: string;
  payload?: {
    push_id?: number;
    before?: string;
    head?: string;
    ref?: string;
    size?: number;
    commits?: Array<{ sha?: string }>;
    action?: string;
    forkee?: { id?: number; full_name?: string; html_url?: string };
  };
};
type GitHubCommit = {
  sha?: string;
  author?: GitHubActor | null;
  commit?: { author?: { date?: string | null } | null };
};
type GitHubCompare = { total_commits?: number; commits?: GitHubCommit[] };
type GitHubRepository = {
  id?: number;
  full_name?: string;
  private?: boolean;
};
type GitHubRepositoriesResponse = {
  total_count?: number;
  repositories?: GitHubRepository[];
};

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
) {
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
  return response.json() as Promise<unknown>;
}

export async function reconcileGitHubActivity({
  userId,
  timeZone,
  accessMode,
  installationIds,
  accessToken,
  now,
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
  fetchImplementation?: typeof fetch;
  store: ReconciliationStore;
  reportDiagnostic?: DiagnosticReporter;
}): Promise<TodayJournal> {
  const window = getLocalDayWindow(now, timeZone);
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
  let actor: Required<GitHubActor> | null = null;
  let eventsSucceeded = false;
  let gistsSucceeded = false;
  let repositoryCommitsSucceeded = false;
  let degraded = false;

  try {
    const rawActor = (await fetchJson(
      "https://api.github.com/user",
      accessToken,
      fetchImplementation,
    )) as GitHubActor;
    if (typeof rawActor.id !== "number" || typeof rawActor.login !== "string") {
      throw new Error("GitHub actor response was invalid");
    }
    actor = { id: rawActor.id, login: rawActor.login };
  } catch (error) {
    reportDiagnostic({ stage: "actor", ...describeError(error) });
    degraded = true;
  }

  if (actor) {
    try {
      const rawEvents: GitHubEvent[] = [];
      for (let page = 1; page <= githubEventsMaxPages; page += 1) {
        let response: unknown;
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
        if (!Array.isArray(response)) throw new Error("Invalid GitHub events");
        rawEvents.push(...(response as GitHubEvent[]));
        if (response.length < githubEventsPageSize) break;
        // A full final page means GitHub is still withholding older events.
        if (page === githubEventsMaxPages) degraded = true;
      }

      for (const rawEvent of rawEvents) {
        const repositoryName = rawEvent.repo?.name;
        const eventActor = rawEvent.actor;
        const payload = rawEvent.payload;
        if (
          typeof rawEvent.id !== "string" ||
          typeof eventActor?.id !== "number" ||
          eventActor.id !== actor.id ||
          typeof eventActor.login !== "string" ||
          typeof rawEvent.repo?.id !== "number" ||
          !validRepositoryName(repositoryName) ||
          typeof rawEvent.public !== "boolean"
        ) {
          continue;
        }

        const visibility = rawEvent.public ? "public" : "private";
        const eventOccurredAt = parseDate(rawEvent.created_at);

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

        const collaborationEvent = collaborationEventForApiType(rawEvent.type);
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
            { id: String(rawEvent.repo.id), name: repositoryName },
            eventOccurredAt ?? undefined,
            rawEvent.id,
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
            actorId: String(eventActor.id),
            actorLogin: eventActor.login,
            repositoryId: String(rawEvent.repo.id),
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
        if (
          rawEvent.type !== "PushEvent" ||
          !occurredAt ||
          occurredAt < window.startsAt ||
          occurredAt >= window.endsAt ||
          !validSha(payload?.head) ||
          !validSha(payload?.before)
        ) {
          continue;
        }
        // Keyed on content, not the events API id, so webhook-ingested copies
        // of the same push collapse into one canonical record.
        const pushKey = pushDeduplicationKey(
          String(rawEvent.repo.id),
          payload.before,
          payload.head,
        );
        if (records.has(pushKey)) continue;
        records.set(pushKey, {
          deduplicationKey: pushKey,
          localDate: window.localDate,
          kind: "push",
          actorId: String(eventActor.id),
          actorLogin: eventActor.login,
          repositoryId: String(rawEvent.repo.id),
          repositoryName,
          evidenceUrl: pushEvidenceUrl(
            repositoryName,
            payload.before,
            payload.head,
          ),
          visibility,
          source: "github-events",
          subjectId: rawEvent.id,
          subjectNumber: null,
          subjectTitle: null,
          occurredAt,
          observedAt: now,
          authoredBeforeDay: false,
          installationId: null,
        });

        try {
          const pushedCommits: GitHubCommit[] = [];
          if (!/^0+$/.test(payload.before)) {
            let totalCommits = Number.POSITIVE_INFINITY;
            for (let page = 1; page <= 10; page += 1) {
              const comparison = (await fetchJson(
                `https://api.github.com/repos/${repositoryName}/compare/${payload.before}...${payload.head}?per_page=100&page=${page}`,
                accessToken,
                fetchImplementation,
              )) as GitHubCompare;
              if (
                !Array.isArray(comparison.commits) ||
                !Number.isSafeInteger(comparison.total_commits) ||
                comparison.total_commits! < 0
              ) {
                throw new Error("Invalid GitHub comparison response");
              }
              totalCommits = comparison.total_commits!;
              pushedCommits.push(...comparison.commits);
              if (
                comparison.commits.length < 100 ||
                pushedCommits.length >= totalCommits
              ) {
                break;
              }
            }
            if (pushedCommits.length < totalCommits) degraded = true;
          } else if ((payload.commits?.length ?? 0) > 0) {
            for (const candidate of payload.commits ?? []) {
              if (!validSha(candidate.sha)) continue;
              pushedCommits.push(
                (await fetchJson(
                  `https://api.github.com/repos/${repositoryName}/commits/${candidate.sha}`,
                  accessToken,
                  fetchImplementation,
                )) as GitHubCommit,
              );
            }
            if (
              typeof payload.size !== "number" ||
              payload.size !== pushedCommits.length
            ) {
              degraded = true;
            }
          } else {
            pushedCommits.push(
              (await fetchJson(
                `https://api.github.com/repos/${repositoryName}/commits/${payload.head}`,
                accessToken,
                fetchImplementation,
              )) as GitHubCommit,
            );
            degraded = true;
          }

          for (const commit of pushedCommits) {
            const authoredAt = parseDate(commit.commit?.author?.date);
            if (
              !validSha(commit.sha) ||
              !authoredAt ||
              commit.author?.id !== actor.id
            ) {
              continue;
            }
            const commitKey = commitDeduplicationKey(
              String(rawEvent.repo.id),
              commit.sha,
            );
            if (records.has(commitKey)) continue;
            records.set(commitKey, {
              deduplicationKey: commitKey,
              localDate: window.localDate,
              kind: "commit",
              actorId: String(actor.id),
              actorLogin: actor.login,
              repositoryId: String(rawEvent.repo.id),
              repositoryName,
              evidenceUrl: `https://github.com/${repositoryName}/commit/${commit.sha}`,
              visibility,
              source: "github-events",
              subjectId: commit.sha,
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
      if (!Array.isArray(response) || !Array.isArray(starredResponse))
        throw new Error("Invalid GitHub Gists response");

      for (const gist of response as Array<{ id?: unknown }>) {
        if (typeof gist.id !== "string" || !gist.id.trim()) {
          degraded = true;
          continue;
        }
        try {
          const gistId = encodeURIComponent(gist.id);
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
          if (!Array.isArray(commits) || !Array.isArray(comments)) {
            throw new Error("Invalid GitHub Gist metadata response");
          }
          for (const record of normalizeGistActivity({
            gist,
            commits,
            comments,
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
      for (const gist of starredResponse) {
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
          const repositories: GitHubRepository[] = [];
          let page = 1;
          let totalCount = Number.POSITIVE_INFINITY;

          while (repositories.length < totalCount) {
            const response = (await fetchJson(
              `https://api.github.com/user/installations/${encodeURIComponent(installationId)}/repositories?per_page=100&page=${page}`,
              accessToken,
              fetchImplementation,
            )) as GitHubRepositoriesResponse;
            if (
              !Array.isArray(response.repositories) ||
              typeof response.total_count !== "number"
            ) {
              throw new Error("Invalid GitHub repositories response");
            }
            totalCount = response.total_count;
            repositories.push(...response.repositories);
            if (response.repositories.length < 100) break;
            page += 1;
          }

          for (const repository of repositories) {
            if (
              typeof repository.id !== "number" ||
              !validRepositoryName(repository.full_name) ||
              typeof repository.private !== "boolean"
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
              const rawCommits: GitHubCommit[] = [];
              for (let page = 1; page <= 10; page += 1) {
                query.set("page", String(page));
                const response = await fetchJson(
                  `https://api.github.com/repos/${repository.full_name}/commits?${query}`,
                  accessToken,
                  fetchImplementation,
                );
                if (!Array.isArray(response)) {
                  throw new Error("Invalid GitHub commits response");
                }
                rawCommits.push(...(response as GitHubCommit[]));
                if (response.length < 100) break;
              }

              for (const commit of rawCommits) {
                const authoredAt = parseDate(commit.commit?.author?.date);
                if (
                  !validSha(commit.sha) ||
                  !authoredAt ||
                  authoredAt < window.startsAt ||
                  authoredAt >= window.endsAt ||
                  commit.author?.id !== actor.id
                ) {
                  continue;
                }
                const commitKey = commitDeduplicationKey(
                  String(repository.id),
                  commit.sha,
                );
                records.set(commitKey, {
                  deduplicationKey: commitKey,
                  localDate: window.localDate,
                  kind: "commit",
                  actorId: String(actor.id),
                  actorLogin: actor.login,
                  repositoryId: String(repository.id),
                  repositoryName: repository.full_name,
                  evidenceUrl: `https://github.com/${repository.full_name}/commit/${commit.sha}`,
                  visibility: repository.private ? "private" : "public",
                  source: "github-repository-commits",
                  subjectId: commit.sha,
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
