/** DİM 2026/2027 college catalog (tables admission_colleges + college_programs). Pure helpers: unit-tested, no React. */
export type ProgramLanguage = "az" | "ru" | "az_ru";
export type StudyFormat = "full_time" | "part_time";

export interface CollegeRow {
  id: string;
  heading: string;
  parent_institution: string | null;
  college_name: string;
}
export interface ProgramRow {
  id: string;
  college_id: string;
  code: string;
  specialty: string;
  division: string | null;
  language: ProgramLanguage;
  study_format: StudyFormat;
  seats: number;
  tuition_azn: number | null;
  state_funded: boolean;
  special_ability: boolean;
  source_page: number;
  needs_verification: boolean;
}

export interface CatalogFilters {
  query: string;
  language: ProgramLanguage | "all";
  format: StudyFormat | "all";
  funding: "all" | "state" | "paid";
  collegeId?: string | undefined;
}
export const NO_FILTERS: CatalogFilters = { query: "", language: "all", format: "all", funding: "all" };

const collator = new Intl.Collator("az", { sensitivity: "base", numeric: true });
/** Case/diacritic-insensitive folding that also treats I/İ/ı/i alike and ə as e (people type without special letters). */
export const fold = (s: string): string =>
  s
    .toLocaleLowerCase("az")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/ə/g, "e");

export function filterPrograms(programs: readonly ProgramRow[], colleges: ReadonlyMap<string, CollegeRow>, f: CatalogFilters): ProgramRow[] {
  const q = fold(f.query.trim());
  return programs
    .filter((p) => {
      if (f.collegeId && p.college_id !== f.collegeId) return false;
      if (f.language !== "all" && p.language !== f.language) return false;
      if (f.format !== "all" && p.study_format !== f.format) return false;
      if (f.funding === "state" && !p.state_funded) return false;
      if (f.funding === "paid" && p.state_funded) return false;
      if (!q) return true;
      const c = colleges.get(p.college_id);
      return [p.specialty, p.code, c?.college_name ?? "", c?.parent_institution ?? ""].some((v) => fold(v).includes(q));
    })
    .sort((a, b) => collator.compare(a.specialty, b.specialty) || a.code.localeCompare(b.code));
}

export interface CollegeSummary extends CollegeRow {
  programs: number;
  seats: number;
}
/** Colleges with program/seat counts for the given (already filtered) programs; colleges with none are dropped. */
export function summarizeColleges(colleges: readonly CollegeRow[], programs: readonly ProgramRow[]): CollegeSummary[] {
  const acc = new Map<string, { programs: number; seats: number }>();
  for (const p of programs) {
    const a = acc.get(p.college_id) ?? { programs: 0, seats: 0 };
    a.programs += 1;
    a.seats += p.seats;
    acc.set(p.college_id, a);
  }
  return colleges
    .filter((c) => acc.has(c.id))
    .map((c) => ({ ...c, ...acc.get(c.id)! }))
    .sort((a, b) => collator.compare(a.college_name, b.college_name) || collator.compare(a.heading, b.heading));
}

/** College line shown in lists: "<college> (<parent>)" when the heading names a parent institution. */
export const collegeLabel = (c: Pick<CollegeRow, "college_name" | "parent_institution">): string => (c.parent_institution ? `${c.college_name} (${c.parent_institution})` : c.college_name);
