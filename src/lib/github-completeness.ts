import type { StoredGitHubInstallation } from "@/lib/github-installation";

export type GitHubConnectionView = Omit<StoredGitHubInstallation, "status"> & {
  status: StoredGitHubInstallation["status"] | "unavailable";
};

export type GitHubInstallationCompleteness =
  | { kind: "installed"; label: "Installed" }
  | { kind: "partial"; label: "Partial access"; repositoryCount: number }
  | { kind: "pending"; label: "Pending approval" }
  | { kind: "disconnected"; label: "Disconnected" }
  | { kind: "unavailable"; label: "Temporarily unavailable" };

export function getGitHubInstallationCompleteness(
  installation: GitHubConnectionView,
): GitHubInstallationCompleteness {
  if (installation.status === "pending") {
    return { kind: "pending", label: "Pending approval" };
  }
  if (installation.status === "disconnected") {
    return { kind: "disconnected", label: "Disconnected" };
  }
  if (installation.status === "unavailable") {
    return { kind: "unavailable", label: "Temporarily unavailable" };
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
