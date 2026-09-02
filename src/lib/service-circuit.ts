import { describeErrorForTelemetry, logServiceEvent } from "@/lib/telemetry";

/**
 * Circuit breakers for the two outbound services that cost money and can stay
 * broken for a long time: GitHub and the summary provider.
 *
 * A queue consumer that keeps calling a failing provider burns invocations,
 * retries, and quota to no purpose. When the circuit is open the consumer
 * stops *before* the call and reschedules the message, so the work is delayed
 * rather than lost while the recorded journal keeps serving from storage.
 *
 * The state lives in Postgres because Fluid Compute recycles instances, and a
 * process-local breaker would start closed on every cold start. Entering is
 * deliberately idempotent — a caller may check early and again at the call
 * site — so the circuit has two states and no exclusive probe to lose.
 */

export type CircuitService = "github" | "openai";

export type CircuitConfiguration = {
  /** Failures inside the window that open the circuit. */
  failureThreshold: number;
  failureWindowMs: number;
  /** How long the circuit stays open before calls are admitted again. */
  cooldownMs: number;
};

export type CircuitSnapshot = {
  service: string;
  state: "closed" | "open";
  failureCount: number;
  openedAt: Date | null;
  retryAt: Date | null;
  updatedAt: Date;
};

export type CircuitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export type CircuitStore = {
  tryEnter(input: {
    service: CircuitService;
    now: Date;
    configuration: CircuitConfiguration;
  }): Promise<CircuitDecision>;
  recordSuccess(service: CircuitService, now: Date): Promise<void>;
  recordFailure(input: {
    service: CircuitService;
    now: Date;
    configuration: CircuitConfiguration;
  }): Promise<void>;
  readAll(): Promise<CircuitSnapshot[]>;
};

export class ProviderUnavailableError extends Error {
  readonly service: CircuitService;
  readonly retryAfterSeconds: number;

  constructor(service: CircuitService, retryAfterSeconds: number) {
    super(`The ${service} circuit is open`);
    this.name = "ProviderUnavailableError";
    this.service = service;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function configuredNumber(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function circuitConfiguration(): CircuitConfiguration {
  return {
    failureThreshold: configuredNumber("CIRCUIT_FAILURE_THRESHOLD", 5),
    failureWindowMs:
      configuredNumber("CIRCUIT_FAILURE_WINDOW_SECONDS", 300) * 1000,
    cooldownMs: configuredNumber("CIRCUIT_COOLDOWN_SECONDS", 120) * 1000,
  };
}

/** Stops a caller before it reaches the provider at all. */
export async function assertProviderAvailable({
  service,
  store,
  now = new Date(),
  jobId,
  category = "queue",
}: {
  service: CircuitService;
  store: CircuitStore;
  now?: Date;
  jobId?: string;
  category?: "queue" | "provider";
}) {
  const decision = await store.tryEnter({
    service,
    now,
    configuration: circuitConfiguration(),
  });
  if (decision.allowed) return;
  logServiceEvent({
    category,
    event: "provider-circuit-open",
    outcome: "blocked",
    service,
    jobId,
    retryAfterSeconds: decision.retryAfterSeconds,
  });
  throw new ProviderUnavailableError(service, decision.retryAfterSeconds);
}

/**
 * Refuses before the call when the circuit is open, and records the outcome
 * when it is not. The caller sees the provider's own result unchanged, or a
 * `ProviderUnavailableError` carrying how long to wait.
 */
export async function withProviderCircuit<T>(
  {
    service,
    store,
    now = new Date(),
    jobId,
  }: {
    service: CircuitService;
    store: CircuitStore;
    now?: Date;
    jobId?: string;
  },
  call: () => Promise<T>,
): Promise<T> {
  await assertProviderAvailable({
    service,
    store,
    now,
    jobId,
    category: "provider",
  });

  try {
    const result = await call();
    await store.recordSuccess(service, new Date());
    return result;
  } catch (error) {
    await recordProviderFailure({
      service,
      store,
      jobId,
      error,
    });
    throw error;
  }
}

export async function recordProviderFailure({
  service,
  store,
  now = new Date(),
  jobId,
  error,
}: {
  service: CircuitService;
  store: CircuitStore;
  now?: Date;
  jobId?: string;
  error?: unknown;
}) {
  await store.recordFailure({
    service,
    now,
    configuration: circuitConfiguration(),
  });
  logServiceEvent({
    category: "provider",
    event: "call-failed",
    outcome: "failed",
    service,
    jobId,
    ...(error === undefined
      ? { errorName: "ProviderCallFailed" }
      : describeErrorForTelemetry(error)),
  });
}

export async function recordProviderSuccess({
  service,
  store,
  now = new Date(),
}: {
  service: CircuitService;
  store: CircuitStore;
  now?: Date;
}) {
  await store.recordSuccess(service, now);
}
