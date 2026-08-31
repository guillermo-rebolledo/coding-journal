export function normalizeTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const timeZone = value.trim();
  if (!timeZone) return null;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return null;
  }
}

export function getLocalDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );

  return {
    iso: `${values.year}-${values.month}-${values.day}`,
    long: new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(now),
  };
}
