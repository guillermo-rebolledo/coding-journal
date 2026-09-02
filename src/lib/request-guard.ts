import {
  consumeRateLimit,
  rateLimitMessage,
  type RateLimitPolicyName,
  type RateLimitStore,
} from "@/lib/rate-limit";
import { rateLimitRepository } from "@/lib/rate-limit-repository";
import { QueueSaturatedError } from "@/lib/queue-lease";
import {
  circuitConfiguration,
  type CircuitService,
  type CircuitStore,
  ProviderUnavailableError,
} from "@/lib/service-circuit";
import { logServiceEvent } from "@/lib/telemetry";

const telemetryEvents: Record<RateLimitPolicyName, string> = {
  "journal-refresh": "journal-refresh-limited",
  "github-sync-daily": "github-sync-budget-exhausted",
  "finalization-retry": "finalization-retry-limited",
  "narrative-redaction": "narrative-redaction-limited",
  "account-deletion": "account-deletion-limited",
};

export function guardTelemetryEvent(policy: RateLimitPolicyName) {
  return telemetryEvents[policy];
}

export type GuardRefusal = {
  outcome: "limited" | "unavailable";
  message: string;
  resumeAt: Date;
};

export type GuardDecision =
  | { proceed: true }
  | { proceed: false; refusal: GuardRefusal };

export function providerUnavailableRefusal(
  provider: CircuitService,
  retryAfterSeconds: number,
  now = new Date(),
): GuardRefusal {
  return {
    outcome: "unavailable",
    message: `The ${provider === "github" ? "GitHub" : "narrative"} service is temporarily unavailable. Stored journals stay readable. Try again in about ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minutes.`,
    resumeAt: new Date(now.getTime() + retryAfterSeconds * 1000),
  };
}

export function retryableGuardError(cause: unknown) {
  return cause instanceof QueueSaturatedError ||
    cause instanceof ProviderUnavailableError
    ? { afterSeconds: cause.retryAfterSeconds }
    : undefined;
}

/** One decision point for request budget and optional provider availability. */
export async function guardAction({
  policy,
  userId = null,
  provider,
  now = new Date(),
  rateStore = rateLimitRepository,
  circuitStore,
}: {
  policy: RateLimitPolicyName;
  userId?: string | null;
  provider?: CircuitService;
  now?: Date;
  rateStore?: RateLimitStore;
  circuitStore?: CircuitStore;
}): Promise<GuardDecision> {
  const decision = await consumeRateLimit({
    store: rateStore,
    policy,
    userId,
    now,
  });
  if (!decision.allowed) {
    logServiceEvent({
      category: "budget",
      event: guardTelemetryEvent(policy),
      outcome: "limited",
      userId: userId ?? undefined,
      service: provider,
      reason: decision.policy,
      limit: decision.limit,
      retryAfterSeconds: decision.retryAfterSeconds,
    });
    return {
      proceed: false,
      refusal: {
        outcome: "limited",
        message: rateLimitMessage(decision, now),
        resumeAt: decision.resetAt,
      },
    };
  }

  if (provider && circuitStore) {
    const circuit = await circuitStore.tryEnter({
      service: provider,
      now,
      configuration: circuitConfiguration(),
    });
    if (!circuit.allowed) {
      logServiceEvent({
        category: "provider",
        event: "provider-circuit-open",
        outcome: "blocked",
        service: provider,
        userId: userId ?? undefined,
        retryAfterSeconds: circuit.retryAfterSeconds,
      });
      return {
        proceed: false,
        refusal: providerUnavailableRefusal(
          provider,
          circuit.retryAfterSeconds,
          now,
        ),
      };
    }
  }

  return { proceed: true };
}
