export type GitHubAccessChange = {
  deliveryId: string;
  kind:
    | "installation-suspended"
    | "installation-removed"
    | "repositories-removed"
    | "authorization-revoked";
  installationId: string | null;
  accountId: string | null;
  repositoryIds: string[];
  occurredAt: Date;
};

export type GitHubAccessRestoration = {
  kind: "installation-unsuspended" | "repositories-added";
  installationId: string;
  repositoryIds: string[];
};

function identifier(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

export function extractGitHubAccessRestoration(input: {
  eventType: string;
  payload: unknown;
}): GitHubAccessRestoration | null {
  if (!input.payload || typeof input.payload !== "object") return null;
  const payload = input.payload as Record<string, unknown>;
  const action = payload.action;
  const installation =
    payload.installation && typeof payload.installation === "object"
      ? (payload.installation as Record<string, unknown>)
      : null;
  const installationId = identifier(installation?.id);
  if (!installationId) return null;
  if (input.eventType === "installation" && action === "unsuspend") {
    return {
      kind: "installation-unsuspended",
      installationId,
      repositoryIds: [],
    };
  }
  if (input.eventType === "installation_repositories" && action === "added") {
    const repositories = Array.isArray(payload.repositories_added)
      ? payload.repositories_added
      : [];
    const repositoryIds = repositories.flatMap((repository) => {
      if (!repository || typeof repository !== "object") return [];
      const id = identifier((repository as Record<string, unknown>).id);
      return id ? [id] : [];
    });
    if (repositoryIds.length === 0) return null;
    return {
      kind: "repositories-added",
      installationId,
      repositoryIds,
    };
  }
  return null;
}

export function extractGitHubAccessChange(input: {
  eventType: string;
  payload: unknown;
  deliveryId: string;
  occurredAt: Date;
}): GitHubAccessChange | null {
  if (!input.payload || typeof input.payload !== "object") return null;
  const payload = input.payload as Record<string, unknown>;
  const action = payload.action;
  const installation =
    payload.installation && typeof payload.installation === "object"
      ? (payload.installation as Record<string, unknown>)
      : null;
  const account =
    installation?.account && typeof installation.account === "object"
      ? (installation.account as Record<string, unknown>)
      : null;

  let kind: GitHubAccessChange["kind"] | null = null;
  if (input.eventType === "installation" && action === "suspend") {
    kind = "installation-suspended";
  } else if (input.eventType === "installation" && action === "deleted") {
    kind = "installation-removed";
  } else if (
    input.eventType === "installation_repositories" &&
    action === "removed"
  ) {
    kind = "repositories-removed";
  } else if (
    input.eventType === "github_app_authorization" &&
    action === "revoked"
  ) {
    kind = "authorization-revoked";
  }
  if (!kind) return null;

  const repositories = Array.isArray(payload.repositories_removed)
    ? payload.repositories_removed
    : [];
  const repositoryIds = repositories.flatMap((repository) => {
    if (!repository || typeof repository !== "object") return [];
    const id = identifier((repository as Record<string, unknown>).id);
    return id ? [id] : [];
  });
  const sender =
    payload.sender && typeof payload.sender === "object"
      ? (payload.sender as Record<string, unknown>)
      : null;

  return {
    deliveryId: input.deliveryId,
    kind,
    installationId: identifier(installation?.id),
    accountId: identifier(account?.id) ?? identifier(sender?.id),
    repositoryIds,
    occurredAt: input.occurredAt,
  };
}
