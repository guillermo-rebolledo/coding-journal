import { readIdentifier } from "@/lib/github-activity";
import {
  isJsonObject,
  readNumber,
  readObject,
  readPositiveInteger,
  readString,
  readStringRecord,
} from "@/lib/json-payload";

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

  const installationBody: unknown = await installationResponse.json();
  const installation = isJsonObject(installationBody) ? installationBody : null;
  const account = readObject(installation, "account");
  const accountId = readPositiveInteger(account, "id");
  const accountLogin = readString(account, "login");
  const accountType = readString(account, "type");
  const repositorySelection = readString(installation, "repository_selection");
  const permissions = readStringRecord(installation, "permissions") ?? {};

  if (
    readIdentifier(installation, "id") !== installationId ||
    accountId === null ||
    accountLogin === null ||
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

  const repositoriesBody: unknown = await repositoriesResponse.json();
  const repositories = isJsonObject(repositoriesBody) ? repositoriesBody : null;
  const repositoryCount = readNumber(repositories, "total_count");
  if (
    repositoryCount === null ||
    !Number.isSafeInteger(repositoryCount) ||
    repositoryCount < 0
  ) {
    return null;
  }

  return {
    installationId,
    accountId: String(accountId),
    accountLogin,
    accountType,
    repositorySelection,
    repositoryCount,
    permissions,
  };
}
