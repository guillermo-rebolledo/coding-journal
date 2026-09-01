import { getLocalDate } from "@/lib/time-zone";

const githubApiVersion = "2026-03-10";
const reconciliationCooldownMs = 15 * 60 * 1000;

export type ActivityRecord = {
  deduplicationKey: string;
  localDate: string;
  kind: "push" | "commit";
  actorId: string;
  actorLogin: string;
  repositoryId: string;
  repositoryName: string;
  evidenceUrl: string;
  visibility: "public" | "private";
  source: "github-events" | "github-repository-commits" | "github-webhook";
  subjectId: string;
  occurredAt: Date;
  observedAt: Date;
  authoredBeforeDay: boolean;
  installationId: string | null;
};

export type TodayJournal = {
  localDate: string;
  timeZone: string;
  status: "loading" | "complete" | "partial" | "error";
  refreshedAt: Date | null;
  metrics: { pushes: number; commits: number };
  activities: ActivityRecord[];
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

export type LocalDayWindow = {
  localDate: string;
  startsAt: Date;
  endsAt: Date;
};

function addCalendarDay(localDate: string) {
  const next = new Date(`${localDate}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function firstInstantOnOrAfter(localDate: string, timeZone: string) {
  const approximateMidnight = Date.parse(`${localDate}T00:00:00.000Z`);
  let low = approximateMidnight - 36 * 60 * 60 * 1000;
  let high = approximateMidnight + 36 * 60 * 60 * 1000;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (getLocalDate(new Date(middle), timeZone).iso < localDate) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return new Date(low);
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

export function getLocalDayWindow(now: Date, timeZone: string): LocalDayWindow {
  const localDate = getLocalDate(now, timeZone).iso;

  return {
    localDate,
    startsAt: firstInstantOnOrAfter(localDate, timeZone),
    endsAt: firstInstantOnOrAfter(addCalendarDay(localDate), timeZone),
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

export function parseDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

async function fetchJson(
  url: string,
  accessToken: string,
  fetchImplementation: typeof fetch,
) {
  const response = await fetchImplementation(url, {
    headers: githubHeaders(accessToken),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`GitHub request failed (${response.status})`);
  return response.json() as Promise<unknown>;
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

export async function reconcileGitHubActivity({
  userId,
  timeZone,
  accessMode,
  installationIds,
  accessToken,
  now,
  fetchImplementation = fetch,
  store,
}: {
  userId: string;
  timeZone: string;
  accessMode: "best-effort" | "app";
  installationIds: string[];
  accessToken: string | null;
  now: Date;
  fetchImplementation?: typeof fetch;
  store: ReconciliationStore;
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
    await store.finish(
      userId,
      {
        localDate: window.localDate,
        timeZone,
        status: "error",
        refreshedAt: null,
      },
      [],
    );
    return store.read(userId, window.localDate);
  }

  const records = new Map<string, ActivityRecord>();
  let actor: Required<GitHubActor> | null = null;
  let eventsSucceeded = false;
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
  } catch {
    degraded = true;
  }

  if (actor) {
    try {
      const rawEvents: GitHubEvent[] = [];
      for (let page = 1; page <= 10; page += 1) {
        const response = await fetchJson(
          `https://api.github.com/users/${encodeURIComponent(actor.login)}/events?per_page=100&page=${page}`,
          accessToken,
          fetchImplementation,
        );
        if (!Array.isArray(response)) throw new Error("Invalid GitHub events");
        rawEvents.push(...(response as GitHubEvent[]));
        if (response.length < 100) break;
      }

      for (const rawEvent of rawEvents) {
        const occurredAt = parseDate(rawEvent.created_at);
        const repositoryName = rawEvent.repo?.name;
        const eventActor = rawEvent.actor;
        const payload = rawEvent.payload;
        if (
          rawEvent.type !== "PushEvent" ||
          typeof rawEvent.id !== "string" ||
          typeof eventActor?.id !== "number" ||
          eventActor.id !== actor.id ||
          typeof eventActor.login !== "string" ||
          typeof rawEvent.repo?.id !== "number" ||
          !validRepositoryName(repositoryName) ||
          !occurredAt ||
          occurredAt < window.startsAt ||
          occurredAt >= window.endsAt ||
          !validSha(payload?.head) ||
          !validSha(payload?.before) ||
          typeof rawEvent.public !== "boolean"
        ) {
          continue;
        }

        const visibility = rawEvent.public ? "public" : "private";
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
              occurredAt: authoredAt,
              observedAt: now,
              authoredBeforeDay: authoredAt < window.startsAt,
              installationId: null,
            });
          }
        } catch {
          degraded = true;
        }
      }
      eventsSucceeded = true;
    } catch {
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
                  occurredAt: authoredAt,
                  observedAt: now,
                  authoredBeforeDay: false,
                  installationId,
                });
              }
            } catch {
              degraded = true;
            }
          }

          repositoryCommitsSucceeded = true;
        } catch {
          degraded = true;
        }
      }
    }
  }

  const successfulSource = eventsSucceeded || repositoryCommitsSucceeded;
  const status = !successfulSource
    ? "error"
    : degraded
      ? "partial"
      : "complete";

  await store.finish(
    userId,
    {
      localDate: window.localDate,
      timeZone,
      status,
      refreshedAt: successfulSource ? now : null,
    },
    [...records.values()],
  );

  return store.read(userId, window.localDate);
}
