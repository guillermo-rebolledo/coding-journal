import { timingSafeEqual } from "node:crypto";

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
