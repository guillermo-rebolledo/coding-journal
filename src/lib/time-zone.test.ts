import { describe, expect, it } from "vitest";

import { getLocalDate, normalizeTimeZone } from "@/lib/time-zone";

describe("journal time zone", () => {
  it("accepts IANA time zones and rejects invalid values", () => {
    expect(normalizeTimeZone(" America/Mexico_City ")).toBe(
      "America/Mexico_City",
    );
    expect(normalizeTimeZone("Not/A_Time_Zone")).toBeNull();
    expect(normalizeTimeZone(42)).toBeNull();
  });

  it("derives the local date across the spring DST boundary", () => {
    const beforeMidnight = new Date("2026-03-08T07:59:59.000Z");
    const afterMidnight = new Date("2026-03-08T08:00:00.000Z");

    expect(getLocalDate(beforeMidnight, "America/Los_Angeles")).toEqual({
      iso: "2026-03-07",
      long: "Saturday, March 7",
    });
    expect(getLocalDate(afterMidnight, "America/Los_Angeles")).toEqual({
      iso: "2026-03-08",
      long: "Sunday, March 8",
    });
  });

  it("keeps the same local date through the repeated fall DST hour", () => {
    expect(
      getLocalDate(new Date("2026-11-01T08:30:00.000Z"), "America/Los_Angeles"),
    ).toEqual({ iso: "2026-11-01", long: "Sunday, November 1" });
    expect(
      getLocalDate(new Date("2026-11-01T09:30:00.000Z"), "America/Los_Angeles"),
    ).toEqual({ iso: "2026-11-01", long: "Sunday, November 1" });
  });
});
