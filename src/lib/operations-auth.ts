import { timingSafeEqual } from "node:crypto";
import { logServiceEvent } from "@/lib/telemetry";

/**
 * Scheduled dispatches and the operations view share one credential and one
 * constant-time comparison. Without `CRON_SECRET` configured nothing is
 * authorized, so a missing secret closes these routes instead of opening them.
 */
export function authorizeOperationsRequest(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

export function refuseUnauthorizedOperationsRequest(
  request: Request,
  event: string,
) {
  if (authorizeOperationsRequest(request)) return null;
  logServiceEvent({ category: "request", event, outcome: "blocked" });
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
