import { zonedParts, zonedToUtc } from "@unimate/i18n";

/** Parses "YYYY-MM-DD[ T]HH:mm" in the app time zone (Asia/Baku), like mobile. ISO string, or null for non-existent dates. */
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
