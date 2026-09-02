// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertProviderAvailable,
  circuitConfiguration,
  ProviderUnavailableError,
  withProviderCircuit,
  type CircuitDecision,
  type CircuitStore,
} from "@/lib/service-circuit";

function circuitStore(decision: CircuitDecision) {
  return {
    tryEnter: vi.fn(async () => decision),
    recordSuccess: vi.fn(async () => {}),
    recordFailure: vi.fn(async () => {}),
    readAll: vi.fn(async () => []),
  } satisfies CircuitStore;
}

describe("provider circuits", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("never reaches the provider while the circuit is open", async () => {
    const store = circuitStore({ allowed: false, retryAfterSeconds: 90 });
    const call = vi.fn();

    await expect(
      withProviderCircuit({ service: "openai", store }, call),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(call).not.toHaveBeenCalled();
    expect(store.recordFailure).not.toHaveBeenCalled();
  });

  it("carries how long the caller should wait", async () => {
    const store = circuitStore({ allowed: false, retryAfterSeconds: 90 });

    let refusal: ProviderUnavailableError | null = null;
    try {
      await assertProviderAvailable({ service: "github", store });
    } catch (cause) {
      if (cause instanceof ProviderUnavailableError) refusal = cause;
    }

    expect(refusal).toBeInstanceOf(ProviderUnavailableError);
    expect(refusal?.retryAfterSeconds).toBe(90);
    expect(refusal?.service).toBe("github");
  });

  it("records a success and returns the provider's own result", async () => {
    const store = circuitStore({ allowed: true });

    await expect(
      withProviderCircuit({ service: "openai", store }, async () => "written"),
    ).resolves.toBe("written");
    expect(store.recordSuccess).toHaveBeenCalledWith(
      "openai",
      expect.any(Date),
    );
  });

  it("records a failure and lets the provider's error through unchanged", async () => {
    const store = circuitStore({ allowed: true });
    const failure = new Error("Summary provider returned 503");

    await expect(
      withProviderCircuit({ service: "openai", store }, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(store.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ service: "openai" }),
    );
  });

  it("takes its thresholds from configuration", () => {
    vi.stubEnv("CIRCUIT_FAILURE_THRESHOLD", "2");
    vi.stubEnv("CIRCUIT_COOLDOWN_SECONDS", "30");

    expect(circuitConfiguration()).toMatchObject({
      failureThreshold: 2,
      cooldownMs: 30_000,
    });
  });
});
