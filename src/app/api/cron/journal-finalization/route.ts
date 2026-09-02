import { enqueueDueJournalFinalizations } from "@/lib/journal-finalization";
import { journalFinalizationRepository } from "@/lib/journal-finalization-repository";
import { queuePublisher } from "@/lib/queue";
import { authorizeOperationsRequest } from "@/lib/operations-auth";

export async function GET(request: Request) {
  if (!authorizeOperationsRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const enqueued = await enqueueDueJournalFinalizations(
    journalFinalizationRepository,
    queuePublisher,
    now,
  );
  return Response.json({ enqueued });
}
