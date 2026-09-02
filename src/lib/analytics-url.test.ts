// @vitest-environment node

import { describe, expect, it } from "vitest";

import { sanitizeAnalyticsUrl } from "@/lib/analytics-url";

describe("analytics URLs", () => {
  it("replaces a journal day with its route pattern", () => {
    expect(
      sanitizeAnalyticsUrl(
        "https://journal.example.com/journal/history/2026-08-30",
      ),
    ).toBe("https://journal.example.com/journal/history/[localDate]");
  });

  it("drops the query string and the fragment", () => {
    expect(
      sanitizeAnalyticsUrl(
        "https://journal.example.com/journal?setup=repositories&installation_id=42#today",
      ),
    ).toBe("https://journal.example.com/journal");
  });

  it("keeps an ordinary route intact", () => {
    expect(sanitizeAnalyticsUrl("https://journal.example.com/settings")).toBe(
      "https://journal.example.com/settings",
    );
  });

  it("keeps the landing route addressable", () => {
    expect(sanitizeAnalyticsUrl("https://journal.example.com/")).toBe(
      "https://journal.example.com/",
    );
  });

  it("sends nothing identifying when the URL cannot be parsed", () => {
    expect(sanitizeAnalyticsUrl("journal/history/2026-08-30")).toBe("/");
  });
});
