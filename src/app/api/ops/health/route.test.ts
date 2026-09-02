// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOperationsHealthRoute } from "@/app/api/ops/health/handler";
import type { ServiceHealthReport } from "@/lib/service-health";

const report = vi.fn<(now: Date) => Promise<ServiceHealthReport>>();
const GET = createOperationsHealthRoute({ report });

function request(authorization?: string) {
  return new Request("https://journal.example.com/api/ops/health", {
    headers: authorization ? { authorization } : {},
  });
}

describe("operations health view", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "operations-secret");
    // SAFETY: the route only forwards the report; this stand-in carries the
    // one member the assertions read.
    report
      .mockReset()
      .mockResolvedValue({ generatedAt: "now" } as ServiceHealthReport);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("refuses an unauthenticated request without reading the database", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(report).not.toHaveBeenCalled();
  });

  it("refuses a wrong credential", async () => {
    const response = await GET(request("Bearer not-the-secret"));

    expect(response.status).toBe(401);
    expect(report).not.toHaveBeenCalled();
  });

  it("refuses everything when no operations secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");

    expect((await GET(request("Bearer operations-secret"))).status).toBe(401);
  });

  it("answers an authorized request with the uncached report", async () => {
    const response = await GET(request("Bearer operations-secret"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ generatedAt: "now" });
  });
});
