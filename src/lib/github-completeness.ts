import type { StoredGitHubInstallation } from "@/lib/github-installation";

export type GitHubConnectionView = Omit<StoredGitHubInstallation, "status"> & {
  status: StoredGitHubInstallation["status"] | "unavailable";
};

export type GitHubInstallationCompleteness =
  | { kind: "installed"; label: "Installed" }
  | {
      kind: "limited";
      label: "Limited activity";
      missingPermissions: MissingActivityPermission[];
    }
  | {
      kind: "partial";
      label: "Partial access";
      repositoryCount: number;
      missingPermissions: MissingActivityPermission[];
    }
  | { kind: "pending"; label: "Pending approval" }
  | { kind: "disconnected"; label: "Disconnected" }
  | { kind: "unavailable"; label: "Temporarily unavailable" };

export type MissingActivityPermission =
  | "contents"
  | "discussions"
  | "actions"
  | "deployments"
  | "packages";

function getMissingActivityPermissions(
  permissions: Record<string, string> | null,
): MissingActivityPermission[] {
  return [
    ...(permissions?.contents === "read" ? [] : (["contents"] as const)),
    ...(permissions?.discussions === "read" ? [] : (["discussions"] as const)),
    ...(permissions?.actions === "read" ? [] : (["actions"] as const)),
    ...(permissions?.deployments === "read" ? [] : (["deployments"] as const)),
    ...(permissions?.packages === "read" ? [] : (["packages"] as const)),
  ];
}

export function describeMissingActivity(
  missingPermissions: MissingActivityPermission[],
) {
  return [
    ...(missingPermissions.includes("contents")
      ? ["Pushes, refs, and releases unavailable"]
      : []),
    ...(missingPermissions.includes("discussions")
      ? ["Discussions unavailable"]
      : []),
    ...(missingPermissions.includes("actions")
      ? ["Workflow runs unavailable"]
      : []),
    ...(missingPermissions.includes("deployments")
      ? ["Deployments unavailable"]
      : []),
    ...(missingPermissions.includes("packages")
      ? ["Packages unavailable"]
      : []),
  ].join(" · ");
}

export function getGitHubJournalCompleteness(
  installations: GitHubConnectionView[],
) {
  const active = installations.filter(
    (installation) => installation.status === "active",
  );
  if (active.length === 0) return null;

  const selectedRepositoryCount = active.reduce(
    (count, installation) =>
      count +
      (installation.repositorySelection === "selected"
        ? (installation.repositoryCount ?? 0)
        : 0),
    0,
  );
  const hasSelectedAccess = active.some(
    (installation) => installation.repositorySelection === "selected",
  );
  const missingPermissions = [
    ...new Set(
      active.flatMap((installation) =>
        getMissingActivityPermissions(installation.permissions),
      ),
    ),
  ];
  const coverage = hasSelectedAccess
    ? `${selectedRepositoryCount} selected ${selectedRepositoryCount === 1 ? "repository" : "repositories"}`
    : "All granted repositories";
  const unavailable = describeMissingActivity(missingPermissions);

  return {
    label: hasSelectedAccess
      ? "Partial access"
      : missingPermissions.length > 0
        ? "Limited activity"
        : "Installed",
    detail: unavailable ? `${coverage} · ${unavailable}` : coverage,
  };
}

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
  const missingPermissions = getMissingActivityPermissions(
    installation.permissions,
  );
  if (installation.repositorySelection === "selected") {
    return {
      kind: "partial",
      label: "Partial access",
      repositoryCount: installation.repositoryCount ?? 0,
      missingPermissions,
    };
  }
  if (missingPermissions.length > 0) {
    return {
      kind: "limited",
      label: "Limited activity",
      missingPermissions,
    };
  }
  return { kind: "installed", label: "Installed" };
}
