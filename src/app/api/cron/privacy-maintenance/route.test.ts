// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPrivacyMaintenanceRoute } from "@/app/api/cron/privacy-maintenance/handler";
import type { PrivacyMaintenanceResult } from "@/lib/privacy-maintenance";

const run = vi.fn<(now: Date) => Promise<PrivacyMaintenanceResult>>();
const GET = createPrivacyMaintenanceRoute({ run });

describe("privacy maintenance endpoint", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "privacy-secret");
    run.mockReset().mockResolvedValue({
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
    expect(run).toHaveBeenCalledWith(expect.any(Date));
  });

  it("rejects an unauthenticated maintenance request", async () => {
    const response = await GET(
      new Request("https://journal.example/api/cron/privacy-maintenance"),
    );

    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
});
