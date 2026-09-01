import { handleCallback } from "@vercel/queue";

import { processWebhookDeliveryMessage } from "@/lib/github-webhook-processing";
import { githubWebhookRepository } from "@/lib/github-webhook-repository";

export const POST = handleCallback(async (message, metadata) => {
  await processWebhookDeliveryMessage(
    message,
    { deliveryCount: metadata.deliveryCount },
    githubWebhookRepository,
  );
});
