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
  store = rateLimitRepository,
}: {
  policy: RateLimitPolicyName;
  userId?: string | null;
  now?: Date;
  event: string;
  service?: "github" | "openai";
  /**
   * Where the spend is counted. It is a parameter with the production default
   * so a caller can supply a real stand-in and still exercise the policy.
   */
  store?: typeof rateLimitRepository;
}): Promise<RateLimitDecision | null> {
  if (userId && isE2EJournalUser(userId)) return null;

  const decision = await consumeRateLimit({
    store,
    policy,
    userId,
    now,
  });
  if (!decision.allowed) {
    logServiceEvent({
      category: "budget",
      event,
      outcome: "limited",
      userId: userId ?? undefined,
      service,
      reason: decision.policy,
      limit: decision.limit,
      retryAfterSeconds: decision.retryAfterSeconds,
    });
  }
  return decision;
}
