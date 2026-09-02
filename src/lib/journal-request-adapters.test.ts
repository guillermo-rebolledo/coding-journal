// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const cookieStore = {
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(cookieStore),
}));

import { chooseJournalRequestAdapters } from "@/lib/journal-request-adapters";
import { normalizeTimeZone } from "@/lib/time-zone";

describe("journal request adapter chooser", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    cookieStore.set.mockReset();
    cookieStore.delete.mockReset();
  });

  it("selects the complete fixture boundary once from the request cookie", async () => {
    vi.stubEnv("E2E_AUTH_MODE", "true");
    const headers = new Headers({
      cookie: "coding-journal-e2e-session=all",
    });

    const adapters = chooseJournalRequestAdapters(headers);
    const session = await adapters.session(headers);

    expect(adapters.fixture).toBe(true);
    expect(session?.user.id).toBe("e2e-all");
    await expect(adapters.onboarding.read("e2e-all", headers)).resolves.toEqual(
      {
        timeZone: "America/Mexico_City",
        githubAccessMode: "app",
      },
    );
    await expect(adapters.installations("e2e-all")).resolves.toHaveLength(1);
    await expect(
      adapters.reconciliation.read({
        userId: "e2e-all",
        timeZone: "America/Mexico_City",
      }),
    ).resolves.toMatchObject({ journal: { status: "complete" } });
    await expect(
      adapters.summary.findBySnapshotHash("e2e-all", "snapshot"),
    ).resolves.toBeNull();
    await expect(adapters.finalization.list("e2e-all")).resolves.toHaveLength(
      1,
    );
    await expect(
      adapters.guard("journal-refresh", "e2e-all", new Date()),
    ).resolves.toEqual({ proceed: true });
  });

  it("keeps the onboarding cookie inside the fixture onboarding adapter", async () => {
    vi.stubEnv("E2E_AUTH_MODE", "true");
    const headers = new Headers({
      cookie: "coding-journal-e2e-session=onboarding",
    });
    const adapters = chooseJournalRequestAdapters(headers);

    const timeZone = normalizeTimeZone("Europe/Madrid");
    if (!timeZone) throw new Error("Expected a valid fixture time zone");
    await adapters.onboarding.saveTimeZone("e2e-onboarding", timeZone);
    await adapters.onboarding.chooseBestEffort("e2e-onboarding");

    expect(cookieStore.set).toHaveBeenNthCalledWith(
      1,
      "coding-journal-e2e-onboarding",
      "time-zone",
      expect.any(Object),
    );
    expect(cookieStore.set).toHaveBeenNthCalledWith(
      2,
      "coding-journal-e2e-onboarding",
      "complete",
      expect.any(Object),
    );
  });
});
