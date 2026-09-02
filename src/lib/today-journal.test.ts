import { describe, expect, it } from "vitest";

import { describeJournalStatus } from "@/lib/today-journal";

describe("journal status description", () => {
  it.each([
    [
      "loading",
      "Final coverage pending",
      "Reconciling today's GitHub activity",
    ],
    ["complete", "Complete coverage", "GitHub activity reconciled"],
    ["partial", "Partial coverage", "Partial GitHub response"],
    ["error", "Provider unavailable", "GitHub reconciliation unavailable"],
  ] as const)("owns the %s prose", (status, completeness, paneTitle) => {
    expect(describeJournalStatus({ status })).toEqual(
      expect.objectContaining({ completeness, paneTitle }),
    );
  });

  it("describes a day that has not started in one place", () => {
    expect(
      describeJournalStatus({
        status: "complete",
        awaitingReconciliation: true,
      }),
    ).toMatchObject({
      emptyTitle: "Your day is ready to refresh",
      paneTitle: "GitHub reconciliation pending",
    });
  });
});
