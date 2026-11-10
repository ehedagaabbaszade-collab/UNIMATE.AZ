/**
 * CSV export helpers. Formula injection: a string cell that starts with = + - @ (or a tab / carriage return) is prefixed
 * with an apostrophe so spreadsheets show it as text instead of evaluating it. Finite numbers are written as-is.
 */
const FORMULA = /^[=+\-@\t\r]/;
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  let s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (FORMULA.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
export const toCsv = (rows: ReadonlyArray<ReadonlyArray<unknown>>): string => rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
