import { isE2EJournalUser } from "@/lib/e2e-fixtures";
import {
  consumeRateLimit,
  type RateLimitDecision,
  type RateLimitPolicyName,
} from "@/lib/rate-limit";
import { rateLimitRepository } from "@/lib/rate-limit-repository";
import { logServiceEvent } from "@/lib/telemetry";

/**
 * Spends one request from a policy's window and reports the refusal.
 *
 * This is the single place the application binds a policy to the Postgres
 * counter and to telemetry, so every guarded boundary refuses the same way and
 * logs the same event shape. It returns `null` for the deterministic
 * end-to-end fixture users, who run with no database at all.
 */
export async function spendRequestBudget({
  policy,
  userId = null,
  now = new Date(),
  event,
  service,
}: {
  policy: RateLimitPolicyName;
  userId?: string | null;
  now?: Date;
  event: string;
  service?: "github" | "openai";
}): Promise<RateLimitDecision | null> {
  if (userId && isE2EJournalUser(userId)) return null;

  const decision = await consumeRateLimit({
    store: rateLimitRepository,
    policy,
    userId,
    now,
  });
  if (!decision.allowed) {
    logServiceEvent({
      category: "budget",
      event,
      outcome: "limited",
      ...(userId ? { userId } : {}),
      ...(service ? { service } : {}),
      reason: decision.policy,
      limit: decision.limit,
      retryAfterSeconds: decision.retryAfterSeconds,
    });
  }
  return decision;
}
