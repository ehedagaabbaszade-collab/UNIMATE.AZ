export { todayInBaku } from "../career/career"; // existing Asia/Baku helper (UTC+4, no DST)
export const MIN_AGE = 16;
export const LEGAL_CONSENT_TYPES = {
  required: ["terms", "privacy_notice", "ai_disclaimer"],
  optional: ["marketing"],
} as const;
export const CONSENT_PLATFORMS = ["web", "ios", "android"] as const;

export type YMD = { y: number; m: number; d: number };

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;

export function parseBirthDate(s: string): YMD | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!r) return null;
  const [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null;
  return { y, m, d };
}

/** Full years on `today`; a Feb 29 birthday counts from Mar 1 in non-leap years. */
export function ageOn(birth: YMD, today: YMD): number {
  let age = today.y - birth.y;
  // Feb 29 in a non-leap year never reaches (2,29), so the year is added on Mar 1.
  if (today.m < birth.m || (today.m === birth.m && today.d < birth.d)) age--;
  return age;
}

export function checkBirthDate(s: string, today: string): "ok" | "invalid" | "future" | "underage" {
  const b = parseBirthDate(s);
  const t = parseBirthDate(today);
  if (!b || !t) return "invalid";
  if (s > today) return "future";
  return ageOn(b, t) >= MIN_AGE ? "ok" : "underage";
}
