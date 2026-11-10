import type { University } from "./db";

/** Azerbaijani collation: ç ə ğ ı ö ş ü sort in their alphabet positions, not after z. */
const collator = new Intl.Collator("az", { sensitivity: "base", numeric: true });

export interface InstitutionGroups {
  universities: University[];
  colleges: University[];
}

/** Splits the directory into universities/academies and colleges, each sorted in Azerbaijani alphabetical order. */
export function groupInstitutions(list: readonly University[]): InstitutionGroups {
  const byName = (a: University, b: University) => collator.compare(a.name, b.name);
  return {
    universities: list.filter((u) => u.institution_type !== "college").sort(byName),
    colleges: list.filter((u) => u.institution_type === "college").sort(byName),
  };
}

/** Option label: colleges show their parent institution when the ministry lists one (many colleges share generic names). */
export function institutionLabel(u: University): string {
  return u.institution_type === "college" && u.affiliated_with ? `${u.name} (${u.affiliated_with})` : u.name;
}

/** Locale-insensitive search helper: lower-cases with the az locale (I/İ, ı/i) and strips combining marks. */
const fold = (s: string) => s.toLocaleLowerCase("az").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");

/** Filters by name, short name, city or parent institution. Empty query keeps everything. */
export function filterInstitutions(list: readonly University[], query: string): University[] {
  const q = fold(query.trim());
  if (!q) return [...list];
  return list.filter((u) => [u.name, u.short_name ?? "", u.city ?? "", u.affiliated_with ?? ""].some((f) => fold(f).includes(q)));
}
