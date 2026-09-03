import {
  isJsonObject,
  readNumber,
  readObjectArray,
  type JsonObject,
} from "@/lib/json-payload";

export const githubApiVersion = "2026-03-10";
const eventsPageSize = 100;
const eventsMaxPages = 3;
const generalPageSize = 100;
const generalMaxPages = 10;
const rateLimitFallbackMs = 15 * 60 * 1000;

export type GitHubPageResult = {
  items: JsonObject[];
  degraded: boolean;
  diagnosticError?: GitHubRequestError;
};

export type GitHubReadClient = {
  authenticatedUser(): Promise<JsonObject>;
  userInstallations(): Promise<JsonObject[]>;
  eventPages(login: string): Promise<GitHubPageResult>;
  gistListings(since: Date): Promise<{
    owned: JsonObject[];
    starred: JsonObject[];
  }>;
  gistMetadata(id: string): Promise<{
    commits: JsonObject[];
    comments: JsonObject[];
  }>;
  compareRange(
    repositoryName: string,
    before: string,
    head: string,
  ): Promise<GitHubPageResult>;
  commit(repositoryName: string, sha: string): Promise<JsonObject>;
  installationRepositories(installationId: string): Promise<JsonObject[]>;
  installationRepositoryCount(installationId: string): Promise<number>;
  repositoryCommits(input: {
    repositoryName: string;
    actorLogin: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<GitHubPageResult>;
  installation(installationId: string): Promise<JsonObject | null>;
};

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

function githubHeaders(accessToken: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": githubApiVersion,
  };
}

function rateLimitResetAt(response: Response, now: Date) {
  const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
  const retryAfterSeconds = Number(response.headers.get("retry-after"));
  const limited =
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after")));
  if (!limited) return null;
  if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
    return new Date(resetSeconds * 1000);
  }
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return new Date(now.getTime() + retryAfterSeconds * 1000);
  }
  return new Date(now.getTime() + rateLimitFallbackMs);
}

export function createGitHubHttpReadClient(
  accessToken: string,
  request: typeof fetch = fetch,
  clock: () => Date = () => new Date(),
): GitHubReadClient {
  async function get(path: string, allowNotFound = false) {
    const response = await request(`https://api.github.com${path}`, {
      headers: githubHeaders(accessToken),
      cache: "no-store",
    });
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      throw new GitHubRequestError(
        response.status,
        rateLimitResetAt(response, clock()),
      );
    }
    const body: unknown = await response.json();
    return body;
  }

  async function object(path: string, allowNotFound = false) {
    const body = await get(path, allowNotFound);
    if (body === null) return null;
    if (!isJsonObject(body)) throw new Error("Invalid GitHub object response");
    return body;
  }

  async function list(path: string) {
    const body = await get(path);
    if (!Array.isArray(body)) throw new Error("Invalid GitHub list response");
    return body.filter((entry): entry is JsonObject => isJsonObject(entry));
  }

  return {
    async authenticatedUser() {
      const actor = await object("/user");
      if (!actor) throw new Error("Invalid GitHub actor response");
      return actor;
    },

    async userInstallations() {
      const items: JsonObject[] = [];
      let total = Number.POSITIVE_INFINITY;
      for (let page = 1; items.length < total; page += 1) {
        const response = await object(
          `/user/installations?per_page=${generalPageSize}&page=${page}`,
        );
        const installations = readObjectArray(response, "installations");
        const reportedTotal = readNumber(response, "total_count");
        if (
          installations === null ||
          reportedTotal === null ||
          !Number.isSafeInteger(reportedTotal) ||
          reportedTotal < 0
        ) {
          throw new Error("Invalid GitHub installations response");
        }
        total = reportedTotal;
        items.push(...installations);
        if (installations.length < generalPageSize) break;
      }
      return items;
    },

    async eventPages(login) {
      const items: JsonObject[] = [];
      for (let page = 1; page <= eventsMaxPages; page += 1) {
        try {
          const next = await list(
            `/users/${encodeURIComponent(login)}/events?per_page=${eventsPageSize}&page=${page}`,
          );
          items.push(...next);
          if (next.length < eventsPageSize) return { items, degraded: false };
        } catch (error) {
          if (error instanceof GitHubRequestError && error.status === 422) {
            return { items, degraded: true, diagnosticError: error };
          }
          throw error;
        }
      }
      return { items, degraded: true };
    },

    async gistListings(since) {
      const query = new URLSearchParams({
        since: since.toISOString(),
        per_page: String(generalPageSize),
      });
      const [owned, starred] = await Promise.all([
        list(`/gists?${query}`),
        list(`/gists/starred?per_page=${generalPageSize}`),
      ]);
      return { owned, starred };
    },

    async gistMetadata(id) {
      const encoded = encodeURIComponent(id);
      const [commits, comments] = await Promise.all([
        list(`/gists/${encoded}/commits?per_page=${generalPageSize}`),
        list(`/gists/${encoded}/comments?per_page=${generalPageSize}`),
      ]);
      return { commits, comments };
    },

    async compareRange(repositoryName, before, head) {
      const items: JsonObject[] = [];
      let total = Number.POSITIVE_INFINITY;
      for (let page = 1; page <= generalMaxPages; page += 1) {
        const comparison = await object(
          `/repos/${repositoryName}/compare/${before}...${head}?per_page=${generalPageSize}&page=${page}`,
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
        total = reportedTotal;
        items.push(...commits);
        if (commits.length < generalPageSize || items.length >= total) break;
      }
      return { items, degraded: items.length < total };
    },

    async commit(repositoryName, sha) {
      const result = await object(`/repos/${repositoryName}/commits/${sha}`);
      if (!result) throw new Error("Invalid GitHub commit response");
      return result;
    },

    async installationRepositories(installationId) {
      const items: JsonObject[] = [];
      let total = Number.POSITIVE_INFINITY;
      for (let page = 1; items.length < total; page += 1) {
        const response = await object(
          `/user/installations/${encodeURIComponent(installationId)}/repositories?per_page=${generalPageSize}&page=${page}`,
        );
        const repositories = readObjectArray(response, "repositories");
        const reportedTotal = readNumber(response, "total_count");
        if (repositories === null || reportedTotal === null) {
          throw new Error("Invalid GitHub repositories response");
        }
        total = reportedTotal;
        items.push(...repositories);
        if (repositories.length < generalPageSize) break;
      }
      return items;
    },

    async installationRepositoryCount(installationId) {
      const response = await object(
        `/user/installations/${encodeURIComponent(installationId)}/repositories?per_page=1`,
      );
      const count = readNumber(response, "total_count");
      if (count === null || !Number.isSafeInteger(count) || count < 0) {
        throw new Error("Invalid GitHub repository count response");
      }
      return count;
    },

    async repositoryCommits({ repositoryName, actorLogin, startsAt, endsAt }) {
      const query = new URLSearchParams({
        author: actorLogin,
        since: startsAt.toISOString(),
        until: endsAt.toISOString(),
        per_page: String(generalPageSize),
      });
      const items: JsonObject[] = [];
      for (let page = 1; page <= generalMaxPages; page += 1) {
        query.set("page", String(page));
        const next = await list(`/repos/${repositoryName}/commits?${query}`);
        items.push(...next);
        if (next.length < generalPageSize) return { items, degraded: false };
      }
      return { items, degraded: true };
    },

    installation: (installationId) =>
      object(`/user/installations/${encodeURIComponent(installationId)}`, true),
  };
}

export type InMemoryGitHubState = {
  actor: JsonObject;
  userInstallations?: JsonObject[];
  events?: JsonObject[];
  eventsDegraded?: boolean;
  gists?: JsonObject[];
  starredGists?: JsonObject[];
  gistMetadata?: Record<
    string,
    { commits: JsonObject[]; comments: JsonObject[] }
  >;
  comparisons?: Record<string, GitHubPageResult>;
  commits?: Record<string, JsonObject>;
  installations?: Record<string, JsonObject>;
  installationRepositories?: Record<string, JsonObject[]>;
  repositoryCommits?: Record<string, GitHubPageResult>;
};

/** A state-shaped test adapter: tests describe GitHub, never request URLs. */
export function createInMemoryGitHubReadClient(
  state: InMemoryGitHubState,
): GitHubReadClient {
  return {
    authenticatedUser: async () => state.actor,
    userInstallations: async () => state.userInstallations ?? [],
    eventPages: async () => ({
      items: state.events ?? [],
      degraded: state.eventsDegraded ?? false,
    }),
    gistListings: async () => ({
      owned: state.gists ?? [],
      starred: state.starredGists ?? [],
    }),
    gistMetadata: async (id) =>
      state.gistMetadata?.[id] ?? { commits: [], comments: [] },
    compareRange: async (repositoryName, before, head) =>
      state.comparisons?.[`${repositoryName}:${before}:${head}`] ?? {
        items: [],
        degraded: false,
      },
    commit: async (repositoryName, sha) => {
      const result = state.commits?.[`${repositoryName}:${sha}`];
      if (!result) throw new Error("Unknown in-memory GitHub commit");
      return result;
    },
    installationRepositories: async (id) =>
      state.installationRepositories?.[id] ?? [],
    installationRepositoryCount: async (id) =>
      state.installationRepositories?.[id]?.length ?? 0,
    repositoryCommits: async ({ repositoryName }) =>
      state.repositoryCommits?.[repositoryName] ?? {
        items: [],
        degraded: false,
      },
    installation: async (id) => state.installations?.[id] ?? null,
  };
}
