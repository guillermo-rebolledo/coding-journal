import { journalFinalizationRepository } from "@/lib/journal-finalization-repository";
import { queuePublisher } from "@/lib/queue";

import { createFinalizationScheduleRoute } from "./handler";

export const GET = createFinalizationScheduleRoute({
  store: journalFinalizationRepository,
  queue: queuePublisher,
});
