declare const ianaTimeZone: unique symbol;

export type IanaTimeZone = string & { readonly [ianaTimeZone]: true };

/**
 * Narrows a candidate to a time zone the platform can actually format with.
 * A fixed UTC offset is rejected: it names an instant's offset, not the zone
 * whose rules decide when a user's day starts and ends.
 */
export function isIanaTimeZone(value: string | null): value is IanaTimeZone {
  if (value === null) return false;
  if (value !== value.trim() || value.length === 0) return false;
  if (/^[+-]\d{2}:\d{2}$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(value: string | null): IanaTimeZone | null {
  const timeZone = value === null ? null : value.trim();
  return isIanaTimeZone(timeZone) ? timeZone : null;
}

/** Decodes an ISO-8601 instant that has already been read as a string. */
export function parseDate(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type LocalDayWindow = {
  localDate: string;
  startsAt: Date;
  endsAt: Date;
};

function addCalendarDay(localDate: string) {
  const next = new Date(`${localDate}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function firstInstantOnOrAfter(localDate: string, timeZone: string) {
  const approximateMidnight = Date.parse(`${localDate}T00:00:00.000Z`);
  let low = approximateMidnight - 36 * 60 * 60 * 1000;
  let high = approximateMidnight + 36 * 60 * 60 * 1000;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (getLocalDate(new Date(middle), timeZone).iso < localDate) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return new Date(low);
}

export function getLocalDayWindow(now: Date, timeZone: string): LocalDayWindow {
  const localDate = getLocalDate(now, timeZone).iso;

  return getLocalDayWindowForDate(localDate, timeZone);
}

export function getLocalDayWindowForDate(
  localDate: string,
  timeZone: string,
): LocalDayWindow {
  return {
    localDate,
    startsAt: firstInstantOnOrAfter(localDate, timeZone),
    endsAt: firstInstantOnOrAfter(addCalendarDay(localDate), timeZone),
  };
}

export function getFinalizationDueAt(localDate: string, timeZone: string) {
  const nextMidnight = firstInstantOnOrAfter(
    addCalendarDay(localDate),
    timeZone,
  );
  return new Date(nextMidnight.getTime() + 6 * 60 * 60 * 1000);
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
