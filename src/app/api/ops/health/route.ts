import { authorizeOperationsRequest } from "@/lib/operations-auth";
import { serviceHealthReport } from "@/lib/service-health";
import { logServiceEvent } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

/**
 * The operational view for sync, queue, provider, budget, finalization and
 * privacy failures. It answers "what is failing?" without an error-tracking
 * vendor and without exposing anything about a person's journal — see
 * `docs/operations.md` for how to read it.
 */
export async function GET(request: Request) {
  if (!authorizeOperationsRequest(request)) {
    logServiceEvent({
      category: "request",
      event: "ops-health-unauthorized",
      outcome: "blocked",
    });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report = await serviceHealthReport(new Date());
  return Response.json(report, {
    headers: { "cache-control": "no-store" },
  });
}
