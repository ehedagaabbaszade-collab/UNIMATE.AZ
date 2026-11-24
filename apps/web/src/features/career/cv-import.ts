import { CV_SECTION_ITEMS_MAX, type CvData } from "@unimate/core";

/** What the user profile can offer (profiles stores no phone, skills or languages, so none are offered). */
export interface ProfileImport {
  fullName: string;
  email: string;
  university: string;
  major: string;
}
export interface ImportChoice {
  name: boolean;
  email: boolean;
  education: boolean;
  overwrite: boolean;
}
const has = (s: string) => s.trim().length > 0;

/** Merges chosen profile values into the CV. Only empty fields change unless `overwrite`. Never mutates; the profile is never written. */
export function mergeProfileImport(cv: CvData, src: ProfileImport, c: ImportChoice): { data: CvData; changed: number } {
  let changed = 0;
  const personal = { ...cv.personal };
  const set = (k: "fullName" | "email", v: string) => {
    const next = v.trim().slice(0, k === "email" ? 160 : 120);
    if (!has(next) || (has(personal[k]) && !c.overwrite) || personal[k] === next) return;
    personal[k] = next;
    changed++;
  };
  if (c.name) set("fullName", src.fullName);
  if (c.email) set("email", src.email);
  let education = cv.education;
  if (c.education && has(src.university)) {
    const i = education.findIndex((e) => e.institution.trim().toLowerCase() === src.university.trim().toLowerCase());
    const major = src.major.trim().slice(0, 160);
    if (i >= 0) {
      const cur = education[i]!;
      if (has(major) && (!has(cur.field) || (c.overwrite && cur.field !== major))) {
        education = education.map((e, j) => (j === i ? { ...e, field: major } : e));
        changed++;
      }
    } else if (education.length < CV_SECTION_ITEMS_MAX) {
      education = [...education, { institution: src.university.trim().slice(0, 160), degree: "", field: major, start: "", end: "", gpa: "", description: "", city: "", website: "", eqfLevel: "" }];
      changed++;
    }
  }
  return { data: changed ? { ...cv, personal, education } : cv, changed };
}
