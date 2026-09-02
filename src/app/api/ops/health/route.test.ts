// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundaries = vi.hoisted(() => ({ report: vi.fn() }));

vi.mock("@/lib/service-health", () => ({
  serviceHealthReport: boundaries.report,
}));

import { GET } from "@/app/api/ops/health/route";

function request(authorization?: string) {
  return new Request("https://journal.example.com/api/ops/health", {
    headers: authorization ? { authorization } : {},
  });
}

describe("operations health view", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "operations-secret");
    boundaries.report.mockReset().mockResolvedValue({ generatedAt: "now" });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("refuses an unauthenticated request without reading the database", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(boundaries.report).not.toHaveBeenCalled();
  });

  it("refuses a wrong credential", async () => {
    const response = await GET(request("Bearer not-the-secret"));

    expect(response.status).toBe(401);
    expect(boundaries.report).not.toHaveBeenCalled();
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
