import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NOTE_PAGE_SIZE,
  mapSearchRow,
  type NoteKind,
  type NoteListItem,
  type NoteSort,
  type NoteStatus,
  type NoteVisibility,
} from "@unimate/core";

/**
 * Data access for NOTES. Every call goes through RLS-protected tables or the SECURITY DEFINER RPCs of migration
 * 20260101004200; the UI never sees the file path or other users' private data. (Identical copy lives in the web app.)
 */
export class NotesApiError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "NotesApiError";
  }
}

const fail = (e: { message: string; code?: string } | null): never => {
  throw new NotesApiError(e?.message ?? "request failed", e?.code);
};
const ok = <T>(res: { data: T | null; error: { message: string; code?: string } | null }): T => {
  if (res.error) return fail(res.error);
  return res.data as T;
};

export interface SearchParams {
  q: string;
  courseId: string;
  kind: NoteKind | "";
  sort: NoteSort;
  offset: number;
  uploaderId?: string;
}

export async function searchNotes(sb: SupabaseClient, p: SearchParams): Promise<NoteListItem[]> {
  const rows = ok(
    await sb.rpc("search_resources", {
      p_q: p.q.trim() || null,
      p_university: null,
      p_course: p.courseId || null,
      p_type: p.kind || null,
      p_sort: p.sort,
      p_limit: NOTE_PAGE_SIZE,
      p_offset: p.offset,
      p_uploader: p.uploaderId ?? null,
    }),
  ) as Array<Record<string, unknown>> | null;
  return (rows ?? []).map(mapSearchRow);
}

export interface Course {
  id: string;
  code: string;
  title: string;
}
export async function listCourses(sb: SupabaseClient, userId: string): Promise<Course[]> {
  const prof = ok(await sb.from("profiles").select("university_id").eq("id", userId).maybeSingle<{ university_id: string | null }>());
  if (!prof?.university_id) return [];
  return ok(await sb.from("courses").select("id,code,title").eq("university_id", prof.university_id).order("code")) as Course[];
}

const COLUMNS =
  "id,uploader_id,title,description,kind,tags,course_id,status,takedown_hold,mime_type,size_bytes,original_filename,avg_rating,rating_count,save_count,created_at,course:courses(code,title),university:universities(name)";

interface RawResource {
  id: string;
  uploader_id: string;
  title: string;
  description: string | null;
  kind: string;
  tags: string[];
  course_id: string | null;
  status: NoteStatus;
  takedown_hold: boolean;
  mime_type: string | null;
  size_bytes: number | null;
  original_filename: string | null;
  avg_rating: number | string;
  rating_count: number;
  save_count: number;
  created_at: string;
  course: { code: string; title: string } | null;
  university: { name: string } | null;
}

export interface NoteDetail extends NoteListItem {
  status: NoteStatus;
  takedownHold: boolean;
  originalFilename: string | null;
}

const toItem = (r: RawResource, saved: boolean): NoteListItem =>
  mapSearchRow({ ...r, course_code: r.course?.code, course_title: r.course?.title, university_name: r.university?.name, saved });

export async function getNote(sb: SupabaseClient, id: string, userId: string): Promise<NoteDetail | null> {
  const r = ok(await sb.from("resources").select(COLUMNS).eq("id", id).maybeSingle<RawResource>());
  if (!r) return null;
  const saved = ok(await sb.from("resource_saves").select("resource_id").eq("resource_id", id).eq("user_id", userId).maybeSingle());
  const item = toItem(r, !!saved);
  const prof = ok(await sb.rpc("get_contributor_profile", { p_user_id: r.uploader_id })) as { display_name: string | null } | null;
  return { ...item, uploaderName: prof?.display_name ?? null, status: r.status, takedownHold: r.takedown_hold, originalFilename: r.original_filename };
}

export interface MyUpload {
  id: string;
  title: string;
  kind: NoteKind;
  status: NoteStatus;
  takedownHold: boolean;
  createdAt: string;
  avgRating: number;
  ratingCount: number;
}
export async function listMyUploads(sb: SupabaseClient, userId: string): Promise<MyUpload[]> {
  const rows = ok(
    await sb.from("resources").select("id,title,kind,status,takedown_hold,created_at,avg_rating,rating_count").eq("uploader_id", userId).order("created_at", { ascending: false }).limit(100),
  ) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    kind: mapSearchRow({ kind: r.kind }).kind,
    status: r.status as NoteStatus,
    takedownHold: r.takedown_hold === true,
    createdAt: String(r.created_at),
    avgRating: Number(r.avg_rating) || 0,
    ratingCount: Number(r.rating_count) || 0,
  }));
}

export async function listSaved(sb: SupabaseClient, userId: string): Promise<NoteListItem[]> {
  const rows = ok(
    await sb.from("resource_saves").select(`created_at,resource:resources!inner(${COLUMNS})`).eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
  ) as unknown as Array<{ resource: RawResource }>;
  return rows.filter((r) => r.resource.status === "published").map((r) => toItem(r.resource, true));
}

export async function setSaved(sb: SupabaseClient, userId: string, resourceId: string, saved: boolean): Promise<void> {
  const res = saved
    ? await sb.from("resource_saves").upsert({ resource_id: resourceId, user_id: userId }, { onConflict: "resource_id,user_id", ignoreDuplicates: true })
    : await sb.from("resource_saves").delete().eq("resource_id", resourceId).eq("user_id", userId);
  if (res.error) fail(res.error);
}

export interface Review {
  userId: string;
  displayName: string | null;
  rating: number;
  comment: string | null;
  createdAt: string;
  isMine: boolean;
}
export async function listReviews(sb: SupabaseClient, resourceId: string): Promise<Review[]> {
  const rows = ok(await sb.rpc("list_resource_reviews", { p_resource_id: resourceId, p_limit: 30, p_offset: 0 })) as Array<Record<string, unknown>> | null;
  return (rows ?? []).map((r) => ({
    userId: String(r.user_id),
    displayName: typeof r.display_name === "string" ? r.display_name : null,
    rating: Number(r.rating),
    comment: typeof r.comment === "string" ? r.comment : null,
    createdAt: String(r.created_at),
    isMine: r.is_mine === true,
  }));
}

export async function rateNote(sb: SupabaseClient, resourceId: string, rating: number, comment: string): Promise<void> {
  const res = await sb.rpc("rate_resource", { p_resource_id: resourceId, p_rating: rating, p_comment: comment.trim() || null });
  if (res.error) fail(res.error);
}

export async function reportCopyright(sb: SupabaseClient, resourceId: string, details: string): Promise<void> {
  const res = await sb.rpc("report_copyright", { p_resource_id: resourceId, p_details: details.trim() });
  if (res.error) fail(res.error);
}

export interface Contributor {
  userId: string;
  displayName: string | null;
  universityName: string | null;
  resourceCount: number;
  totalSaves: number;
  ratingCount: number;
  avgRating: number;
}
export async function getContributor(sb: SupabaseClient, userId: string): Promise<Contributor | null> {
  const p = ok(await sb.rpc("get_contributor_profile", { p_user_id: userId })) as Record<string, unknown> | null;
  if (!p) return null;
  return {
    userId: String(p.user_id),
    displayName: typeof p.display_name === "string" ? p.display_name : null,
    universityName: typeof p.university_name === "string" ? p.university_name : null,
    resourceCount: Number(p.resource_count) || 0,
    totalSaves: Number(p.total_saves) || 0,
    ratingCount: Number(p.rating_count) || 0,
    avgRating: Number(p.avg_rating) || 0,
  };
}

export interface NewNote {
  title: string;
  description: string | null;
  kind: NoteKind;
  courseId: string | null;
  visibility: NoteVisibility;
  tags: string[];
}
/** Uploads the object to the private `resources` bucket, then registers it with create_resource (status starts as pending). */
export async function createNote(
  sb: SupabaseClient,
  userId: string,
  objectId: string,
  file: { bytes: ArrayBuffer | Blob; name: string; mimeType: string; extension: string; size: number },
  note: NewNote,
): Promise<string> {
  const path = `${userId}/${objectId}.${file.extension}`;
  const up = await sb.storage.from("resources").upload(path, file.bytes, { contentType: file.mimeType, upsert: false });
  if (up.error) throw new NotesApiError(up.error.message, undefined);
  const res = await sb.rpc("create_resource", {
    p_title: note.title,
    p_description: note.description,
    p_kind: note.kind,
    p_course_id: note.courseId,
    p_visibility: note.visibility,
    p_tags: note.tags,
    p_storage_path: path,
    p_mime_type: file.mimeType,
    p_size_bytes: file.size,
    p_filename: file.name,
  });
  if (res.error) {
    await sb.storage.from("resources").remove([path]);
    return fail(res.error);
  }
  return res.data as string;
}

/** Deletes the row (RLS: owner) and then the stored object, whose path is read from the owner's own row. */
export async function deleteNote(sb: SupabaseClient, resourceId: string): Promise<void> {
  const row = ok(await sb.from("resources").select("storage_path").eq("id", resourceId).maybeSingle<{ storage_path: string | null }>());
  const del = await sb.from("resources").delete().eq("id", resourceId);
  if (del.error) fail(del.error);
  if (row?.storage_path) await sb.storage.from("resources").remove([row.storage_path]);
}
