import { validateUpload, type FileKind, type UploadError } from "../validation/upload";

/** Pure NOTES (resource library) rules shared by web and mobile. The server (create_resource, bucket limits) is the authority. */
export const NOTE_KINDS = ["note", "past_exam", "slides", "other"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_SORTS = ["newest", "rating", "saves"] as const;
export type NoteSort = (typeof NOTE_SORTS)[number];
export const NOTE_VISIBILITIES = ["university", "public", "private"] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];
export const NOTE_PAGE_SIZE = 20;
export const NOTE_MAX_TAGS = 8;
export const NOTE_TAG_MAX_LEN = 30;
export const NOTE_TITLE_MAX = 200;
export const NOTE_DESCRIPTION_MAX = 2000;
export const NOTE_REVIEW_MAX = 1000;
export const NOTE_REPORT_MIN = 10;
export const NOTE_REPORT_MAX = 4000;

export type NoteStatus = "pending" | "published" | "removed";

const KIND_BY_MIME: Record<string, { ext: string; kind: FileKind }> = {
  "application/pdf": { ext: "pdf", kind: "pdf" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", kind: "docx" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: "pptx", kind: "pptx" },
  "image/png": { ext: "png", kind: "png" },
  "image/jpeg": { ext: "jpg", kind: "jpg" },
};
export const NOTE_MIME_TYPES = Object.keys(KIND_BY_MIME);

export type NoteFileCheck = { ok: true; extension: string; mimeType: string; fileKind: FileKind; suggestedTitle: string } | { ok: false; error: UploadError };

/** Same checks as the documents upload (core validateUpload) but png/jpg are accepted: the `resources` bucket allows them. */
export function precheckNoteFile(input: { name: string; size: number; mimeType: string; head: Uint8Array }): NoteFileCheck {
  const r = validateUpload({ name: input.name, size: input.size, mimeType: input.mimeType, headBytes: input.head });
  if (!r.ok) return { ok: false, error: r.error };
  const suggestedTitle = input.name.replace(/\.[^.]+$/, "").trim().slice(0, NOTE_TITLE_MAX) || input.name.slice(0, NOTE_TITLE_MAX);
  return { ok: true, extension: r.extension, mimeType: r.mimeType, fileKind: r.kind, suggestedTitle };
}

/** "Study with AI" is offered for document types the pipeline can extract (not images). */
export const canStudyWithAi = (mimeType: string | null | undefined): boolean => {
  const k = mimeType ? KIND_BY_MIME[mimeType]?.kind : undefined;
  return k === "pdf" || k === "docx" || k === "pptx";
};

/** Comma/semicolon/newline separated -> lowercase, trimmed, de-duplicated, each <= 30 chars. `tooMany` when over the limit. */
export function parseTags(input: string): { tags: string[]; tooMany: boolean } {
  const seen = new Set<string>();
  for (const raw of input.split(/[,;\n]+/)) {
    const t = raw.trim().replace(/\s+/g, " ").toLocaleLowerCase().slice(0, NOTE_TAG_MAX_LEN);
    if (t) seen.add(t);
  }
  const all = [...seen];
  return { tags: all.slice(0, NOTE_MAX_TAGS), tooMany: all.length > NOTE_MAX_TAGS };
}

export type NoteFormField = "title" | "description" | "file" | "tags" | "kind" | "visibility";
export type NoteFormErrorCode = "title_required" | "title_too_long" | "description_too_long" | "file_required" | "too_many_tags" | "kind_invalid" | "visibility_invalid";
export interface NoteFormInput {
  title: string;
  description: string;
  kind: string;
  courseId: string;
  visibility: string;
  tagsText: string;
  hasFile: boolean;
}
export type NoteFormResult =
  | { ok: true; value: { title: string; description: string | null; kind: NoteKind; courseId: string | null; visibility: NoteVisibility; tags: string[] } }
  | { ok: false; errors: Partial<Record<NoteFormField, NoteFormErrorCode>> };

export function validateNoteForm(i: NoteFormInput): NoteFormResult {
  const errors: Partial<Record<NoteFormField, NoteFormErrorCode>> = {};
  const title = i.title.trim();
  if (!title) errors.title = "title_required";
  else if (title.length > NOTE_TITLE_MAX) errors.title = "title_too_long";
  const description = i.description.trim();
  if (description.length > NOTE_DESCRIPTION_MAX) errors.description = "description_too_long";
  if (!i.hasFile) errors.file = "file_required";
  const { tags, tooMany } = parseTags(i.tagsText);
  if (tooMany) errors.tags = "too_many_tags";
  if (!(NOTE_KINDS as readonly string[]).includes(i.kind)) errors.kind = "kind_invalid";
  if (!(NOTE_VISIBILITIES as readonly string[]).includes(i.visibility)) errors.visibility = "visibility_invalid";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { title, description: description || null, kind: i.kind as NoteKind, courseId: i.courseId || null, visibility: i.visibility as NoteVisibility, tags },
  };
}

export interface NoteListItem {
  id: string;
  title: string;
  description: string | null;
  kind: NoteKind;
  tags: string[];
  courseId: string | null;
  courseCode: string | null;
  courseTitle: string | null;
  universityName: string | null;
  uploaderId: string;
  uploaderName: string | null;
  avgRating: number;
  ratingCount: number;
  saveCount: number;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  saved: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);

/** Maps a `search_resources` row defensively (numeric columns arrive as strings from PostgREST). */
export function mapSearchRow(r: Record<string, unknown>): NoteListItem {
  const kind = (NOTE_KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as NoteKind) : "other";
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    description: str(r.description),
    kind,
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
    courseId: str(r.course_id),
    courseCode: str(r.course_code),
    courseTitle: str(r.course_title),
    universityName: str(r.university_name),
    uploaderId: String(r.uploader_id ?? ""),
    uploaderName: str(r.uploader_name),
    avgRating: num(r.avg_rating),
    ratingCount: num(r.rating_count),
    saveCount: num(r.save_count),
    mimeType: str(r.mime_type),
    sizeBytes: r.size_bytes === null || r.size_bytes === undefined ? null : num(r.size_bytes),
    createdAt: String(r.created_at ?? ""),
    saved: r.saved === true,
  };
}

/** Status shown to the uploader: a pending row held by a copyright report reads "under review", not "waiting for approval". */
export type NoteStatusView = "pending" | "published" | "removed" | "under_review";
export const noteStatusView = (status: NoteStatus, takedownHold: boolean): NoteStatusView => (status === "pending" && takedownHold ? "under_review" : status);

export const courseLabel = (c: { code: string | null; title: string | null }): string => [c.code, c.title].filter(Boolean).join(" · ");
