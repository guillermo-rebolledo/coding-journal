import type { StoredGitHubInstallation } from "@/lib/github-installation";

export type GitHubInstallationCompleteness =
  | { kind: "installed"; label: "Installed" }
  | { kind: "partial"; label: "Partial access"; repositoryCount: number }
  | { kind: "pending"; label: "Pending approval" }
  | { kind: "disconnected"; label: "Disconnected" };

export function getGitHubInstallationCompleteness(
  installation: StoredGitHubInstallation,
): GitHubInstallationCompleteness {
  if (installation.status === "pending") {
    return { kind: "pending", label: "Pending approval" };
  }
  if (installation.status === "disconnected") {
    return { kind: "disconnected", label: "Disconnected" };
  }
  if (installation.repositorySelection === "selected") {
    return {
      kind: "partial",
      label: "Partial access",
      repositoryCount: installation.repositoryCount ?? 0,
    };
  }
  return { kind: "installed", label: "Installed" };
}
