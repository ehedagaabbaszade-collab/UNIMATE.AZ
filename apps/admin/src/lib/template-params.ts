import { LOCALES, type Locale } from "@unimate/i18n";

/** `{param}` placeholders, the same syntax as the shared renderer (single braces, no nesting). */
export const placeholders = (text: string): string[] => [...new Set([...text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]!))].sort();

/** Every string leaf of a JSON value (system content bodies). */
export function stringLeaves(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(stringLeaves);
  if (v && typeof v === "object") return Object.values(v).flatMap(stringLeaves);
  return [];
}

export interface ParityIssue {
  locale: Locale;
  missing: string[];
  extra: string[];
}
/** Compares every present locale with the reference (az when present, else the first present). Absent locales are not parity errors. */
export function parityIssues(texts: Partial<Record<Locale, string[]>>): ParityIssue[] {
  const present = LOCALES.filter((l) => texts[l] !== undefined);
  const ref = present.includes("az") ? "az" : present[0];
  if (!ref) return [];
  const want = new Set(texts[ref]!.flatMap(placeholders));
  const out: ParityIssue[] = [];
  for (const l of present) {
    if (l === ref) continue;
    const have = new Set(texts[l]!.flatMap(placeholders));
    const missing = [...want].filter((p) => !have.has(p)).sort();
    const extra = [...have].filter((p) => !want.has(p)).sort();
    if (missing.length || extra.length) out.push({ locale: l, missing, extra });
  }
  return out;
}

export interface MatrixRow {
  key: string;
  has: Record<Locale, boolean>;
  missing: Locale[];
}
/** key -> locale -> present. Keys are sorted; every locale is always listed. */
export function completeness(rows: ReadonlyArray<{ key: string; locale: string }>): MatrixRow[] {
  const by = new Map<string, Set<string>>();
  for (const r of rows) by.set(r.key, (by.get(r.key) ?? new Set()).add(r.locale));
  return [...by.keys()].sort().map((key) => {
    const set = by.get(key)!;
    const has = Object.fromEntries(LOCALES.map((l) => [l, set.has(l)])) as Record<Locale, boolean>;
    return { key, has, missing: LOCALES.filter((l) => !has[l]) };
  });
}

/** Sample values for the live preview; the first one contains characters that the renderer must HTML-escape. */
export const SAMPLE_PARAMS: Readonly<Record<string, string | number>> = { name: "Aysel <b>&</b> Co", count: 3, course: "CS101", title: "Sample", date: "2026-01-15", days: 7, n: 5, xp: 50, streak: 4 };
export const sampleFor = (names: string[]): Record<string, string | number> => Object.fromEntries(names.map((n) => [n, SAMPLE_PARAMS[n] ?? `[${n}]`]));
