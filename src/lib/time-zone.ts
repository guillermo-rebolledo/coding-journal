declare const ianaTimeZone: unique symbol;

export type IanaTimeZone = string & { readonly [ianaTimeZone]: true };

export function normalizeTimeZone(value: unknown): IanaTimeZone | null {
  if (typeof value !== "string") return null;

  const timeZone = value.trim();
  if (!timeZone || /^[+-]\d{2}:\d{2}$/.test(timeZone)) return null;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone as IanaTimeZone;
  } catch {
    return null;
  }
}

export function parseDate(value: unknown) {
  if (typeof value !== "string") return null;
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
