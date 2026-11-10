import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CAMPUS_PAGE_SIZE,
  campusErrorKey,
  mapCommentRow,
  mapCommunityListItem,
  mapEventRow,
  mapPostCard,
  type CampusErrorKey,
  type CampusLanguage,
  type CampusProfile,
  type CampusSearchResult,
  type CommentRow,
  type CommunityDetail,
  type CommunityKind,
  type CommunityListItem,
  type EventRow,
  type MemberRow,
  type ModQueueRow,
  type PostCard,
  type PostKind,
  type ReportCategory,
  type ReportTarget,
  type RsvpStatus,
} from "@unimate/core";

/**
 * Data access for CAMPUS. Everything goes through the RPCs of migration 20260101004400 (the server enforces visibility,
 * blocks, anonymity, rate limits and text rules); nothing here trusts the client. (Identical copy lives in the web app.)
 */
export class CampusApiError extends Error {
  readonly key: CampusErrorKey;
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "CampusApiError";
    this.key = campusErrorKey(message);
  }
}
const ok = <T>(res: { data: T | null; error: { message: string; code?: string } | null }): T => {
  if (res.error) throw new CampusApiError(res.error.message, res.error.code);
  return res.data as T;
};
const rowsOf = (d: unknown): Array<Record<string, unknown>> => (Array.isArray(d) ? (d as Array<Record<string, unknown>>) : []);

export interface Cursor {
  ts: string;
  id: string;
}
export interface FeedOptions {
  limit?: number;
  cursor?: Cursor | null;
  language?: CampusLanguage | "";
  kind?: PostKind | "";
}
const feedArgs = (o: FeedOptions) => ({ p_limit: o.limit ?? CAMPUS_PAGE_SIZE, p_before_ts: o.cursor?.ts ?? null, p_before_id: o.cursor?.id ?? null });
const filters = (o: FeedOptions) => ({ p_language: o.language || null, p_kind: o.kind || null });

// ------------------------------------------------------------------ feeds and posts
export async function homeFeed(sb: SupabaseClient, o: FeedOptions = {}): Promise<PostCard[]> {
  return rowsOf(ok(await sb.rpc("home_feed", { ...feedArgs(o), ...filters(o) }))).map(mapPostCard);
}
export async function communityFeed(sb: SupabaseClient, community: string, o: FeedOptions = {}): Promise<PostCard[]> {
  return rowsOf(ok(await sb.rpc("community_feed", { p_community: community, ...feedArgs(o), ...filters(o) }))).map(mapPostCard);
}
export async function userPosts(sb: SupabaseClient, user: string, o: FeedOptions = {}): Promise<PostCard[]> {
  return rowsOf(ok(await sb.rpc("user_posts", { p_user: user, ...feedArgs(o) }))).map(mapPostCard);
}
export async function getPost(sb: SupabaseClient, id: string): Promise<PostCard | null> {
  const r = rowsOf(ok(await sb.rpc("get_post", { p_post: id })))[0];
  return r ? mapPostCard(r) : null;
}
export async function postComments(sb: SupabaseClient, id: string): Promise<CommentRow[]> {
  return rowsOf(ok(await sb.rpc("post_comments", { p_post: id, p_limit: 200 }))).map(mapCommentRow);
}
export interface NewPost {
  community: string;
  title: string;
  body: string;
  kind: PostKind;
  anonymous: boolean;
  language: CampusLanguage | "";
}
export async function createPost(sb: SupabaseClient, p: NewPost): Promise<string> {
  return ok(await sb.rpc("create_post", { p_community: p.community, p_title: p.title, p_body: p.body, p_kind: p.kind, p_anonymous: p.anonymous, p_language: p.language || null })) as string;
}
export async function editPost(sb: SupabaseClient, id: string, title: string, body: string, language: CampusLanguage | "" = ""): Promise<void> {
  ok(await sb.rpc("edit_post", { p_post: id, p_title: title, p_body: body, p_language: language || null }));
}
export async function deletePost(sb: SupabaseClient, id: string): Promise<void> {
  ok(await sb.rpc("delete_post", { p_post: id }));
}
export async function createComment(sb: SupabaseClient, post: string, body: string, parent: string | null, language: CampusLanguage | "" = ""): Promise<string> {
  return ok(await sb.rpc("create_comment", { p_post: post, p_body: body, p_parent: parent, p_language: language || null })) as string;
}
export async function editComment(sb: SupabaseClient, id: string, body: string): Promise<void> {
  ok(await sb.rpc("edit_comment", { p_comment: id, p_body: body }));
}
export async function deleteComment(sb: SupabaseClient, id: string): Promise<void> {
  ok(await sb.rpc("delete_comment", { p_comment: id }));
}
export interface ReactionState {
  like_count: number;
  helpful_count: number;
  my_like: boolean;
  my_helpful: boolean;
}
export async function react(sb: SupabaseClient, target: "post" | "comment", id: string, kind: "like" | "helpful", on: boolean): Promise<ReactionState> {
  return ok(await sb.rpc("react", { p_target: target, p_id: id, p_kind: kind, p_on: on })) as ReactionState;
}
export async function setAcceptedAnswer(sb: SupabaseClient, post: string, comment: string | null): Promise<void> {
  ok(await sb.rpc("set_accepted_answer", { p_post: post, p_comment: comment }));
}

// ------------------------------------------------------------------ communities
export interface CommunityFilters {
  q: string;
  kind: CommunityKind | "";
  joined: "all" | "joined" | "not";
}
export async function discoverCommunities(sb: SupabaseClient, f: CommunityFilters, offset = 0, limit = 30): Promise<CommunityListItem[]> {
  return rowsOf(
    ok(await sb.rpc("discover_communities", { p_q: f.q.trim() || null, p_kind: f.kind || null, p_joined: f.joined === "all" ? null : f.joined === "joined", p_limit: limit, p_offset: offset })),
  ).map(mapCommunityListItem);
}
export const myCommunities = (sb: SupabaseClient) => discoverCommunities(sb, { q: "", kind: "", joined: "joined" }, 0, 100);
export async function getCommunity(sb: SupabaseClient, id: string): Promise<CommunityDetail | null> {
  const d = ok(await sb.rpc("get_community", { p_community: id })) as Record<string, unknown> | null;
  return d ? ({ ...d, member_count: Number(d.member_count ?? 0), pending_requests: d.pending_requests == null ? null : Number(d.pending_requests) } as unknown as CommunityDetail) : null;
}
export async function communityMembers(sb: SupabaseClient, id: string, status: "active" | "pending" | "banned" = "active", offset = 0): Promise<MemberRow[]> {
  return rowsOf(ok(await sb.rpc("community_members", { p_community: id, p_limit: 50, p_offset: offset, p_status: status }))) as unknown as MemberRow[];
}
export async function joinCommunity(sb: SupabaseClient, id: string): Promise<"active" | "pending"> {
  return ok(await sb.rpc("join_community", { p_community: id })) as "active" | "pending";
}
export async function leaveCommunity(sb: SupabaseClient, id: string): Promise<void> {
  ok(await sb.rpc("leave_community", { p_community: id }));
}
export async function ensureUniversityCommunity(sb: SupabaseClient, university: string, join: boolean): Promise<string> {
  return ok(await sb.rpc("ensure_university_community", { p_university: university, p_join: join })) as string;
}
export async function createCommunity(sb: SupabaseClient, p: { name: string; kind: "faculty" | "course" | "group"; visibility: "public" | "private"; description: string; rules: string }): Promise<string> {
  return ok(await sb.rpc("create_community", { p_name: p.name, p_kind: p.kind, p_visibility: p.visibility, p_description: p.description || null, p_rules: p.rules || null })) as string;
}
export async function updateCommunity(sb: SupabaseClient, id: string, description: string, rules: string): Promise<void> {
  ok(await sb.rpc("update_community", { p_community: id, p_description: description, p_rules: rules }));
}
export async function joinByCode(sb: SupabaseClient, code: string): Promise<string> {
  return ok(await sb.rpc("join_by_code", { p_code: code })) as string;
}
export async function inviteCode(sb: SupabaseClient, community: string, rotate = false): Promise<string | null> {
  return ok(await sb.rpc("get_invite_code", { p_community: community, p_rotate: rotate })) as string | null;
}
export async function reviewJoinRequest(sb: SupabaseClient, community: string, user: string, approve: boolean): Promise<void> {
  ok(await sb.rpc("review_join_request", { p_community: community, p_user: user, p_approve: approve }));
}
export async function setMemberBan(sb: SupabaseClient, community: string, user: string, ban: boolean, reason?: string): Promise<void> {
  ok(await sb.rpc("set_member_ban", { p_community: community, p_user: user, p_ban: ban, p_reason: reason ?? null }));
}
export async function modRemoveContent(sb: SupabaseClient, kind: "post" | "comment", id: string, reason: string): Promise<void> {
  ok(await sb.rpc("mod_remove_content", { p_kind: kind, p_id: id, p_reason: reason }));
}
export async function moderationQueue(sb: SupabaseClient, community: string): Promise<ModQueueRow[]> {
  return rowsOf(ok(await sb.rpc("community_moderation_queue", { p_community: community, p_status: "open", p_limit: 50, p_offset: 0 }))) as unknown as ModQueueRow[];
}
export async function resolveReport(sb: SupabaseClient, report: string, status: "actioned" | "dismissed", note?: string): Promise<void> {
  ok(await sb.rpc("community_resolve_report", { p_report: report, p_status: status, p_note: note ?? null }));
}

// ------------------------------------------------------------------ people, safety, search
export async function campusProfile(sb: SupabaseClient, id: string): Promise<CampusProfile | null> {
  return ok(await sb.rpc("campus_profile", { p_user: id })) as CampusProfile | null;
}
export async function followUser(sb: SupabaseClient, id: string, on: boolean): Promise<void> {
  ok(await sb.rpc(on ? "follow_user" : "unfollow_user", { p_user: id }));
}
export async function blockUser(sb: SupabaseClient, id: string, on: boolean): Promise<void> {
  ok(await sb.rpc(on ? "block_user" : "unblock_user", { p_user: id }));
}
export async function blockedUsers(sb: SupabaseClient): Promise<Array<{ user_id: string; display_name: string | null; username: string | null }>> {
  return rowsOf(ok(await sb.rpc("list_blocked_users"))) as unknown as Array<{ user_id: string; display_name: string | null; username: string | null }>;
}
export async function setDiscoverable(sb: SupabaseClient, value: boolean): Promise<void> {
  ok(await sb.rpc("set_campus_discoverable", { p_value: value }));
}
export async function reportContent(sb: SupabaseClient, kind: ReportTarget, id: string, category: ReportCategory, details: string): Promise<void> {
  ok(await sb.rpc("report_content", { p_kind: kind, p_id: id, p_category: category, p_details: details.trim() || null }));
}
export async function searchCampus(sb: SupabaseClient, q: string): Promise<CampusSearchResult> {
  const r = ok(await sb.rpc("search_campus", { p_q: q, p_limit: 10 })) as Partial<CampusSearchResult> | null;
  return { communities: r?.communities ?? [], posts: r?.posts ?? [], people: r?.people ?? [] };
}

// ------------------------------------------------------------------ events
export type EventScope = "upcoming" | "mine" | "going" | "pending";
export async function listEvents(sb: SupabaseClient, scope: EventScope, community: string | null = null, after?: { ts: string; id: string } | null): Promise<EventRow[]> {
  return rowsOf(ok(await sb.rpc("list_events", { p_scope: scope, p_community: community, p_limit: 30, p_after_ts: after?.ts ?? null, p_after_id: after?.id ?? null }))).map(mapEventRow);
}
export async function getEvent(sb: SupabaseClient, id: string): Promise<EventRow | null> {
  const r = rowsOf(ok(await sb.rpc("get_event", { p_event: id })))[0];
  return r ? mapEventRow(r) : null;
}
export interface NewEvent {
  community: string | null;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string | null;
  capacity: number | null;
  language: CampusLanguage | "";
}
export async function createEvent(sb: SupabaseClient, e: NewEvent): Promise<{ id: string; status: "pending" | "published" }> {
  const id = ok(await sb.rpc("create_event", { p_community: e.community, p_title: e.title, p_starts_at: e.startsAt, p_description: e.description || null, p_location: e.location || null, p_ends_at: e.endsAt, p_capacity: e.capacity, p_language: e.language || null })) as string;
  const ev = await getEvent(sb, id);
  return { id, status: ev?.status === "published" ? "published" : "pending" };
}
export async function editEvent(sb: SupabaseClient, id: string, e: { title: string; description: string; location: string; startsAt: string; endsAt: string | null; capacity: number | null }): Promise<"pending" | "published"> {
  return ok(await sb.rpc("edit_event", { p_event: id, p_title: e.title, p_description: e.description || null, p_location: e.location || null, p_starts_at: e.startsAt, p_ends_at: e.endsAt, p_capacity: e.capacity })) as "pending" | "published";
}
export async function cancelEvent(sb: SupabaseClient, id: string): Promise<void> {
  ok(await sb.rpc("cancel_event", { p_event: id }));
}
export async function moderateEvent(sb: SupabaseClient, id: string, approve: boolean): Promise<void> {
  ok(await sb.rpc("moderate_event", { p_event: id, p_approve: approve }));
}
export async function rsvpEvent(sb: SupabaseClient, id: string, status: RsvpStatus | "none"): Promise<{ going: number; interested: number; my_rsvp: RsvpStatus | null }> {
  return ok(await sb.rpc("rsvp_event", { p_event: id, p_status: status })) as { going: number; interested: number; my_rsvp: RsvpStatus | null };
}
export async function addEventToPlanner(sb: SupabaseClient, id: string): Promise<string> {
  return ok(await sb.rpc("add_event_to_planner", { p_event: id })) as string;
}

/** Local "YYYY-MM-DD HH:MM" (device time zone) to an ISO string, or null when invalid. */
export function parseLocalDateTime(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 ? null : d.toISOString();
}
