import { authorizeOperationsRequest } from "@/lib/operations-auth";
import type { ServiceHealthReport } from "@/lib/service-health";
import { logServiceEvent } from "@/lib/telemetry";

/**
 * The one boundary this route reaches. It is a parameter rather than a module
 * import so a test can supply a real stand-in and still exercise the
 * authorization and caching behaviour the route is responsible for.
 */
export type OperationsHealthDependencies = {
  report: (now: Date) => Promise<ServiceHealthReport>;
};

/**
 * The operational view for sync, queue, provider, budget, finalization and
 * privacy failures. It answers "what is failing?" without an error-tracking
 * vendor and without exposing anything about a person's journal — see
 * `docs/operations.md` for how to read it.
 */
export function createOperationsHealthRoute({
  report,
}: OperationsHealthDependencies) {
  return async function GET(request: Request) {
    if (!authorizeOperationsRequest(request)) {
      logServiceEvent({
        category: "request",
        event: "ops-health-unauthorized",
        outcome: "blocked",
      });
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    return Response.json(await report(new Date()), {
      headers: { "cache-control": "no-store" },
    });
  };
}
