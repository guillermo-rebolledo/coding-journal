import type { StoredGitHubInstallation } from "@/lib/github-installation";

export type GitHubConnectionView = Omit<StoredGitHubInstallation, "status"> & {
  status: StoredGitHubInstallation["status"] | "unavailable";
};

export type GitHubInstallationCompleteness =
  | { kind: "installed"; label: "Installed" }
  | { kind: "limited"; label: "Limited activity" }
  | {
      kind: "partial";
      label: "Partial access";
      repositoryCount: number;
      discussionAccess: boolean;
    }
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
      discussionAccess: installation.permissions?.discussions === "read",
    };
  }
  if (installation.permissions?.discussions !== "read") {
    return { kind: "limited", label: "Limited activity" };
  }
  return { kind: "installed", label: "Installed" };
}
