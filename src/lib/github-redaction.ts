import type { ActivityRecord } from "@/lib/github-activity";
import type { GitHubAccessChange } from "@/lib/github-privacy";
import {
  runPrivacyOperation,
  type PrivacyLedger,
  type PrivacyOperationCounts,
} from "@/lib/privacy-ledger";

export type GitHubRedactionPolicy = {
  disconnectInstallation: boolean;
  revokeAuthorization: boolean;
  activityIsInaccessible(activity: ActivityRecord): boolean;
};

export function githubRedactionPolicy(
  change: GitHubAccessChange,
): GitHubRedactionPolicy {
  return {
    disconnectInstallation: change.kind !== "repositories-removed",
    revokeAuthorization: change.kind === "authorization-revoked",
    activityIsInaccessible: (activity) =>
      activity.visibility === "private" &&
      (change.kind === "repositories-removed"
        ? change.repositoryIds.includes(activity.repositoryId)
        : change.kind === "authorization-revoked" ||
          activity.installationId === change.installationId ||
          activity.installationId === null),
  };
}

/** Pure orchestration over a ledger and an access-block work adapter. */
export async function runGitHubRedaction<T extends PrivacyOperationCounts>(
  change: GitHubAccessChange,
  ledger: PrivacyLedger,
  applyAccessBlocksAndRedact: (policy: GitHubRedactionPolicy) => Promise<T>,
  now = new Date(),
) {
  return runPrivacyOperation(
    ledger,
    {
      key: `github-access-change:${change.deliveryId}`,
      kind: change.kind,
      now,
    },
    () => applyAccessBlocksAndRedact(githubRedactionPolicy(change)),
  );
}
