import type { RateLimitDecision, RateLimitPolicyName } from "@/lib/rate-limit";
import { rateLimitRepository } from "@/lib/rate-limit-repository";
import { guardAction } from "@/lib/request-guard";

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
  service,
  store = rateLimitRepository,
}: {
  policy: RateLimitPolicyName;
  userId?: string | null;
  now?: Date;
  event?: string;
  service?: "github" | "openai";
  /**
   * Where the spend is counted. It is a parameter with the production default
   * so a caller can supply a real stand-in and still exercise the policy.
   */
  store?: typeof rateLimitRepository;
}): Promise<RateLimitDecision | null> {
  const guarded = await guardAction({
    policy,
    userId,
    now,
    provider: service,
    rateStore: store,
  });
  if (guarded.proceed) return null;
  const resetAt = guarded.refusal.resumeAt;
  return {
    allowed: false,
    policy,
    limit: 0,
    remaining: 0,
    resetAt,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((resetAt.getTime() - now.getTime()) / 1000),
    ),
  };
}
