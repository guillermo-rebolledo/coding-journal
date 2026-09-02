import { githubWebhookRepository } from "@/lib/github-webhook-repository";
import { queuePublisher } from "@/lib/queue";

import { createGitHubWebhookRoute } from "./handler";

export const POST = createGitHubWebhookRoute({
  store: githubWebhookRepository,
  queue: queuePublisher,
});
