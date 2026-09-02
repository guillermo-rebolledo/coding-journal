import { handleCallback } from "@vercel/queue";

import { processWebhookDeliveryMessage } from "@/lib/github-webhook-processing";
import { isJsonObject } from "@/lib/json-payload";
import { githubWebhookRepository } from "@/lib/github-webhook-repository";
import { withQueueSlot, type QueueTopic } from "@/lib/queue-lease";
import { retryableGuardError } from "@/lib/request-guard";
import { queueLeaseRepository } from "@/lib/queue-lease-repository";

const topic: QueueTopic = "github-webhook-deliveries";

/**
 * A busy installation can deliver hundreds of webhooks in a minute, and the
 * platform is happy to run all of them at once. The consumer therefore takes
 * one of a fixed number of slots first; when the topic is saturated the
 * message goes back to the queue instead of adding another concurrent writer.
 */
export const POST = handleCallback(
  async (message, metadata) => {
    await withQueueSlot({ topic, store: queueLeaseRepository }, () =>
      processWebhookDeliveryMessage(
        isJsonObject(message) ? message : null,
        { deliveryCount: metadata.deliveryCount },
        githubWebhookRepository,
      ),
    );
  },
  {
    retry: retryableGuardError,
  },
);
