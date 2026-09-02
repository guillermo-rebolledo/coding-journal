// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildServiceEventRecord,
  logServiceEvent,
  opaqueUserId,
  redactMessage,
} from "@/lib/telemetry";

describe("service telemetry", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("identifies a user by a stable digest that is not the user id", () => {
    const first = opaqueUserId("user-42");
    const second = opaqueUserId("user-42");

    expect(first).toBe(second);
    expect(first).toMatch(/^usr_[0-9a-f]{16}$/);
    expect(first).not.toContain("user-42");
    expect(opaqueUserId("user-43")).not.toBe(first);
  });

  it("keys the digest with the deployment secret so logs alone cannot reverse it", () => {
    vi.stubEnv("TELEMETRY_SALT", "salt-one");
    const withFirstSalt = opaqueUserId("user-42");
    vi.stubEnv("TELEMETRY_SALT", "salt-two");

    expect(opaqueUserId("user-42")).not.toBe(withFirstSalt);
  });

  it("removes credentials, addresses, URLs, and repository paths from a message", () => {
    const redacted = redactMessage(
      "GET https://api.github.com/repos/acme/private-api/commits failed for ada@example.com with token: ghp_abcdefghijklmnop",
    );

    expect(redacted).not.toContain("acme/private-api");
    expect(redacted).not.toContain("ghp_abcdefghijklmnop");
    expect(redacted).not.toContain("ada@example.com");
    expect(redacted).not.toContain("https://");
    expect(redacted).toContain("[url]");
    expect(redacted).toContain("[credential]");
  });

  it("truncates a message so a provider cannot push a payload into the log", () => {
    expect(redactMessage("x".repeat(5_000))).toHaveLength(200);
  });

  it("writes only the declared fields, dropping anything a caller adds", () => {
    const record = buildServiceEventRecord({
      category: "sync",
      event: "reconciliation-finished",
      outcome: "ok",
      userId: "user-42",
      jobId: "user-42:2026-09-01",
      service: "github",
      count: 12,
      // A future caller widening the object must not be able to leak.
      ...({
        repositoryName: "acme/private-api",
        subjectTitle: "Fix the private billing bug",
        summary: "Ada shipped the billing fix",
      } as unknown as Record<string, never>),
    });

    expect(Object.keys(record).sort()).toEqual([
      "category",
      "count",
      "event",
      "job",
      "outcome",
      "service",
      "user",
    ]);
    expect(JSON.stringify(record)).not.toContain("acme");
    expect(JSON.stringify(record)).not.toContain("billing");
  });

  it("replaces an identifier field that is not identifier-shaped", () => {
    const record = buildServiceEventRecord({
      category: "provider",
      event: "call-failed",
      outcome: "failed",
      stage: "acme/private-api commits",
    });

    expect(record.stage).toBe("[redacted]");
  });

  it("routes a failure to the error stream as one structured line", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logServiceEvent({
      category: "queue",
      event: "delivery-failed",
      outcome: "failed",
      service: "queue",
    });

    expect(error).toHaveBeenCalledTimes(1);
    const [line] = error.mock.calls[0] as [string];
    expect(line.startsWith("[coding-journal] ")).toBe(true);
    expect(JSON.parse(line.slice("[coding-journal] ".length))).toEqual({
      category: "queue",
      event: "delivery-failed",
      outcome: "failed",
      service: "queue",
    });
  });
});
