import { authorizeOperationsRequest } from "@/lib/operations-auth";
import type { PrivacyMaintenanceResult } from "@/lib/privacy-maintenance";

/**
 * The one boundary this route reaches. It is a parameter rather than a module
 * import so a test can supply a real stand-in and still exercise the
 * authorization the route is responsible for.
 */
export type PrivacyMaintenanceDependencies = {
  run: (now: Date) => Promise<PrivacyMaintenanceResult>;
};

/** Runs one bounded retention batch and reports only its safe progress. */
export function createPrivacyMaintenanceRoute({
  run,
}: PrivacyMaintenanceDependencies) {
  return async function GET(request: Request) {
    if (!authorizeOperationsRequest(request)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json(await run(new Date()));
  };
}
