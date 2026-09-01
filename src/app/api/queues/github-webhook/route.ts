import { handleCallback } from "@vercel/queue";

import { processPushDeliveryMessage } from "@/lib/github-webhook-processing";
import { githubWebhookRepository } from "@/lib/github-webhook-repository";

export const POST = handleCallback(async (message, metadata) => {
  await processPushDeliveryMessage(
    message,
    { deliveryCount: metadata.deliveryCount },
    githubWebhookRepository,
  );
});
