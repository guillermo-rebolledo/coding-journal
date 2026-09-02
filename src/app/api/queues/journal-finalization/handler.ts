import type { JsonObject } from "@/lib/json-payload";
import { parseJournalFinalizationMessage } from "@/lib/journal-finalization";
import {
  QueueSaturatedError,
  withQueueSlot,
  type QueueLeaseStore,
  type QueueTopic,
} from "@/lib/queue-lease";
import {
  assertProviderAvailable,
  ProviderUnavailableError,
  type CircuitStore,
} from "@/lib/service-circuit";
import { logServiceEvent } from "@/lib/telemetry";

const topic: QueueTopic = "journal-finalization";

/**
 * The boundaries this consumer reaches. They are parameters rather than module
 * imports so a test can supply real stand-ins and still exercise the slot,
 * circuit and retry behaviour the consumer owns — the finalization pipeline
 * itself is covered by its own tests.
 */
export type FinalizationConsumerDependencies = {
  leases: QueueLeaseStore;
  circuits: CircuitStore;
  process: (
    payload: JsonObject | null,
    deliveryCount: number,
    now: Date,
  ) => Promise<void>;
};

/**
 * Finalization is the most expensive job in the product: a full day
 * reconciliation followed by a narrative generation. Before any of it starts
 * the consumer takes a concurrency slot and checks both provider circuits, so
 * a GitHub or summary outage delays the day rather than spending a retry
 * budget on calls that cannot succeed.
 */
export function createFinalizationConsumer({
  leases,
  circuits,
  process: runFinalization,
}: FinalizationConsumerDependencies) {
  return {
    async handle(
      payload: JsonObject | null,
      metadata: { deliveryCount: number },
    ) {
      const now = new Date();
      const parsed = parseJournalFinalizationMessage(payload);
      const jobId = parsed ? `${parsed.userId}:${parsed.localDate}` : undefined;

      await withQueueSlot({ topic, store: leases, now, jobId }, async () => {
        await assertProviderAvailable({
          service: "github",
          store: circuits,
          now,
          jobId,
        });
        if (globalThis.process.env.OPENAI_API_KEY) {
          await assertProviderAvailable({
            service: "openai",
            store: circuits,
            now,
            jobId,
          });
        }

        await runFinalization(payload, metadata.deliveryCount, now);

        logServiceEvent({
          category: "finalization",
          event: "delivery-processed",
          outcome: "ok",
          jobId,
          attempt: metadata.deliveryCount,
        });
      });
    },

    /**
     * Neither refusal is a failure of this day's journal, so the message is
     * redelivered instead of counting against the finalization attempts.
     */
    retry(cause: unknown) {
      return cause instanceof QueueSaturatedError ||
        cause instanceof ProviderUnavailableError
        ? { afterSeconds: cause.retryAfterSeconds }
        : undefined;
    },
  };
}
