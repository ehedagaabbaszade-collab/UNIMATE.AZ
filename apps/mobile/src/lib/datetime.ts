import { formatZonedInput, zonedParts, zonedToUtc } from "@unimate/i18n";

/**
 * Parses "YYYY-MM-DD HH:mm" (also "YYYY-MM-DDTHH:mm", or a bare "YYYY-MM-DD" = 00:00) in the app time zone (Asia/Baku), not the device zone.
 * Returns an ISO string, or null when the text is not a real calendar date/time (31 Feb is rejected, not rolled over).
 */
export function parseLocalDateTime(input: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(input.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)];
  if (h > 23 || mi > 59) return null;
  const date = zonedToUtc(y, mo, d, h, mi);
  const back = zonedParts(date);
  if (back.year !== y || back.month !== mo || back.day !== d || back.hour !== h || back.minute !== mi) return null;
  return date.toISOString();
}

/** Inverse of parseLocalDateTime (app time zone). */
export const formatLocalDateTime = (d: Date): string => formatZonedInput(d);

/** "HH:mm" validity (the timetable form). */
export const isTime = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
