import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CvDataSchema,
  CvDesignSchema,
  CvDocumentInputSchema,
  parseCvDesign,
  type CvDesign,
  OPPORTUNITY_PAGE_SIZE,
  mapOpportunityDetail,
  mapOpportunityRow,
  mapTrackingRow,
  parseCvData,
  type CvData,
  type CvDocumentInput,
  type CvLanguage,
  type CvTemplateId,
  type OpportunityDetail,
  type OpportunityKind,
  type OpportunityListItem,
  type OpportunitySort,
  type TrackStatus,
  type TrackedItem,
} from "@unimate/core";

/**
 * Data access for CAREER. Everything goes through RLS-protected tables or the RPCs of migration 20260101004310; students
 * only ever see published listings and their own CVs/tracker. Nothing here submits an application anywhere.
 * (Identical copy lives in the web app.)
 */
export class CareerApiError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "CareerApiError";
  }
}
const ok = <T>(res: { data: T | null; error: { message: string; code?: string } | null }): T => {
  if (res.error) throw new CareerApiError(res.error.message, res.error.code);
  return res.data as T;
};

export interface OpportunityFilters {
  q: string;
  kind: OpportunityKind | "";
  location: string;
  remoteOnly: boolean;
  /** Days from today; 0 = no limit. */
  closingInDays: 0 | 7 | 30;
  skills: string;
  sort: OpportunitySort;
  includeExpired: boolean;
}
export const DEFAULT_FILTERS: OpportunityFilters = { q: "", kind: "", location: "", remoteOnly: false, closingInDays: 0, skills: "", sort: "deadline", includeExpired: false };
export const splitSkills = (s: string): string[] => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 30);
const addDays = (today: string, n: number): string => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function searchOpportunities(sb: SupabaseClient, f: OpportunityFilters, offset: number, today: string): Promise<OpportunityListItem[]> {
  const skills = splitSkills(f.skills);
  const rows = ok(
    await sb.rpc("search_opportunities", {
      p_q: f.q.trim() || null,
      p_kind: f.kind || null,
      p_location: f.location.trim() || null,
      p_remote: f.remoteOnly ? true : null,
      p_deadline_before: f.closingInDays ? addDays(today, f.closingInDays) : null,
      p_skills: skills.length ? skills : null,
      p_sort: f.sort,
      p_limit: OPPORTUNITY_PAGE_SIZE,
      p_offset: offset,
      p_include_expired: f.includeExpired,
    }),
  ) as Array<Record<string, unknown>> | null;
  return (rows ?? []).map(mapOpportunityRow);
}

export async function getOpportunity(sb: SupabaseClient, id: string): Promise<OpportunityDetail | null> {
  return mapOpportunityDetail(ok(await sb.rpc("get_opportunity", { p_id: id })));
}

// ------------------------------------------------------------------ tracker
export async function trackOpportunity(sb: SupabaseClient, opportunityId: string, status: TrackStatus = "saved", notes?: string): Promise<string> {
  return ok(await sb.rpc("track_opportunity", { p_opportunity_id: opportunityId, p_status: status, p_notes: notes ?? null })) as string;
}
export async function myTracking(sb: SupabaseClient): Promise<TrackedItem[]> {
  const rows = ok(await sb.rpc("my_opportunity_tracking")) as Array<Record<string, unknown>> | null;
  return (rows ?? []).map(mapTrackingRow);
}
/** Only status and notes are writable (column grants + RLS). */
export async function updateTracking(sb: SupabaseClient, trackingId: string, patch: { status?: TrackStatus; notes?: string }): Promise<void> {
  ok(await sb.from("opportunity_tracking").update(patch).eq("id", trackingId));
}
export async function removeTracking(sb: SupabaseClient, trackingId: string): Promise<void> {
  ok(await sb.from("opportunity_tracking").delete().eq("id", trackingId));
}

// ------------------------------------------------------------------ CV documents
export interface CvListItem {
  id: string;
  title: string;
  language: CvLanguage;
  template: CvTemplateId;
  updatedAt: string;
  design: CvDesign;
  isDefault: boolean;
}
export interface CvDoc extends CvListItem {
  data: CvData;
}
export async function listCvs(sb: SupabaseClient): Promise<CvListItem[]> {
  const rows = ok(await sb.from("cv_documents").select("id,title,language,template,updated_at,design,is_default").order("updated_at", { ascending: false })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    language: r.language as CvLanguage,
    template: r.template as CvTemplateId,
    updatedAt: String(r.updated_at),
    design: parseCvDesign(r.design),
    isDefault: r.is_default === true,
  }));
}
export async function getCv(sb: SupabaseClient, id: string): Promise<CvDoc | null> {
  const r = ok(await sb.from("cv_documents").select("id,title,language,template,updated_at,data,design,is_default").eq("id", id).maybeSingle<Record<string, unknown>>());
  if (!r) return null;
  const parsed = parseCvData(r.data);
  return {
    id: String(r.id),
    title: String(r.title),
    language: r.language as CvLanguage,
    template: r.template as CvTemplateId,
    updatedAt: String(r.updated_at),
    design: parseCvDesign(r.design),
    isDefault: r.is_default === true,
    data: parsed.ok ? parsed.data : CvDataSchema.parse({}),
  };
}
export type CvSaveError = "invalid" | "too_large" | "limit" | "failed";
export type CvSaveResult = { ok: true; id: string } | { ok: false; error: CvSaveError };
const checkInput = (input: CvDocumentInput): CvSaveError | null => {
  if (!CvDocumentInputSchema.safeParse(input).success) return "invalid";
  const size = parseCvData(input.data);
  return size.ok ? null : size.error;
};
export async function createCv(sb: SupabaseClient, userId: string, input: CvDocumentInput, design: CvDesign = {}): Promise<CvSaveResult> {
  const bad = checkInput(input);
  if (bad) return { ok: false, error: bad };
  const res = await sb.from("cv_documents").insert({ user_id: userId, ...input, design }).select("id").single<{ id: string }>();
  if (res.error) return { ok: false, error: res.error.code === "54000" ? "limit" : "failed" };
  return { ok: true, id: res.data.id };
}
/** Copies title ("<title> (<suffix>)"), data, design and template into a new CV. The 10-CV cap surfaces as error "limit" (errcode 54000). */
export async function duplicateCv(sb: SupabaseClient, userId: string, id: string, copySuffix: string): Promise<CvSaveResult> {
  const src = await getCv(sb, id);
  if (!src) return { ok: false, error: "failed" };
  const title = `${src.title.slice(0, 120 - copySuffix.length - 3)} (${copySuffix})`;
  return createCv(sb, userId, { title, language: src.language, template: src.template, data: src.data }, src.design);
}
export async function renameCv(sb: SupabaseClient, id: string, title: string): Promise<boolean> {
  const t = title.trim().slice(0, 120);
  if (!t) return false;
  return !(await sb.from("cv_documents").update({ title: t }).eq("id", id)).error;
}
/** Only the design column (a template switch or a style tweak made outside the editor). */
export async function saveDesign(sb: SupabaseClient, id: string, design: CvDesign): Promise<boolean> {
  if (!CvDesignSchema.safeParse(design).success) return false;
  return !(await sb.from("cv_documents").update({ design }).eq("id", id)).error;
}
export async function setDefaultCv(sb: SupabaseClient, id: string): Promise<void> {
  ok(await sb.rpc("set_default_cv", { p_id: id }));
}
export async function saveCv(sb: SupabaseClient, id: string, input: CvDocumentInput): Promise<CvSaveResult> {
  const bad = checkInput(input);
  if (bad) return { ok: false, error: bad };
  const res = await sb.from("cv_documents").update(input).eq("id", id);
  return res.error ? { ok: false, error: "failed" } : { ok: true, id };
}
export async function deleteCv(sb: SupabaseClient, id: string): Promise<void> {
  ok(await sb.from("cv_documents").delete().eq("id", id));
}
/** Skills from all of the user's CVs (deduplicated by the matching functions). */
export async function myCvSkills(sb: SupabaseClient): Promise<string[]> {
  const rows = ok(await sb.from("cv_documents").select("data")) as Array<{ data: { skills?: unknown } | null }>;
  // skills are strings (legacy) or { name, level?, kind? } objects (since migration 005800)
  const name = (s: unknown) => (typeof s === "string" ? s : s && typeof s === "object" && typeof (s as { name?: unknown }).name === "string" ? (s as { name: string }).name : null);
  return rows.flatMap((r) => (Array.isArray(r.data?.skills) ? (r.data!.skills as unknown[]).map(name).filter((s): s is string => s !== null) : []));
}
