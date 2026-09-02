import {
  enqueueDueJournalFinalizations,
  type FinalizationStore,
} from "@/lib/journal-finalization";
import { refuseUnauthorizedOperationsRequest } from "@/lib/operations-auth";
import type { QueuePublisher } from "@/lib/queue";

/**
 * The two boundaries this route reaches. They are parameters rather than
 * module imports so a test can supply real stand-ins and still exercise the
 * authorization the route is responsible for.
 */
export type FinalizationScheduleDependencies = {
  store: FinalizationStore;
  queue: QueuePublisher;
};

/** Enqueues every journal whose finalization is due. */
export function createFinalizationScheduleRoute({
  store,
  queue,
}: FinalizationScheduleDependencies) {
  return async function GET(request: Request) {
    const refusal = refuseUnauthorizedOperationsRequest(
      request,
      "finalization-schedule-unauthorized",
    );
    if (refusal) return refusal;
    const enqueued = await enqueueDueJournalFinalizations(
      store,
      queue,
      new Date(),
    );
    return Response.json({ enqueued });
  };
}
