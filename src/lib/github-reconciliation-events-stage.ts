import type { GitHubReadClient } from "@/lib/github-read-client";

export const eventsDiagnosticStages = ["events", "push-commits"] as const;

export function readEventsStage(client: GitHubReadClient, actorLogin: string) {
  return client.eventPages(actorLogin);
}

export function suppressAppModeRefObservation(input: {
  accessMode: "best-effort" | "app";
  hasInstallation: boolean;
  event: string;
}) {
  return (
    input.accessMode === "app" &&
    input.hasInstallation &&
    (input.event === "create" || input.event === "delete")
  );
}
