const githubApiVersion = "2026-03-10";

export type GitHubInstallationDetails = {
  installationId: string;
  accountId: string;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
  repositoryCount: number;
  permissions: Record<string, string>;
};

type GitHubInstallationResponse = {
  id?: number;
  account?: { id?: number; login?: string; type?: string } | null;
  repository_selection?: string;
  permissions?: Record<string, string>;
};

type GitHubRepositoriesResponse = { total_count?: number };

function githubHeaders(accessToken: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": githubApiVersion,
  };
}

function isReadOnlyPermissionSet(permissions: Record<string, string>) {
  const forbiddenNames =
    /(administration|billing|code_scanning|dependabot|secret|security|vulnerability)/i;
  const entries = Object.entries(permissions);
  return (
    entries.length > 0 &&
    entries.every(
      ([name, access]) => !forbiddenNames.test(name) && access === "read",
    )
  );
}

export async function getUserGitHubInstallation(
  accessToken: string,
  installationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<GitHubInstallationDetails | null> {
  const installationResponse = await fetchImplementation(
    `https://api.github.com/user/installations/${installationId}`,
    { headers: githubHeaders(accessToken) },
  );

  if (installationResponse.status === 404) return null;
  if (!installationResponse.ok) {
    throw new Error("GitHub installation validation failed.");
  }

  const installation =
    (await installationResponse.json()) as GitHubInstallationResponse;
  const accountType = installation.account?.type;
  const repositorySelection = installation.repository_selection;
  const permissions = installation.permissions ?? {};

  if (
    String(installation.id) !== installationId ||
    typeof installation.account?.id !== "number" ||
    typeof installation.account.login !== "string" ||
    (accountType !== "User" && accountType !== "Organization") ||
    (repositorySelection !== "all" && repositorySelection !== "selected") ||
    !isReadOnlyPermissionSet(permissions)
  ) {
    return null;
  }

  const repositoriesResponse = await fetchImplementation(
    `https://api.github.com/user/installations/${installationId}/repositories?per_page=1`,
    { headers: githubHeaders(accessToken) },
  );

  if (!repositoriesResponse.ok) {
    throw new Error("GitHub repository selection validation failed.");
  }

  const repositories =
    (await repositoriesResponse.json()) as GitHubRepositoriesResponse;
  if (
    typeof repositories.total_count !== "number" ||
    !Number.isSafeInteger(repositories.total_count) ||
    repositories.total_count < 0
  ) {
    return null;
  }

  return {
    installationId,
    accountId: String(installation.account.id),
    accountLogin: installation.account.login,
    accountType,
    repositorySelection,
    repositoryCount: repositories.total_count,
    permissions,
  };
}
