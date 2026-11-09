import type { University } from "@/lib/db";

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
