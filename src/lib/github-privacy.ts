import { readIdentifier } from "@/lib/github-activity";
import {
  readObject,
  readObjectArray,
  readString,
  type JsonObject,
} from "@/lib/json-payload";

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

/** Collects the ids of a listed set of repositories, skipping unusable entries. */
function readRepositoryIds(payload: JsonObject, key: string): string[] {
  const repositories = readObjectArray(payload, key) ?? [];
  return repositories.flatMap((repository) => {
    const id = readIdentifier(repository, "id");
    return id === null ? [] : [id];
  });
}

export function extractGitHubAccessRestoration(input: {
  eventType: string;
  payload: JsonObject | null;
}): GitHubAccessRestoration | null {
  const payload = input.payload;
  if (payload === null) return null;
  const action = readString(payload, "action");
  const installationId = readIdentifier(
    readObject(payload, "installation"),
    "id",
  );
  if (installationId === null) return null;

  if (input.eventType === "installation" && action === "unsuspend") {
    return {
      kind: "installation-unsuspended",
      installationId,
      repositoryIds: [],
    };
  }
  if (input.eventType === "installation_repositories" && action === "added") {
    const repositoryIds = readRepositoryIds(payload, "repositories_added");
    if (repositoryIds.length === 0) return null;
    return { kind: "repositories-added", installationId, repositoryIds };
  }
  return null;
}

export function extractGitHubAccessChange(input: {
  eventType: string;
  payload: JsonObject | null;
  deliveryId: string;
  occurredAt: Date;
}): GitHubAccessChange | null {
  const payload = input.payload;
  if (payload === null) return null;
  const action = readString(payload, "action");
  const installation = readObject(payload, "installation");
  const account = readObject(installation, "account");

  const kind = accessChangeKind(input.eventType, action);
  if (kind === null) return null;

  return {
    deliveryId: input.deliveryId,
    kind,
    installationId: readIdentifier(installation, "id"),
    // An authorization revocation carries no installation account, so the
    // sender is the only party the event identifies.
    accountId:
      readIdentifier(account, "id") ??
      readIdentifier(readObject(payload, "sender"), "id"),
    repositoryIds: readRepositoryIds(payload, "repositories_removed"),
    occurredAt: input.occurredAt,
  };
}

/** The access loss, if any, that an event and action pair describes. */
function accessChangeKind(
  eventType: string,
  action: string | null,
): GitHubAccessChange["kind"] | null {
  if (eventType === "installation") {
    if (action === "suspend") return "installation-suspended";
    if (action === "deleted") return "installation-removed";
    return null;
  }
  if (eventType === "installation_repositories" && action === "removed") {
    return "repositories-removed";
  }
  if (eventType === "github_app_authorization" && action === "revoked") {
    return "authorization-revoked";
  }
  return null;
}
