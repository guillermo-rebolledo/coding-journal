import { randomUUID } from "node:crypto";

import { logServiceEvent } from "@/lib/telemetry";

/**
 * Bounded concurrency for queue consumers.
 *
 * Vercel Queues delivers as fast as the topic fills, and Fluid Compute happily
 * runs those deliveries in parallel. Without a bound, one busy hour of GitHub
 * webhooks or one backlog of finalizations would fan out into as many
 * concurrent provider calls and database connections as the platform can
 * create. A consumer therefore takes a numbered slot first; when every slot is
 * held it reschedules the message instead of processing it, so throughput is
 * shaped rather than work being dropped.
 */

export type QueueTopic = "github-webhook-deliveries" | "journal-finalization";

export type QueueLease = {
  id: string;
  topic: string;
  slot: number;
  holder: string;
  expiresAt: Date;
};

export type QueueLeaseStore = {
  acquire(input: {
    topic: QueueTopic;
    limit: number;
    holder: string;
    now: Date;
    ttlMs: number;
  }): Promise<QueueLease | null>;
  release(lease: QueueLease): Promise<void>;
  activeCount(topic: QueueTopic, now: Date): Promise<number>;
};

export class QueueSaturatedError extends Error {
  readonly topic: QueueTopic;
  readonly retryAfterSeconds: number;

  constructor(topic: QueueTopic, retryAfterSeconds: number) {
    super(`The ${topic} consumer is at its concurrency limit`);
    this.name = "QueueSaturatedError";
    this.topic = topic;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function configuredNumber(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function queueConcurrency(topic: QueueTopic) {
  return topic === "github-webhook-deliveries"
    ? configuredNumber("WEBHOOK_QUEUE_CONCURRENCY", 10)
    : configuredNumber("FINALIZATION_QUEUE_CONCURRENCY", 5);
}

/** How long a slot survives an instance that dies mid-message. */
export function queueLeaseTtlMs(topic: QueueTopic) {
  return topic === "github-webhook-deliveries"
    ? configuredNumber("WEBHOOK_QUEUE_LEASE_SECONDS", 120) * 1000
    : configuredNumber("FINALIZATION_QUEUE_LEASE_SECONDS", 300) * 1000;
}

export function queueRetryAfterSeconds(topic: QueueTopic) {
  return topic === "github-webhook-deliveries"
    ? configuredNumber("WEBHOOK_QUEUE_RETRY_SECONDS", 30)
    : configuredNumber("FINALIZATION_QUEUE_RETRY_SECONDS", 60);
}

/**
 * Runs the message inside a slot, and always gives the slot back. A saturated
 * topic raises `QueueSaturatedError` so the route can ask the queue to deliver
 * the message again shortly.
 */
export async function withQueueSlot<T>(
  {
    topic,
    store,
    now = new Date(),
    jobId,
  }: {
    topic: QueueTopic;
    store: QueueLeaseStore;
    now?: Date;
    jobId?: string;
  },
  run: () => Promise<T>,
): Promise<T> {
  const limit = queueConcurrency(topic);
  const lease = await store.acquire({
    topic,
    limit,
    holder: randomUUID(),
    now,
    ttlMs: queueLeaseTtlMs(topic),
  });

  if (!lease) {
    const retryAfterSeconds = queueRetryAfterSeconds(topic);
    logServiceEvent({
      category: "queue",
      event: "concurrency-limited",
      outcome: "limited",
      service: "queue",
      ...(jobId ? { jobId } : {}),
      limit,
      retryAfterSeconds,
    });
    throw new QueueSaturatedError(topic, retryAfterSeconds);
  }

  try {
    return await run();
  } finally {
    await store.release(lease);
  }
}
