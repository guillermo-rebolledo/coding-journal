import { describe, expect, it } from "vitest";

import {
  asString,
  isJsonObject,
  readArray,
  readBoolean,
  readNonEmptyString,
  readNumber,
  readObject,
  readObjectArray,
  readPositiveInteger,
  readString,
} from "@/lib/json-payload";

describe("isJsonObject", () => {
  it("accepts a plain object", () => {
    expect(isJsonObject({ a: 1 })).toBe(true);
  });

  it.each([
    ["an array", []],
    ["null", null],
    ["undefined", undefined],
    ["a string", "text"],
    ["a number", 7],
    ["a boolean", true],
  ])("rejects %s", (_label, value) => {
    expect(isJsonObject(value)).toBe(false);
  });

  it("rejects the things typeof calls an object", () => {
    // The distinction the class tag buys over `typeof value === "object"`.
    expect(isJsonObject([1, 2])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
  });
});

describe("readString", () => {
  const source = { name: "octocat", count: 3, missing: null };

  it("reads a string member", () => {
    expect(readString(source, "name")).toBe("octocat");
  });

  it("returns null for a member of another kind", () => {
    expect(readString(source, "count")).toBeNull();
    expect(readString(source, "missing")).toBeNull();
  });

  it("returns null for an absent member", () => {
    expect(readString(source, "absent")).toBeNull();
  });

  it("returns null when the source is null", () => {
    expect(readString(null, "name")).toBeNull();
  });
});

describe("readNonEmptyString", () => {
  it("trims the value it returns", () => {
    expect(readNonEmptyString({ ref: "  main  " }, "ref")).toBe("main");
  });

  it("rejects a value that is empty once trimmed", () => {
    expect(readNonEmptyString({ ref: "   " }, "ref")).toBeNull();
    expect(readNonEmptyString({ ref: "" }, "ref")).toBeNull();
  });
});

describe("readNumber", () => {
  it("reads a numeric member", () => {
    expect(readNumber({ id: 42 }, "id")).toBe(42);
    expect(readNumber({ id: -1.5 }, "id")).toBe(-1.5);
  });

  it("rejects a numeric string", () => {
    expect(readNumber({ id: "42" }, "id")).toBeNull();
  });
});

describe("readPositiveInteger", () => {
  it("reads a GitHub identifier", () => {
    expect(readPositiveInteger({ id: 42 }, "id")).toBe(42);
  });

  it.each([
    ["zero", 0],
    ["a negative", -3],
    ["a fraction", 1.5],
    ["an unsafe integer", Number.MAX_SAFE_INTEGER + 2],
    ["a string", "42"],
  ])("rejects %s", (_label, value) => {
    expect(readPositiveInteger({ id: value }, "id")).toBeNull();
  });
});

describe("readBoolean", () => {
  it("reads a boolean member, including false", () => {
    expect(readBoolean({ private: false }, "private")).toBe(false);
    expect(readBoolean({ private: true }, "private")).toBe(true);
  });

  it("rejects a truthy value that is not a boolean", () => {
    expect(readBoolean({ private: "true" }, "private")).toBeNull();
  });
});

describe("readObject", () => {
  it("reads a nested object", () => {
    expect(readObject({ repo: { id: 1 } }, "repo")).toEqual({ id: 1 });
  });

  it("rejects an array member", () => {
    expect(readObject({ repo: [] }, "repo")).toBeNull();
  });

  it("chains through an absent parent", () => {
    expect(readString(readObject({}, "repo"), "name")).toBeNull();
  });
});

describe("readArray", () => {
  it("reads an array member", () => {
    expect(readArray({ items: [1, "two"] }, "items")).toEqual([1, "two"]);
  });

  it("rejects a non-array member", () => {
    expect(readArray({ items: {} }, "items")).toBeNull();
  });
});

describe("readObjectArray", () => {
  it("drops entries that are not objects", () => {
    const source = { repositories: [{ id: 1 }, null, "x", { id: 2 }] };
    expect(readObjectArray(source, "repositories")).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  it("returns null when the member is not an array", () => {
    expect(readObjectArray({ repositories: {} }, "repositories")).toBeNull();
  });
});

describe("asString", () => {
  it("decodes a standalone value", () => {
    expect(asString("main")).toBe("main");
    expect(asString(7)).toBeNull();
    expect(asString(undefined)).toBeNull();
  });
});
