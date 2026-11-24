import { CvDocumentInputSchema, CvEducationSchema, parseCvDesign, type CvData, type CvDesign, type CvLanguage, type CvTemplateId } from "@unimate/core";

// Pure helpers for the mobile CV editor (history, reorder, profile import, autosave outcome, file names, orphan photos).
// shortcut: a few of these duplicate the web editor's helpers; move to packages/core once both settle.

export const HISTORY_MAX = 100;
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}
export const historyInit = <T>(present: T): History<T> => ({ past: [], present, future: [] });
/** Pushes a new state (ignored when identical by reference); drops the redo branch and caps the undo stack. */
export function historyPush<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_MAX), present: next, future: [] };
}
export function historyUndo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] };
}
export function historyRedo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) };
}

/** Moves item i one step (-1 up, +1 down); out-of-range moves return the same array. */
export function moveItem<T>(list: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
export const toggleIn = <T>(list: readonly T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
export const isHex = (s: string): boolean => HEX_RE.test(s.trim());

export const IMPORT_FIELDS = ["fullName", "email", "phone"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** Copies ticked fields from the user's own account into personal details. Empty fields only, unless overwrite is ticked. Blank sources are never copied. */
export function mergeImport(data: CvData, source: Partial<Record<ImportField, string>>, picked: readonly ImportField[], overwrite: boolean): CvData {
  const personal = { ...data.personal };
  for (const k of picked) {
    const v = (source[k] ?? "").trim();
    if (v && (overwrite || !personal[k].trim())) personal[k] = v;
  }
  return { ...data, personal };
}

/** Adds the profile's university (and major) as an Education entry unless the CV already lists that institution. Never touches existing entries. */
export function mergeEducation(data: CvData, edu: { institution: string; field: string }, max = 30): CvData {
  const inst = edu.institution.trim();
  if (!inst || data.education.length >= max || data.education.some((e) => e.institution.trim().toLowerCase() === inst.toLowerCase())) return data;
  return { ...data, education: [...data.education, CvEducationSchema.parse({ institution: inst, field: edu.field.trim().slice(0, 160) })] };
}

export type SaveOutcome = { kind: "saved"; updatedAt: string } | { kind: "conflict" } | { kind: "offline" } | { kind: "error" };
/** Interprets an update ... where updated_at = <expected> ... returning updated_at. Zero rows = someone else saved first. */
export function classifySave(res: { data: Array<{ updated_at: string }> | null; error: { message: string } | null }): SaveOutcome {
  if (res.error) return /network|fetch|offline|timed? ?out|failed to load/i.test(res.error.message) ? { kind: "offline" } : { kind: "error" };
  const row = res.data?.[0];
  return row ? { kind: "saved", updatedAt: row.updated_at } : { kind: "conflict" };
}

/** Safe PDF file name from a CV title (letters of any script, digits, dashes). */
export function pdfFileName(title: string): string {
  const base = title.normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${base || "CV"}.pdf`;
}

/** cv-photos objects to delete when the editor closes: every upload/initial photo that neither the saved CV nor a kept local draft still uses. */
export function orphanPaths(known: Iterable<string>, keep: ReadonlyArray<string | undefined>): string[] {
  const k = new Set(keep.filter((x): x is string => !!x));
  return [...new Set(known)].filter((p) => p && !k.has(p));
}

export const draftKey = (uid: string, cvId: string) => `um.cvDraft.${uid}.${cvId}`;

/** Everything the editor edits (and undo/redo snapshots). */
export interface CvDocState {
  title: string;
  language: CvLanguage;
  template: CvTemplateId;
  design: CvDesign;
  data: CvData;
}
/** Local offline draft: only used while the server row is still at the version the draft was based on. */
export const serializeDraft = (baseUpdatedAt: string, doc: CvDocState): string => JSON.stringify({ baseUpdatedAt, doc });
export function parseDraft(raw: string | null, baseUpdatedAt: string): CvDocState | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { baseUpdatedAt?: unknown; doc?: Record<string, unknown> };
    if (j.baseUpdatedAt !== baseUpdatedAt || !j.doc) return null;
    const r = CvDocumentInputSchema.safeParse(j.doc);
    return r.success ? { ...r.data, design: parseCvDesign(j.doc.design) } : null;
  } catch {
    return null;
  }
}
