import { describe, expect, it } from "vitest";

import {
  deliveryFamilyForEvent,
  deliveryFamilyForMessage,
  type DeliveryFamily,
} from "@/lib/github-delivery-family";

function family(name: string, event: string): DeliveryFamily {
  return {
    name,
    envelopeKey: name,
    accepts: (candidate) => candidate === event,
    extract: () => ({ ok: false, reason: "no-activity" }),
    parse: (value) =>
      value?.[name] === true
        ? {
            version: 1,
            deliveryId: name,
            installationId: "1",
            receivedAt: "2026-09-02T12:00:00.000Z",
          }
        : null,
    normalize: () => [],
  };
}

describe("GitHub delivery family registry", () => {
  it("dispatches in registry order and ignores unknown input", () => {
    const first = family("first", "shared");
    const second = family("second", "shared");
    const registry = [first, second];

    expect(deliveryFamilyForEvent("shared", registry)).toBe(first);
    expect(deliveryFamilyForMessage({ second: true }, registry)).toEqual({
      family: second,
      message: expect.objectContaining({ deliveryId: "second" }),
    });
    expect(deliveryFamilyForEvent("unknown", registry)).toBeNull();
    expect(deliveryFamilyForMessage({ unknown: true }, registry)).toBeNull();
  });
});
