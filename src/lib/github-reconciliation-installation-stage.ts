import type { GitHubReadClient } from "@/lib/github-read-client";

export const installationDiagnosticStages = [
  "installation-repositories",
  "repository-commits",
] as const;

export function readInstallationStage(
  client: GitHubReadClient,
  installationId: string,
) {
  return client.installationRepositories(installationId);
}
