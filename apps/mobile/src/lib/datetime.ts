const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Parses "YYYY-MM-DD HH:mm" (also "YYYY-MM-DDTHH:mm", or a bare "YYYY-MM-DD" = 00:00) in the DEVICE time zone.
 * Returns an ISO string, or null when the text is not a real calendar date/time (31 Feb is rejected, not rolled over).
 */
export function parseLocalDateTime(input: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(input.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)];
  if (h > 23 || mi > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h) return null;
  return date.toISOString();
}

/** Inverse of parseLocalDateTime, in local time. */
export function formatLocalDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "HH:mm" validity (the timetable form). */
export const isTime = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
