import { CV_EMPLOYMENT_TYPES, type CvDescribeKind, type CvDesignSection } from "@unimate/core";
import type { MessageKey } from "@unimate/i18n";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- CV entries are schema-checked on save; the form edits them generically
export type Obj = Record<string, any>;
export type Kind = "text" | "csv" | "lines" | "bool" | "cefr" | "emp";
export interface FieldDef {
  key: string;
  label: MessageKey;
  kind?: Kind;
  multiline?: boolean;
  /** Hidden for entries where this returns true (CEFR levels of a native language). */
  hide?: (it: Obj) => boolean;
}
export interface AiDef {
  kind: CvDescribeKind;
  ctx: (it: Obj) => Record<string, string>;
}
export interface EntrySection {
  key: Exclude<CvDesignSection, "summary" | "skills">;
  fields: FieldDef[];
  make: () => Obj;
  ai?: AiDef;
}
const pick = (it: Obj, keys: string[]) => Object.fromEntries(keys.map((k) => [k, String(it[k] ?? "")]));
export const EMPLOYMENT_OPTIONS = CV_EMPLOYMENT_TYPES;

const F = (key: string, label: MessageKey, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, ...extra });
const DESC = F("description", "career.cv.field.description", { multiline: true });

export const ENTRY_SECTIONS: EntrySection[] = [
  {
    key: "experience",
    fields: [
      F("role", "career.cv.field.role"),
      F("company", "career.cv.field.company"),
      F("employmentType", "cvWeb.field.employmentType", { kind: "emp" }),
      F("location", "career.cv.field.location"),
      F("start", "career.cv.field.start"),
      F("end", "career.cv.field.end", { hide: (it) => !!it.current }),
      F("current", "career.cv.field.current", { kind: "bool" }),
      F("bullets", "cvWeb.field.responsibilities", { kind: "lines" }),
      F("achievements", "cvWeb.field.achievements", { kind: "lines" }),
    ],
    make: () => ({ company: "", role: "", location: "", start: "", end: "", current: false, employmentType: "", bullets: [], achievements: [] }),
    ai: { kind: "experience", ctx: (it) => ({ ...pick(it, ["role", "company", "location"]), dates: `${it.start ?? ""} - ${it.current ? "" : (it.end ?? "")}` }) },
  },
  {
    key: "education",
    fields: [
      F("institution", "career.cv.field.institution"),
      F("degree", "career.cv.field.degree"),
      F("field", "career.cv.field.fieldOfStudy"),
      F("start", "career.cv.field.start"),
      F("end", "career.cv.field.end"),
      F("gpa", "career.cv.field.gpa"),
      F("city", "career.cv.field.city"),
      F("website", "career.cv.field.website"),
      F("eqfLevel", "career.cv.field.eqfLevel"),
      DESC,
    ],
    make: () => ({ institution: "", degree: "", field: "", start: "", end: "", gpa: "", description: "", city: "", website: "", eqfLevel: "" }),
    ai: { kind: "education", ctx: (it) => pick(it, ["institution", "degree", "field"]) },
  },
  {
    key: "languages",
    fields: [
      F("name", "career.cv.field.langName"),
      F("level", "career.cv.field.langLevel", { hide: (it) => !!it.native }),
      F("native", "career.cv.field.native", { kind: "bool" }),
      ...(["listening", "reading", "spokenProduction", "spokenInteraction", "writing"] as const).map((k) => F(k, `career.cv.field.${k}` as MessageKey, { kind: "cefr", hide: (it: Obj) => !!it.native })),
    ],
    make: () => ({ name: "", level: "", native: false, listening: "", reading: "", spokenProduction: "", spokenInteraction: "", writing: "" }),
  },
  {
    key: "certificates",
    fields: [
      F("name", "career.cv.field.certName"),
      F("issuer", "career.cv.field.issuer"),
      F("date", "cvWeb.field.issueDate"),
      F("expiry", "cvWeb.field.expiry"),
      F("credentialUrl", "cvWeb.field.credentialUrl"),
      F("mode", "career.cv.field.mode"),
      DESC,
    ],
    make: () => ({ name: "", issuer: "", year: "", link: "", date: "", expiry: "", credentialUrl: "", mode: "", description: "" }),
    ai: { kind: "certificate", ctx: (it) => pick(it, ["name", "issuer", "date", "mode"]) },
  },
  {
    key: "projects",
    fields: [F("name", "career.cv.field.projectName"), F("role", "cvWeb.field.projectRole"), F("link", "career.cv.field.link"), DESC, F("tech", "cvWeb.field.technologies", { kind: "csv" })],
    make: () => ({ name: "", role: "", link: "", description: "", tech: [] }),
    ai: { kind: "project", ctx: (it) => ({ name: String(it.name ?? ""), tech: (it.tech ?? []).join(", ") }) },
  },
  {
    key: "honours",
    fields: [F("title", "career.cv.field.title"), F("issuer", "career.cv.field.issuer"), F("date", "career.cv.field.date"), DESC],
    make: () => ({ title: "", issuer: "", date: "", description: "" }),
    ai: { kind: "honour", ctx: (it) => pick(it, ["title", "issuer", "date"]) },
  },
  {
    key: "volunteer",
    fields: [
      F("role", "career.cv.field.role"),
      F("organization", "cvWeb.field.organization"),
      F("location", "career.cv.field.location"),
      F("start", "career.cv.field.start"),
      F("end", "career.cv.field.end", { hide: (it) => !!it.current }),
      F("current", "career.cv.field.current", { kind: "bool" }),
      DESC,
    ],
    make: () => ({ role: "", organization: "", location: "", start: "", end: "", current: false, description: "" }),
    ai: { kind: "activity", ctx: (it) => ({ title: String(it.role ?? ""), place: String(it.organization ?? ""), date: `${it.start ?? ""} - ${it.current ? "" : (it.end ?? "")}` }) },
  },
  {
    key: "publications",
    fields: [F("title", "career.cv.field.title"), F("publisher", "cvWeb.field.publisher"), F("date", "career.cv.field.date"), F("link", "career.cv.field.link"), DESC],
    make: () => ({ title: "", publisher: "", date: "", link: "", description: "" }),
  },
  {
    key: "courses",
    fields: [F("name", "career.cv.field.certName"), F("provider", "cvWeb.field.provider"), F("date", "career.cv.field.date"), DESC],
    make: () => ({ name: "", provider: "", date: "", description: "" }),
  },
  {
    key: "activities",
    fields: [F("title", "career.cv.field.title"), F("place", "career.cv.field.place"), F("date", "career.cv.field.date"), DESC],
    make: () => ({ title: "", place: "", date: "", description: "" }),
    ai: { kind: "activity", ctx: (it) => pick(it, ["title", "place", "date"]) },
  },
  {
    key: "hobbies",
    fields: [F("title", "career.cv.field.title"), DESC],
    make: () => ({ title: "", description: "" }),
    ai: { kind: "hobby", ctx: (it) => pick(it, ["title"]) },
  },
  {
    key: "references",
    fields: [
      F("name", "career.cv.field.fullName"),
      F("position", "cvWeb.field.position"),
      F("company", "career.cv.field.company"),
      F("email", "cvWeb.field.email"),
      F("phone", "cvWeb.field.phone"),
      F("note", "cvWeb.field.note"),
      F("onRequest", "cvWeb.field.onRequest", { kind: "bool" }),
    ],
    make: () => ({ name: "", position: "", company: "", email: "", phone: "", note: "", onRequest: false }),
  },
];
