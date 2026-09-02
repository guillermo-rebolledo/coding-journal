import { readIdentifier } from "@/lib/github-activity";
import {
  createGitHubHttpReadClient,
  type GitHubReadClient,
} from "@/lib/github-read-client";
import {
  readObject,
  readPositiveInteger,
  readString,
  readStringRecord,
} from "@/lib/json-payload";

export type GitHubInstallationDetails = {
  installationId: string;
  accountId: string;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
  repositoryCount: number;
  permissions: Record<string, string>;
};

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
  client: GitHubReadClient = createGitHubHttpReadClient(accessToken),
): Promise<GitHubInstallationDetails | null> {
  const installation = await client.installation(installationId);
  if (!installation) return null;
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

  const repositoryCount =
    await client.installationRepositoryCount(installationId);

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
