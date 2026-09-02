import { opaqueId } from "@/lib/telemetry";

/**
 * Application-level request and product budgets.
 *
 * The Vercel WAF bounds anonymous traffic by IP and client fingerprint before
 * a function is ever invoked (see `docs/operations.md`). It cannot see who is
 * signed in, so every authenticated boundary that costs money — a GitHub
 * reconciliation, a finalization retry, an account deletion — is bounded here
 * as well, by user and by product-wide budget.
 *
 * Counters are fixed windows held in Postgres. A single atomic upsert both
 * rolls the window and increments it, so two concurrent requests can never
 * read the same count and both decide they are within the limit.
 */

export type RateLimitPolicyName =
  | "journal-refresh"
  | "finalization-retry"
  | "narrative-redaction"
  | "account-deletion"
  | "github-sync-daily";

export type RateLimitPolicy = {
  /** How many requests the window allows. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** `user` counts per signed-in user; `global` counts the whole product. */
  scope: "user" | "global";
  /** What still works while the policy is refusing, in one sentence. */
  stillAvailable: string;
};

const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

function configuredLimit(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function rateLimitPolicies(): Record<
  RateLimitPolicyName,
  RateLimitPolicy
> {
  return {
    // A refresh reads stored activity and may call GitHub. The 15-minute
    // reconciliation cooldown already bounds the provider calls; this bounds
    // the database work an automated client could drive from one session.
    "journal-refresh": {
      limit: configuredLimit("RATE_LIMIT_JOURNAL_REFRESH", 12),
      windowMs: 15 * minute,
      scope: "user",
      stillAvailable: "Everything already recorded stays on screen",
    },
    // A retry re-runs a full day reconciliation and a narrative generation.
    "finalization-retry": {
      limit: configuredLimit("RATE_LIMIT_FINALIZATION_RETRY", 5),
      windowMs: hour,
      scope: "user",
      stillAvailable: "The finalized record and its metrics stay readable",
    },
    "narrative-redaction": {
      limit: configuredLimit("RATE_LIMIT_NARRATIVE_REDACTION", 20),
      windowMs: hour,
      scope: "user",
      stillAvailable: "The day's recorded facts are unaffected",
    },
    "account-deletion": {
      limit: configuredLimit("RATE_LIMIT_ACCOUNT_DELETION", 5),
      windowMs: hour,
      scope: "user",
      stillAvailable: "Settings and the journal stay available",
    },
    // The product-wide GitHub budget. It is the backstop that keeps a signup
    // spike from turning into an unbounded provider bill.
    "github-sync-daily": {
      limit: configuredLimit("RATE_LIMIT_GITHUB_SYNC_DAILY", 20_000),
      windowMs: day,
      scope: "global",
      stillAvailable:
        "Stored journals stay readable and webhooks keep arriving",
    },
  };
}

export type RateLimitDecision = {
  allowed: boolean;
  policy: RateLimitPolicyName;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
};

export type RateLimitCount = {
  count: number;
  windowEndsAt: Date;
};

export type RateLimitStore = {
  /** Atomically rolls the window when it has expired and increments it. */
  increment(input: {
    scope: RateLimitPolicyName;
    subject: string;
    now: Date;
    windowMs: number;
  }): Promise<RateLimitCount>;
};

/**
 * The stored subject is an opaque digest rather than a user id, so an
 * operational table cannot re-identify a deleted account, and a global policy
 * uses a fixed subject.
 */
export function rateLimitSubject(
  policy: RateLimitPolicy,
  userId: string | null,
) {
  if (policy.scope === "global") return "global";
  return userId ? opaqueId("sub", userId) : "anonymous";
}

function decide(
  policy: RateLimitPolicyName,
  configured: RateLimitPolicy,
  count: RateLimitCount,
  now: Date,
): RateLimitDecision {
  const remaining = Math.max(0, configured.limit - count.count);
  return {
    allowed: count.count <= configured.limit,
    policy,
    limit: configured.limit,
    remaining,
    resetAt: count.windowEndsAt,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((count.windowEndsAt.getTime() - now.getTime()) / 1000),
    ),
  };
}

export async function consumeRateLimit({
  store,
  policy,
  userId = null,
  now = new Date(),
}: {
  store: RateLimitStore;
  policy: RateLimitPolicyName;
  userId?: string | null;
  now?: Date;
}): Promise<RateLimitDecision> {
  const configured = rateLimitPolicies()[policy];
  const count = await store.increment({
    scope: policy,
    subject: rateLimitSubject(configured, userId),
    now,
    windowMs: configured.windowMs,
  });
  return decide(policy, configured, count, now);
}

function describeWindow(windowMs: number) {
  if (windowMs >= day) return "a day";
  if (windowMs >= hour) {
    const hours = Math.round(windowMs / hour);
    return hours === 1 ? "an hour" : `${hours} hours`;
  }
  return `${Math.max(1, Math.round(windowMs / minute))} minutes`;
}

/**
 * The same sentence for a boundary that has no decision to hand — a page that
 * knows only which policy refused the request that redirected to it.
 */
export function rateLimitPolicyMessage(policy: RateLimitPolicyName) {
  const configured = rateLimitPolicies()[policy];
  return `Request limit reached. ${configured.stillAvailable}. Try again in up to ${describeWindow(
    configured.windowMs,
  )}.`;
}

/**
 * The single sentence every refused boundary says: what happened, what still
 * works, and when it returns. Frame 1o of the look-and-feel reference requires
 * the same slot and the same type role for all of them, so the wording is
 * built here rather than at each call site.
 */
export function rateLimitMessage(
  decision: RateLimitDecision,
  resolvedAt: Date = new Date(),
) {
  const configured = rateLimitPolicies()[decision.policy];
  const minutes = Math.max(
    1,
    Math.ceil((decision.resetAt.getTime() - resolvedAt.getTime()) / minute),
  );
  return `Request limit reached. ${configured.stillAvailable}. Try again in about ${minutes} ${
    minutes === 1 ? "minute" : "minutes"
  }.`;
}
