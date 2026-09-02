/**
 * The decoding boundary for JSON that arrives from outside the product:
 * GitHub webhook deliveries, GitHub REST responses, and queue messages.
 *
 * A route decodes a request body once with `isJsonObject`, and everything
 * downstream navigates the result with the readers below instead of asserting
 * a payload into an expected type and checking representations as it goes.
 * Every reader returns `null` when the field is missing or is not the
 * requested kind, so an extractor reads like the contract it enforces and a
 * malformed payload fails at the field that is actually wrong.
 *
 * The representation checks live here and nowhere else. They read the internal
 * class tag, which — unlike `typeof` — distinguishes a plain object from the
 * other things `typeof` calls `"object"`, and they are expressed as type
 * predicates so a caller that passes one holds a checked value rather than a
 * cast one.
 */

/** Any value `JSON.parse` can produce. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A decoded JSON object, the only thing the readers below can traverse. */
export type JsonObject = { readonly [key: string]: JsonValue };

/** A member read out of a `JsonObject`, which may simply be absent. */
type JsonMember = JsonValue | undefined;

function isJsonString(value: JsonMember): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function isJsonNumber(value: JsonMember): value is number {
  return Object.prototype.toString.call(value) === "[object Number]";
}

function isJsonBoolean(value: JsonMember): value is boolean {
  return Object.prototype.toString.call(value) === "[object Boolean]";
}

/**
 * Decodes a value produced by `JSON.parse` as an object. Arrays and `null` are
 * excluded, which is the distinction `typeof value === "object"` fails to make.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return (
    Object.prototype.toString.call(value) === "[object Object]" &&
    !Array.isArray(value)
  );
}

/** Reads a member as a nested object, or `null` when it is anything else. */
export function readObject(
  source: JsonObject | null,
  key: string,
): JsonObject | null {
  if (source === null) return null;
  const value = source[key];
  return isJsonObject(value) ? value : null;
}

/** Reads a member as a string, or `null` when it is missing or another kind. */
export function readString(
  source: JsonObject | null,
  key: string,
): string | null {
  if (source === null) return null;
  const value = source[key];
  return isJsonString(value) ? value : null;
}

/**
 * Reads a member as a string with surrounding space removed, rejecting one
 * that is empty once trimmed.
 */
export function readNonEmptyString(
  source: JsonObject | null,
  key: string,
): string | null {
  const value = readString(source, key);
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Reads a member as a finite number, or `null` when it is anything else. */
export function readNumber(
  source: JsonObject | null,
  key: string,
): number | null {
  if (source === null) return null;
  const value = source[key];
  if (!isJsonNumber(value)) return null;
  return Number.isFinite(value) ? value : null;
}

/**
 * Reads a member as a GitHub identifier: a safe positive integer. GitHub
 * numbers every entity it exposes that way, so a value outside that range is
 * malformed rather than merely unexpected.
 */
export function readPositiveInteger(
  source: JsonObject | null,
  key: string,
): number | null {
  const value = readNumber(source, key);
  if (value === null) return null;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Reads a member as a boolean, or `null` when it is missing or another kind. */
export function readBoolean(
  source: JsonObject | null,
  key: string,
): boolean | null {
  if (source === null) return null;
  const value = source[key];
  return isJsonBoolean(value) ? value : null;
}

/**
 * Reads a member as a flat map of text values — GitHub's permission set is the
 * one contract in this codebase shaped that way. Returns `null` when any value
 * is not text, so a caller never inspects a partially decoded map.
 */
export function readStringRecord(
  source: JsonObject | null,
  key: string,
): Record<string, string> | null {
  const object = readObject(source, key);
  if (object === null) return null;
  const entries: Array<[string, string]> = [];
  for (const name of Object.keys(object)) {
    const value = readString(object, name);
    if (value === null) return null;
    entries.push([name, value]);
  }
  return Object.fromEntries(entries);
}

/** Reads a member as an array of JSON values, or `null` when it is not one. */
export function readArray(
  source: JsonObject | null,
  key: string,
): readonly JsonValue[] | null {
  if (source === null) return null;
  const value = source[key];
  return Array.isArray(value) ? value : null;
}

/**
 * Reads a member as an array of objects, dropping entries that are not
 * objects — GitHub list payloads occasionally carry `null` placeholders.
 */
export function readObjectArray(
  source: JsonObject | null,
  key: string,
): readonly JsonObject[] | null {
  const values = readArray(source, key);
  if (values === null) return null;
  return values.filter((entry) => isJsonObject(entry));
}

/** Decodes a standalone value as a string, for array members and roots. */
export function asString(value: JsonMember): string | null {
  return isJsonString(value) ? value : null;
}
