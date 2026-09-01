import { send } from "@vercel/queue";

// Vercel Queues is in beta; keep every queue-specific call behind this port so
// the transport stays replaceable.
export type QueuePublisher = {
  publish(
    topic: string,
    message: unknown,
    idempotencyKey: string,
  ): Promise<void>;
};

export const queuePublisher: QueuePublisher = {
  async publish(topic, message, idempotencyKey) {
    await send(topic, message, { idempotencyKey });
  },
};
