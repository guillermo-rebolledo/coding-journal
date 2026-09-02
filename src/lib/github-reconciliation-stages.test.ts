import { describe, expect, it } from "vitest";

import { createInMemoryGitHubReadClient } from "@/lib/github-read-client";
import { readActorStage } from "@/lib/github-reconciliation-actor-stage";
import { readEventsStage } from "@/lib/github-reconciliation-events-stage";
import { readGistsStage } from "@/lib/github-reconciliation-gists-stage";
import { readInstallationStage } from "@/lib/github-reconciliation-installation-stage";

describe("GitHub reconciliation stages", () => {
  it("reads actor, events, gists, and installation commits from state", async () => {
    const client = createInMemoryGitHubReadClient({
      actor: { id: 7, login: "ada" },
      events: [{ id: "event-1" }],
      gists: [{ id: "gist-1" }],
      installationRepositories: { "99": [{ id: 42, full_name: "acme/api" }] },
      repositoryCommits: {
        "acme/api": { items: [{ sha: "2222222" }], degraded: false },
      },
    });

    await expect(readActorStage(client)).resolves.toMatchObject({
      login: "ada",
    });
    await expect(readEventsStage(client, "ada")).resolves.toMatchObject({
      items: [{ id: "event-1" }],
    });
    await expect(readGistsStage(client, new Date(0))).resolves.toMatchObject({
      owned: [{ id: "gist-1" }],
    });
    await expect(readInstallationStage(client, "99")).resolves.toEqual([
      { id: 42, full_name: "acme/api" },
    ]);
    await expect(
      client.repositoryCommits({
        repositoryName: "acme/api",
        actorLogin: "ada",
        startsAt: new Date(0),
        endsAt: new Date(1),
      }),
    ).resolves.toMatchObject({ items: [{ sha: "2222222" }] });
  });
});
