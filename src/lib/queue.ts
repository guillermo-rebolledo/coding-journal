import { send } from "@vercel/queue";

import type { JsonObject } from "@/lib/json-payload";

// Vercel Queues is in beta; keep every queue-specific call behind this port so
// the transport stays replaceable.
export type QueuePublisher = {
  publish(
    topic: string,
    message: JsonObject,
    idempotencyKey: string,
  ): Promise<void>;
};

export const queuePublisher: QueuePublisher = {
  async publish(topic, message, idempotencyKey) {
    await send(topic, message, { idempotencyKey });
  },
};
