import type { GitHubReadClient } from "@/lib/github-read-client";

export const gistsDiagnosticStages = ["gists", "gist-metadata"] as const;

export function readGistsStage(client: GitHubReadClient, startsAt: Date) {
  return client.gistListings(startsAt);
}
