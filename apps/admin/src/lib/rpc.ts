import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { RpcError, toRpcError } from "./errors";
import { AI_PLANS, AI_TASKS, AI_TIERS } from "./ai-config";
import { APP_ROLES } from "./guard";

/**
 * Typed wrappers around the admin RPCs and the few RLS-protected table reads. Everything runs with the signed-in
 * user's JWT through the anon client; every response is validated with zod (a malformed row becomes BAD_RESPONSE,
 * never a crash or a silently wrong table). Authorization is NOT decided here: the database re-checks the role.
 */
export interface Page<T> {
  rows: T[];
  total: number;
}
export const PAGE_SIZE = 25;

const num = z.coerce.number();
const nullableStr = z.string().nullable();
const role = z.enum(APP_ROLES);
const planName = z.enum(["free", "plus", "pro"]);

export const userRow = z.object({
  id: z.string(),
  display_name: nullableStr,
  username: nullableStr,
  role,
  university_name: nullableStr,
  plan: planName,
  created_at: z.string(),
  suspended: z.boolean(),
  total: num,
});
export type UserRow = z.infer<typeof userRow>;

export const subscriptionRow = z.object({
  id: z.string(),
  plan: planName,
  status: z.enum(["active", "trialing", "past_due", "canceled", "expired"]),
  source: z.enum(["paid", "manual"]),
  provider: nullableStr,
  current_period_end: nullableStr,
  grant_reason: nullableStr,
  created_at: z.string(),
});
export type SubscriptionRow = z.infer<typeof subscriptionRow>;

export const expiringRow = z.object({
  subscription_id: z.string(),
  user_id: z.string(),
  display_name: nullableStr,
  plan: planName,
  status: z.enum(["active", "trialing", "past_due", "canceled", "expired"]),
  source: z.enum(["paid", "manual"]),
  current_period_end: z.string(),
  overdue: z.boolean(),
  total: num,
});
export type ExpiringRow = z.infer<typeof expiringRow>;

export const counters = z.object({
  open_reports: num,
  open_takedowns: num,
  pending_resources: num,
  pending_events: num,
  users_total: num.optional(),
  users_suspended: num.optional(),
  expiring_subscriptions_7d: num.optional(),
  overdue_subscriptions: num.optional(),
  unverified_institutions: num.optional(),
});
export type Counters = z.infer<typeof counters>;

const docStatusRow = z.array(z.object({ status: z.string(), n: num }));
const jobRow = z.array(z.object({ kind: z.string(), state: z.string(), n: num }));
const planCountRow = z.array(z.object({ plan: planName, source: z.string(), n: num }));

export const reportRow = z.object({
  report_id: z.string(),
  target_kind: z.enum(["post", "comment", "resource", "user", "community"]),
  target_id: z.string(),
  category: z.string(),
  reason: z.string(),
  status: z.enum(["open", "reviewing", "actioned", "dismissed"]),
  created_at: z.string(),
  excerpt: z.string(),
  total: num,
});
export type ReportRow = z.infer<typeof reportRow>;
export const removedRow = z.object({ id: z.string(), title: z.string(), updated_at: z.string(), total: num });
export type RemovedRow = z.infer<typeof removedRow>;
export const communityRow = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  visibility: z.string(),
  members: num,
  open_reports: num,
  created_at: z.string(),
  total: num,
});
export type CommunityRow = z.infer<typeof communityRow>;

export const takedownRow = z.object({
  id: z.string(),
  reason: z.string(),
  created_at: z.string(),
  resource: z.object({ id: z.string(), title: z.string() }).nullable(),
});
export type TakedownRow = z.infer<typeof takedownRow>;
export const pendingResourceRow = z.object({ id: z.string(), title: z.string(), kind: z.string(), description: nullableStr, created_at: z.string(), takedown_hold: z.boolean().nullable().optional() });
export type PendingResourceRow = z.infer<typeof pendingResourceRow>;
export const pendingEventRow = z.object({ id: z.string(), title: z.string(), starts_at: z.string(), location: nullableStr, created_at: z.string() });
export type PendingEventRow = z.infer<typeof pendingEventRow>;

export const institutionRow = z.object({
  id: z.string(),
  name: z.string(),
  short_name: nullableStr,
  city: nullableStr,
  institution_type: z.enum(["university", "college"]),
  ownership: z.enum(["state", "private"]),
  source: z.enum(["edu.gov.az", "wikipedia", "user_supplied_unverified", "admin_verified"]),
  affiliated_with: nullableStr,
});
export type InstitutionRow = z.infer<typeof institutionRow>;
export const facultyRow = z.object({ id: z.string(), university_id: z.string(), name: z.string() });
export type FacultyRow = z.infer<typeof facultyRow>;
export const majorRow = z.object({ id: z.string(), faculty_id: z.string(), name: z.string(), degree_level: z.enum(["bachelor", "master", "phd"]) });
export type MajorRow = z.infer<typeof majorRow>;
export const courseRow = z.object({ id: z.string(), university_id: z.string(), major_id: nullableStr, code: z.string(), title: z.string(), credits: z.coerce.number().nullable() });
export type CourseRow = z.infer<typeof courseRow>;

export const organizationRow = z.object({ id: z.string(), name: z.string(), description: nullableStr, website: nullableStr, verified: z.boolean() });
export type OrganizationRow = z.infer<typeof organizationRow>;
export const opportunityRow = z.object({
  id: z.string(),
  organization_id: z.string(),
  kind: z.string(),
  title: z.string(),
  description: nullableStr,
  requirements: nullableStr,
  location: nullableStr,
  remote: z.boolean(),
  deadline: nullableStr,
  apply_url: z.string(),
  skills: z.array(z.string()),
  languages: z.array(z.string()),
  status: z.enum(["draft", "published", "archived"]),
  source_note: nullableStr,
  organizations: z.object({ name: z.string() }).nullable().optional(),
});
export type OpportunityRow = z.infer<typeof opportunityRow>;

export const promptRow = z.object({ id: z.string(), name: z.string(), version: num, template: z.string(), model: nullableStr, is_active: z.boolean(), created_at: z.string() });
export type PromptRow = z.infer<typeof promptRow>;

// ---- part 2 rows
export const providerRow = z.object({ id: z.string(), name: z.string(), kind: z.enum(["openai", "anthropic"]), enabled: z.boolean(), base_url_label: nullableStr, updated_at: z.string() });
export type ProviderRow = z.infer<typeof providerRow>;
export const modelRow = z.object({
  id: z.string(),
  provider_id: z.string(),
  model: z.string(),
  tier: z.enum(AI_TIERS),
  input_micro_usd_per_mtok: num,
  output_micro_usd_per_mtok: num,
  cached_input_micro_usd_per_mtok: num,
  enabled: z.boolean(),
  approved_fallback: z.boolean(),
  max_output_tokens: num,
});
export type ModelRow = z.infer<typeof modelRow>;
export const routeRow = z.object({ id: z.string(), task: z.enum(AI_TASKS), plan: z.enum(AI_PLANS), primary_model_id: z.string(), fallback_model_ids: z.array(z.string()), rate_limit_per_min: num });
export type RouteRow = z.infer<typeof routeRow>;
export const budgetRow = z.object({ id: z.string(), scope: z.enum(["user", "plan", "global"]), key: z.string(), period: z.enum(["day", "month"]), hard_limit_micro_usd: num });
export type BudgetRow = z.infer<typeof budgetRow>;
export const configVersionRow = z.object({
  version: num,
  snapshot: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  action: z.string(),
  actor_id: nullableStr,
  reason: nullableStr,
  created_at: z.string(),
});
export type ConfigVersionRow = z.infer<typeof configVersionRow>;
export const costBucketRow = z.object({ bucket: z.string(), requests: num, input_tokens: num, output_tokens: num, cached_input_tokens: num, cost_micro_usd: num });
export type CostBucketRow = z.infer<typeof costBucketRow>;
export const topSpenderRow = z.object({ user_id: z.string(), requests: num, cost_micro_usd: num });
export type TopSpenderRow = z.infer<typeof topSpenderRow>;
export const utilisationRow = z.object({
  scope: z.enum(["user", "plan", "global"]),
  key: z.string(),
  period: z.enum(["day", "month"]),
  period_start: z.string(),
  hard_limit_micro_usd: num,
  spent_micro_usd: num,
  reserved_micro_usd: num,
  utilisation_pct: z.coerce.number().nullable(),
});
export type UtilisationRow = z.infer<typeof utilisationRow>;
export const failureRateRow = z.object({ task: z.string(), requests: num, failed_billable: num, failed_unbilled: num, fallback_used: num });
export type FailureRateRow = z.infer<typeof failureRateRow>;
export const stuckRow = z.object({ request_id: z.string(), user_id: z.string(), task: nullableStr, estimate_micro_usd: num, age_minutes: num });
export type StuckRow = z.infer<typeof stuckRow>;
export const activeUsersRow = z.object({ day: z.string(), dau: num, wau: num });
export const learningRow = z.object({ day: z.string(), quizzes_taken: num, flashcards_reviewed: num, study_minutes: num, documents_uploaded: num });
export const cohortRow = z.object({ cohort_week: z.string(), cohort_size: num, week_offset: num, active: num });
export type CohortRow = z.infer<typeof cohortRow>;
export const auditRow = z.object({ id: num, actor_id: nullableStr, action: z.string(), entity_type: nullableStr, entity_id: nullableStr, metadata: z.record(z.string(), z.unknown()), created_at: z.string() });
export type AuditRow = z.infer<typeof auditRow>;
export const configRow = z.object({ key: z.string(), value: z.unknown(), updated_at: z.string() });
export type ConfigRow = z.infer<typeof configRow>;
export const configHistoryRow = z.object({ id: num, key: z.string(), value: z.unknown(), action: z.enum(["insert", "update", "delete"]), reason: nullableStr, actor_id: nullableStr, created_at: z.string() });
export type ConfigHistoryRow = z.infer<typeof configHistoryRow>;
export const templateRow = z.object({ key: z.string(), locale: z.string(), title: z.string(), body: nullableStr, updated_at: z.string() });
export type TemplateRow = z.infer<typeof templateRow>;
export const templateVersionRow = z.object({ id: num, key: z.string(), locale: z.string(), title: z.string(), body: nullableStr, reason: nullableStr, actor_id: nullableStr, created_at: z.string() });
export type TemplateVersionRow = z.infer<typeof templateVersionRow>;
export const contentRow = z.object({ key: z.string(), locale: z.string(), body: z.unknown(), version: num, updated_at: z.string() });
export type ContentRow = z.infer<typeof contentRow>;
export const contentVersionRow = z.object({ id: num, key: z.string(), locale: z.string(), version: num, body: z.unknown(), reason: nullableStr, actor_id: nullableStr, created_at: z.string() });
export type ContentVersionRow = z.infer<typeof contentVersionRow>;
export const jobFailureRow = z.object({ id: z.string(), document_id: z.string(), kind: z.string(), state: z.enum(["failed", "dead"]), attempts: num, max_attempts: num, last_error: z.string(), updated_at: z.string(), total: num });
export type JobFailureRow = z.infer<typeof jobFailureRow>;
export interface AuditFilter {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  from: string;
  to: string;
}

/** Runs `sb.rpc` and validates the payload. */
export async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw toRpcError(error);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new RpcError("BAD_RESPONSE");
  return parsed.data;
}

async function rpcPage<S extends z.ZodType<{ total: number }>>(sb: SupabaseClient, fn: string, args: Record<string, unknown>, row: S): Promise<Page<z.infer<S>>> {
  const rows = await rpc(sb, fn, args, z.array(row));
  return { rows, total: rows[0]?.total ?? 0 };
}

/** Escapes % _ \ so a search term is literal inside ilike. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const range = (page: number) => ({ from: page * PAGE_SIZE, to: page * PAGE_SIZE + PAGE_SIZE - 1 });

async function readPage<S extends z.ZodTypeAny>(
  q: PromiseLike<{ data: unknown; error: { code?: string } | null; count: number | null }>,
  schema: S,
): Promise<Page<z.infer<S>>> {
  const { data, error, count } = await q;
  if (error) throw toRpcError(error);
  const parsed = z.array(schema).safeParse(data);
  if (!parsed.success) throw new RpcError("BAD_RESPONSE");
  return { rows: parsed.data, total: count ?? parsed.data.length };
}

const voidRpc = z.unknown();
const idRpc = z.string();
const boolRpc = z.boolean();

export function createAdminApi(sb: SupabaseClient) {
  const off = (page: number) => ({ p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE });
  return {
    // ---- overview
    counters: () => rpc(sb, "admin_overview_counters", {}, counters),
    documentsByStatus: () => rpc(sb, "admin_documents_by_status", {}, docStatusRow),
    jobsByState: () => rpc(sb, "admin_jobs_by_state", {}, jobRow),
    // ---- users
    listUsers: (search: string, page: number) => rpcPage(sb, "admin_list_users", { p_search: search.trim() || null, ...off(page) }, userRow),
    userSubscriptions: (userId: string) => rpc(sb, "admin_user_subscriptions", { p_user_id: userId }, z.array(subscriptionRow)),
    setRole: (userId: string, newRole: string, reason: string) => rpc(sb, "admin_set_role", { p_user_id: userId, p_role: newRole, p_reason: reason }, voidRpc),
    grantPlan: (userId: string, plan: string, until: string | null, reason: string) =>
      rpc(sb, "admin_grant_plan", { p_user_id: userId, p_plan: plan, p_until: until, p_reason: reason }, z.string().nullable()),
    setSuspended: (userId: string, suspended: boolean, reason: string) => rpc(sb, "admin_set_user_suspended", { p_user_id: userId, p_suspended: suspended, p_reason: reason }, boolRpc),
    // ---- subscriptions
    expiring: (days: number, page: number) => rpcPage(sb, "admin_expiring_subscriptions", { p_days: days, ...off(page) }, expiringRow),
    subscriptionsByPlan: () => rpc(sb, "admin_subscriptions_by_plan", {}, planCountRow),
    runExpiry: () => rpc(sb, "admin_run_subscription_expiry", {}, num),
    // ---- moderation
    reports: (status: string, page: number) => rpcPage(sb, "admin_reports_queue", { p_status: status, ...off(page) }, reportRow),
    resolveReport: (id: string, status: "reviewing" | "actioned" | "dismissed", note: string) => rpc(sb, "admin_resolve_report", { p_report_id: id, p_status: status, p_note: note }, voidRpc),
    moderateContent: (kind: string, id: string, action: "remove" | "restore", reason: string) => rpc(sb, "admin_moderate_content", { p_kind: kind, p_id: id, p_action: action, p_reason: reason }, boolRpc),
    reviewContent: (kind: string, id: string, action: "approve" | "reject", reason: string) => rpc(sb, "admin_review_content", { p_kind: kind, p_id: id, p_action: action, p_reason: reason }, boolRpc),
    moderateEvent: (id: string, approve: boolean) => rpc(sb, "moderate_event", { p_event: id, p_approve: approve }, z.string()),
    resolveTakedown: (id: string, decision: "accepted" | "rejected", reason: string) => rpc(sb, "admin_resolve_takedown", { p_id: id, p_decision: decision, p_reason: reason }, voidRpc),
    removed: (kind: "resource" | "event", page: number) => rpcPage(sb, "admin_removed_content", { p_kind: kind, ...off(page) }, removedRow),
    communities: (search: string, page: number) => rpcPage(sb, "admin_communities_overview", { p_search: search.trim() || null, ...off(page) }, communityRow),
    takedowns: (page: number) => {
      const { from, to } = range(page);
      return readPage(
        sb.from("takedown_requests").select("id,reason,created_at,resource:resources(id,title)", { count: "exact" }).eq("status", "open").order("created_at").range(from, to),
        takedownRow,
      );
    },
    pendingResources: (page: number) => {
      const { from, to } = range(page);
      return readPage(sb.from("resources").select("id,title,kind,description,created_at,takedown_hold", { count: "exact" }).eq("status", "pending").order("created_at").range(from, to), pendingResourceRow);
    },
    pendingEvents: (page: number) => {
      const { from, to } = range(page);
      return readPage(sb.from("events").select("id,title,starts_at,location,created_at", { count: "exact" }).eq("status", "pending").order("created_at").range(from, to), pendingEventRow);
    },
    // ---- academic (reads are public by RLS; writes go through audited admin RPCs)
    institutions: (search: string, unverifiedOnly: boolean, page: number) => {
      const { from, to } = range(page);
      let q = sb.from("universities").select("id,name,short_name,city,institution_type,ownership,source,affiliated_with", { count: "exact" });
      if (search.trim()) q = q.ilike("name", `%${likeEscape(search.trim())}%`);
      if (unverifiedOnly) q = q.eq("source", "user_supplied_unverified");
      return readPage(q.order("name").range(from, to), institutionRow);
    },
    institutionOptions: async () => (await readPage(sb.from("universities").select("id,name,short_name,city,institution_type,ownership,source,affiliated_with", { count: "exact" }).order("name").range(0, 499), institutionRow)).rows,
    faculties: (universityId: string, page: number) => {
      const { from, to } = range(page);
      return readPage(sb.from("faculties").select("id,university_id,name", { count: "exact" }).eq("university_id", universityId).order("name").range(from, to), facultyRow);
    },
    facultyOptions: async (universityId: string) =>
      (await readPage(sb.from("faculties").select("id,university_id,name", { count: "exact" }).eq("university_id", universityId).order("name").range(0, 499), facultyRow)).rows,
    majorOptions: async (universityId: string) =>
      (await readPage(sb.from("majors").select("id,faculty_id,name,degree_level,faculties!inner(university_id)", { count: "exact" }).eq("faculties.university_id", universityId).order("name").range(0, 499), majorRow)).rows,
    majors: (facultyId: string, page: number) => {
      const { from, to } = range(page);
      return readPage(sb.from("majors").select("id,faculty_id,name,degree_level", { count: "exact" }).eq("faculty_id", facultyId).order("name").range(from, to), majorRow);
    },
    courses: (universityId: string, search: string, page: number) => {
      const { from, to } = range(page);
      let q = sb.from("courses").select("id,university_id,major_id,code,title,credits", { count: "exact" }).eq("university_id", universityId);
      if (search.trim()) q = q.or(`code.ilike.%${likeEscape(search.trim()).replace(/[,()]/g, " ")}%,title.ilike.%${likeEscape(search.trim()).replace(/[,()]/g, " ")}%`);
      return readPage(q.order("code").range(from, to), courseRow);
    },
    upsertInstitution: (v: { id: string | null; name: string; shortName: string | null; city: string | null; type: string; ownership: string; affiliated: string | null; reason: string }) =>
      rpc(sb, "admin_upsert_university", { p_id: v.id, p_name: v.name, p_short_name: v.shortName, p_city: v.city, p_type: v.type, p_ownership: v.ownership, p_affiliated_with: v.affiliated, p_reason: v.reason }, idRpc),
    verifyInstitution: (id: string, reason: string) => rpc(sb, "admin_verify_university", { p_id: id, p_reason: reason }, boolRpc),
    upsertFaculty: (v: { id: string | null; universityId: string; name: string; reason: string }) =>
      rpc(sb, "admin_upsert_faculty", { p_id: v.id, p_university_id: v.universityId, p_name: v.name, p_reason: v.reason }, idRpc),
    upsertMajor: (v: { id: string | null; facultyId: string; name: string; degree: string; reason: string }) =>
      rpc(sb, "admin_upsert_major", { p_id: v.id, p_faculty_id: v.facultyId, p_name: v.name, p_degree_level: v.degree, p_reason: v.reason }, idRpc),
    upsertCourse: (v: { id: string | null; universityId: string; majorId: string | null; code: string; title: string; credits: number | null; reason: string }) =>
      rpc(sb, "admin_upsert_course", { p_id: v.id, p_university_id: v.universityId, p_major_id: v.majorId, p_code: v.code, p_title: v.title, p_credits: v.credits, p_reason: v.reason }, idRpc),
    deleteAcademic: (kind: "university" | "faculty" | "major" | "course", id: string, reason: string) => rpc(sb, "admin_delete_academic", { p_kind: kind, p_id: id, p_reason: reason }, boolRpc),
    // ---- career
    organizations: (search: string, page: number) => {
      const { from, to } = range(page);
      let q = sb.from("organizations").select("id,name,description,website,verified", { count: "exact" });
      if (search.trim()) q = q.ilike("name", `%${likeEscape(search.trim())}%`);
      return readPage(q.order("name").range(from, to), organizationRow);
    },
    organizationOptions: async () => (await readPage(sb.from("organizations").select("id,name,description,website,verified", { count: "exact" }).order("name").range(0, 499), organizationRow)).rows,
    opportunities: (status: string, page: number) => {
      const { from, to } = range(page);
      let q = sb
        .from("opportunities")
        .select("id,organization_id,kind,title,description,requirements,location,remote,deadline,apply_url,skills,languages,status,source_note,organizations(name)", { count: "exact" });
      if (status) q = q.eq("status", status);
      return readPage(q.order("created_at", { ascending: false }).range(from, to), opportunityRow);
    },
    upsertOrganization: (v: { id: string | null; name: string; description: string | null; website: string | null; verified: boolean }) =>
      rpc(sb, "admin_upsert_organization", { p_id: v.id, p_name: v.name, p_description: v.description, p_website: v.website, p_logo_path: null, p_verified: v.verified }, idRpc),
    upsertOpportunity: (v: { id: string | null; organizationId: string; kind: string; title: string; description: string | null; requirements: string | null; location: string | null; remote: boolean; deadline: string | null; applyUrl: string; skills: string[]; languages: string[]; sourceNote: string | null }) =>
      rpc(
        sb,
        "admin_upsert_opportunity",
        { p_id: v.id, p_organization_id: v.organizationId, p_kind: v.kind, p_title: v.title, p_description: v.description, p_requirements: v.requirements, p_location: v.location, p_remote: v.remote, p_deadline: v.deadline, p_apply_url: v.applyUrl, p_skills: v.skills, p_languages: v.languages, p_source_note: v.sourceNote },
        idRpc,
      ),
    setOpportunityStatus: (id: string, status: "draft" | "published" | "archived", reason: string | null) => rpc(sb, "admin_set_opportunity_status", { p_id: id, p_status: status, p_reason: reason }, boolRpc),
    deleteOpportunity: (id: string, reason: string) => rpc(sb, "admin_delete_opportunity", { p_id: id, p_reason: reason }, boolRpc),
    // ---- prompts
    prompts: (page: number) => {
      const { from, to } = range(page);
      return readPage(sb.from("prompt_versions").select("id,name,version,template,model,is_active,created_at", { count: "exact" }).order("name").order("version", { ascending: false }).range(from, to), promptRow);
    },
    createPrompt: (v: { name: string; template: string; model: string | null; activate: boolean; reason: string }) =>
      rpc(sb, "admin_create_prompt_version", { p_name: v.name, p_template: v.template, p_model: v.model, p_activate: v.activate, p_reason: v.reason }, idRpc),
    activatePrompt: (id: string) => rpc(sb, "admin_activate_prompt_version", { p_id: id }, voidRpc),
    // ---- AI config (reads: admin-only RLS; every write is a reason-carrying audited RPC)
    providers: async () => (await readPage(sb.from("ai_providers").select("id,name,kind,enabled,base_url_label,updated_at", { count: "exact" }).order("name").range(0, 199), providerRow)).rows,
    models: async () =>
      (await readPage(sb.from("ai_models").select("id,provider_id,model,tier,input_micro_usd_per_mtok,output_micro_usd_per_mtok,cached_input_micro_usd_per_mtok,enabled,approved_fallback,max_output_tokens", { count: "exact" }).order("model").range(0, 499), modelRow)).rows,
    routes: async () => (await readPage(sb.from("ai_task_routes").select("id,task,plan,primary_model_id,fallback_model_ids,rate_limit_per_min", { count: "exact" }).range(0, 199), routeRow)).rows,
    budgets: async () => (await readPage(sb.from("ai_budgets").select("id,scope,key,period,hard_limit_micro_usd", { count: "exact" }).order("scope").order("key").range(0, 499), budgetRow)).rows,
    setProvider: (v: { name: string; kind: string; enabled: boolean; baseUrlLabel: string | null; reason: string }) =>
      rpc(sb, "admin_ai_set_provider", { p_name: v.name, p_kind: v.kind, p_enabled: v.enabled, p_base_url_label: v.baseUrlLabel, p_reason: v.reason }, idRpc),
    setModel: (v: { providerId: string; model: string; tier: string; input: number; output: number; cached: number; maxOutputTokens: number; enabled: boolean; approvedFallback: boolean; reason: string }) =>
      rpc(
        sb,
        "admin_ai_set_model",
        { p_provider_id: v.providerId, p_model: v.model, p_tier: v.tier, p_input: v.input, p_output: v.output, p_cached: v.cached, p_max_output_tokens: v.maxOutputTokens, p_enabled: v.enabled, p_approved_fallback: v.approvedFallback, p_reason: v.reason },
        idRpc,
      ),
    setRoute: (v: { task: string; plan: string; primary: string; fallbacks: string[]; rateLimit: number; reason: string }) =>
      rpc(sb, "admin_ai_set_route", { p_task: v.task, p_plan: v.plan, p_primary_model_id: v.primary, p_fallback_model_ids: v.fallbacks, p_rate_limit_per_min: v.rateLimit, p_reason: v.reason }, idRpc),
    deleteRoute: (task: string, plan: string, reason: string) => rpc(sb, "admin_ai_delete_route", { p_task: task, p_plan: plan, p_reason: reason }, boolRpc),
    setBudget: (v: { scope: string; key: string; period: string; limit: number; reason: string }) =>
      rpc(sb, "admin_ai_set_budget", { p_scope: v.scope, p_key: v.key, p_period: v.period, p_hard_limit_micro_usd: v.limit, p_reason: v.reason }, idRpc),
    deleteBudget: (scope: string, key: string, period: string, reason: string) => rpc(sb, "admin_ai_delete_budget", { p_scope: scope, p_key: key, p_period: period, p_reason: reason }, boolRpc),
    /** One extra row is fetched so the UI can diff each version against the one before it. */
    configVersions: (page: number) => {
      const { from, to } = range(page);
      return readPage(sb.from("config_versions").select("version,snapshot,action,actor_id,reason,created_at", { count: "exact" }).order("version", { ascending: false }).range(from, to + 1), configVersionRow);
    },
    revertConfig: (version: number, reason: string) => rpc(sb, "admin_revert_config", { p_version: version, p_reason: reason }, num),
    // ---- AI cost (aggregates only; ids are opaque)
    costBreakdown: (days: number, group: "day" | "model" | "provider" | "task" | "plan") => rpc(sb, "admin_ai_cost_breakdown", { p_days: days, p_group: group }, z.array(costBucketRow)),
    topSpenders: (days: number) => rpc(sb, "admin_ai_top_spenders", { p_days: days, p_limit: 10 }, z.array(topSpenderRow)),
    budgetUtilisation: () => rpc(sb, "admin_ai_budget_utilisation", {}, z.array(utilisationRow)),
    failureRates: (days: number) => rpc(sb, "admin_ai_failure_rates", { p_days: days }, z.array(failureRateRow)),
    stuckReservations: (minutes: number) => rpc(sb, "admin_ai_stuck_reservations", { p_minutes: minutes }, z.array(stuckRow)),
    sweepReservations: (minutes: number, reason: string) => rpc(sb, "admin_ai_sweep_reservations", { p_minutes: minutes, p_reason: reason }, num),
    // ---- analytics (aggregates only)
    activeUsers: (days: number) => rpc(sb, "admin_active_users", { p_days: days }, z.array(activeUsersRow)),
    learningMetrics: (days: number) => rpc(sb, "admin_learning_metrics", { p_days: days }, z.array(learningRow)),
    retention: (weeks: number) => rpc(sb, "admin_retention_cohorts", { p_weeks: weeks }, z.array(cohortRow)),
    // ---- audit log (append-only; admin RLS select)
    auditLogs: (f: AuditFilter, page: number) => {
      const { from, to } = range(page);
      let q = sb.from("audit_logs").select("id,actor_id,action,entity_type,entity_id,metadata,created_at", { count: "exact" });
      if (f.actor) q = q.eq("actor_id", f.actor);
      if (f.action) q = q.ilike("action", `${likeEscape(f.action)}%`);
      if (f.entityType) q = q.eq("entity_type", f.entityType);
      if (f.entityId) q = q.eq("entity_id", f.entityId);
      if (f.from) q = q.gte("created_at", f.from);
      if (f.to) q = q.lt("created_at", f.to);
      return readPage(q.order("id", { ascending: false }).range(from, to), auditRow);
    },
    // ---- system config
    systemConfig: async () => (await readPage(sb.from("system_config").select("key,value,updated_at", { count: "exact" }).order("key").range(0, 199), configRow)).rows,
    systemConfigHistory: (key: string, page: number) => {
      const { from, to } = range(page);
      return readPage(sb.from("system_config_versions").select("id,key,value,action,reason,actor_id,created_at", { count: "exact" }).eq("key", key).order("id", { ascending: false }).range(from, to), configHistoryRow);
    },
    setSystemConfig: (key: string, value: unknown, reason: string) => rpc(sb, "admin_set_system_config", { p_key: key, p_value: value, p_reason: reason }, num),
    revertSystemConfig: (versionId: number, reason: string) => rpc(sb, "admin_revert_system_config", { p_version_id: versionId, p_reason: reason }, num),
    // ---- notification templates + system content
    templates: async () => (await readPage(sb.from("notification_templates").select("key,locale,title,body,updated_at", { count: "exact" }).order("key").range(0, 999), templateRow)).rows,
    templateVersions: async (key: string, locale: string) =>
      (await readPage(sb.from("notification_template_versions").select("id,key,locale,title,body,reason,actor_id,created_at", { count: "exact" }).eq("key", key).eq("locale", locale).order("id", { ascending: false }).range(0, 19), templateVersionRow)).rows,
    saveTemplate: (v: { key: string; locale: string; title: string; body: string | null; reason: string }) =>
      rpc(sb, "admin_set_notification_template", { p_key: v.key, p_locale: v.locale, p_title: v.title, p_body: v.body, p_reason: v.reason }, idRpc),
    revertTemplate: (versionId: number, reason: string) => rpc(sb, "admin_revert_notification_template", { p_version_id: versionId, p_reason: reason }, idRpc),
    contents: async () => (await readPage(sb.from("system_content").select("key,locale,body,version,updated_at", { count: "exact" }).order("key").range(0, 999), contentRow)).rows,
    contentVersions: async (key: string, locale: string) =>
      (await readPage(sb.from("system_content_versions").select("id,key,locale,version,body,reason,actor_id,created_at", { count: "exact" }).eq("key", key).eq("locale", locale).order("version", { ascending: false }).range(0, 19), contentVersionRow)).rows,
    saveContent: (v: { key: string; locale: string; body: unknown; reason: string }) => rpc(sb, "admin_set_system_content", { p_key: v.key, p_locale: v.locale, p_body: v.body, p_reason: v.reason }, num),
    revertContent: (key: string, locale: string, version: number, reason: string) => rpc(sb, "admin_revert_system_content", { p_key: key, p_locale: locale, p_version: version, p_reason: reason }, num),
    // ---- document processing
    processingFailures: (state: "failed" | "dead" | null, page: number) => rpcPage(sb, "admin_processing_failures", { p_state: state, ...off(page) }, jobFailureRow),
    requeueJob: (id: string, reason: string) => rpc(sb, "admin_requeue_job", { p_job_id: id, p_reason: reason }, boolRpc),
  };
}
export type AdminApi = ReturnType<typeof createAdminApi>;
