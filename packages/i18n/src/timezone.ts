/**
 * Time-zone aware calendar helpers. The app's calendar is Asia/Baku (UTC+4) regardless of the device time zone, so a
 * student travelling or a phone set to another zone still sees the same day boundaries as the server and web.
 * Everything uses Intl.DateTimeFormat with `timeZone` (supported by Hermes); the fixed +4h offset is only a last-resort
 * fallback when an engine lacks time zone support (Azerbaijan has had no DST since 2016).
 */
export const APP_TIMEZONE = "Asia/Baku";
const FALLBACK_OFFSET_MS = 4 * 3_600_000;

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  /** ISO weekday, Monday = 1 ... Sunday = 7 */
  isoWeekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat | null {
  let f = formatters.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
      formatters.set(tz, f);
    } catch {
      return null;
    }
  }
  return f;
}

const weekdayOf = (y: number, m: number, d: number): number => ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;

/** Calendar fields of an instant as seen in `tz`. */
export function zonedParts(at: Date | number, tz: string = APP_TIMEZONE): ZonedParts {
  const ms = typeof at === "number" ? at : at.getTime();
  const f = formatter(tz);
  let y: number, mo: number, d: number, h: number, mi: number;
  if (f && typeof f.formatToParts === "function") {
    const parts = f.formatToParts(ms);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    [y, mo, d, h, mi] = [get("year"), get("month"), get("day"), get("hour") % 24, get("minute")] as [number, number, number, number, number];
  } else {
    const s = new Date(ms + FALLBACK_OFFSET_MS);
    [y, mo, d, h, mi] = [s.getUTCFullYear(), s.getUTCMonth() + 1, s.getUTCDate(), s.getUTCHours(), s.getUTCMinutes()];
  }
  return { year: y, month: mo, day: d, hour: h, minute: mi, isoWeekday: weekdayOf(y, mo, d) };
}

/** The instant whose wall-clock time in `tz` is the given fields. Rolls nothing over: callers validate with zonedParts. */
export function zonedToUtc(year: number, month: number, day: number, hour = 0, minute = 0, tz: string = APP_TIMEZONE): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (ms: number) => {
    const p = zonedParts(ms, tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60_000) * 60_000;
  };
  let guess = wall - offsetAt(wall);
  guess = wall - offsetAt(guess); // second pass settles DST edges
  return new Date(guess);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of an instant in `tz`. */
export function zonedDay(at: Date | number, tz: string = APP_TIMEZONE): string {
  const p = zonedParts(at, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Start (00:00) of the calendar day containing `at`, as an instant. */
export function zonedDayStart(at: Date | number, tz: string = APP_TIMEZONE): Date {
  const p = zonedParts(at, tz);
  return zonedToUtc(p.year, p.month, p.day, 0, 0, tz);
}

/** Date-only arithmetic on YYYY-MM-DD strings (no time zone involved, so it cannot shift a calendar date). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Start instant of the calendar day `n` days after the day containing `at` (n may be negative). */
export function zonedDayStartOffset(at: Date | number, n: number, tz: string = APP_TIMEZONE): Date {
  const [y, m, d] = addDays(zonedDay(at, tz), n).split("-").map(Number) as [number, number, number];
  return zonedToUtc(y, m, d, 0, 0, tz);
}

/** "YYYY-MM-DD HH:mm" of an instant in `tz`. */
export function formatZonedInput(at: Date | number, tz: string = APP_TIMEZONE): string {
  const p = zonedParts(at, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}
