import type { GitHubReadClient } from "@/lib/github-read-client";

export const actorDiagnosticStages = ["actor"] as const;

export function readActorStage(client: GitHubReadClient) {
  return client.authenticatedUser();
}
