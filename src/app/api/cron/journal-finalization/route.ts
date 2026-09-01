import { timingSafeEqual } from "node:crypto";

import { enqueueDueJournalFinalizations } from "@/lib/journal-finalization";
import { journalFinalizationRepository } from "@/lib/journal-finalization-repository";
import { queuePublisher } from "@/lib/queue";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) {
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
