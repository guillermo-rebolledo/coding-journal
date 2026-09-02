// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const privacyBoundary = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("@/lib/privacy-maintenance", () => ({
  runPrivacyMaintenance: privacyBoundary.run,
}));

import { GET } from "@/app/api/cron/privacy-maintenance/route";

describe("privacy maintenance endpoint", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "privacy-secret");
    privacyBoundary.run.mockReset().mockResolvedValue({
      deletedActivities: 500,
      hasMore: true,
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("runs one authenticated bounded retention batch and exposes only safe progress", async () => {
    const response = await GET(
      new Request("https://journal.example/api/cron/privacy-maintenance", {
        headers: { authorization: "Bearer privacy-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deletedActivities: 500,
      hasMore: true,
    });
    expect(privacyBoundary.run).toHaveBeenCalledWith(expect.any(Date));
  });

  it("rejects an unauthenticated maintenance request", async () => {
    const response = await GET(
      new Request("https://journal.example/api/cron/privacy-maintenance"),
    );

    expect(response.status).toBe(401);
    expect(privacyBoundary.run).not.toHaveBeenCalled();
  });
});
