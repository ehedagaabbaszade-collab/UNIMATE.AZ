/**
 * Pure CAMPUS rules shared by web and mobile. The database (migration 20260101004400) is the authority: these helpers only
 * mirror its limits for instant feedback, thread comments and map errors/notifications to translated UI.
 * User-generated text is never translated; `language` is just the author's optional tag.
 */
export const CAMPUS_LANGUAGES = ["az", "tr", "en", "ru"] as const;
export type CampusLanguage = (typeof CAMPUS_LANGUAGES)[number];
export const COMMUNITY_KINDS = ["university", "faculty", "course", "group"] as const;
export type CommunityKind = (typeof COMMUNITY_KINDS)[number];
export const CREATABLE_COMMUNITY_KINDS = ["faculty", "course", "group"] as const;
export const POST_KINDS = ["post", "question"] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const REPORT_CATEGORIES = ["spam", "harassment", "hate", "misinformation", "inappropriate", "other"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export const REPORT_TARGETS = ["post", "comment", "user", "community"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];
export type RsvpStatus = "going" | "interested";
export const CAMPUS_PAGE_SIZE = 20;
export const CAMPUS_LIMITS = { title: 300, body: 20000, comment: 10000, communityName: 100, description: 1000, rules: 2000, eventTitle: 200, eventDescription: 4000, location: 200, capacity: 10000, commentDepth: 3 } as const;

export interface PostCard {
  id: string;
  community_id: string;
  community_name: string;
  kind: PostKind;
  title: string;
  body: string;
  language: CampusLanguage | null;
  is_anonymous: boolean;
  author_id: string | null;
  author_name: string | null;
  author_username: string | null;
  is_mine: boolean;
  created_at: string;
  edited_at: string | null;
  comment_count: number;
  like_count: number;
  helpful_count: number;
  my_liked: boolean;
  accepted_comment_id: string | null;
  can_moderate: boolean;
}
export interface CommentRow {
  id: string;
  post_id: string;
  parent_id: string | null;
  depth: number;
  author_id: string | null;
  author_name: string | null;
  author_username: string | null;
  is_mine: boolean;
  body: string | null;
  language: CampusLanguage | null;
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  like_count: number;
  helpful_count: number;
  my_liked: boolean;
  my_helpful: boolean;
  is_accepted: boolean;
  /** true for comments written by the post's owner (asker); author fields are null when the post is anonymous. */
  is_op?: boolean;
}
export interface CommentNode extends CommentRow {
  children: CommentNode[];
}
export interface CommunityListItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  kind: CommunityKind;
  visibility: "public" | "private";
  member_count: number;
  my_status: "active" | "pending" | "banned" | null;
  my_role: "member" | "moderator" | "owner" | null;
  university_id: string | null;
}
export interface CommunityDetail {
  id: string;
  name: string;
  slug: string;
  kind: CommunityKind;
  visibility: "public" | "private";
  description: string | null;
  rules: string | null;
  university_id: string | null;
  member_count: number;
  my_status: "active" | "pending" | "banned" | null;
  my_role: "member" | "moderator" | "owner" | null;
  can_moderate: boolean;
  pending_requests: number | null;
}
export interface MemberRow {
  user_id: string;
  display_name: string | null;
  username: string | null;
  role: "member" | "moderator" | "owner";
  status: "active" | "pending" | "banned";
  joined_at: string;
}
export interface EventRow {
  id: string;
  community_id: string | null;
  community_name: string | null;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  capacity: number | null;
  language: CampusLanguage | null;
  status: "pending" | "published" | "removed";
  going_count: number;
  interested_count: number;
  my_rsvp: RsvpStatus | null;
  created_by: string;
  is_mine: boolean;
  can_moderate: boolean;
  in_planner: boolean;
}
export interface ModQueueRow {
  report_id: string;
  target_kind: "post" | "comment" | "community";
  target_id: string;
  category: ReportCategory;
  reason: string;
  status: string;
  created_at: string;
  excerpt: string | null;
  author_id: string | null;
}
export interface CampusProfile {
  id: string;
  display_name: string | null;
  username: string | null;
  university_id: string | null;
  university_name: string | null;
  is_self: boolean;
  discoverable: boolean;
  bio: string | null;
  follower_count: number | null;
  following_count: number | null;
  post_count: number | null;
  is_following: boolean;
}
export interface CampusSearchResult {
  communities: Array<{ id: string; name: string; kind: CommunityKind; visibility: string; description: string | null }>;
  posts: Array<{ id: string; title: string; kind: PostKind; community_id: string; community_name: string; created_at: string; snippet: string }>;
  people: Array<{ id: string; display_name: string | null; username: string | null; university_name: string | null }>;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
export const mapPostCard = (r: Record<string, unknown>): PostCard => ({ ...(r as unknown as PostCard), comment_count: num(r.comment_count), like_count: num(r.like_count), helpful_count: num(r.helpful_count) });
export const mapCommentRow = (r: Record<string, unknown>): CommentRow => ({ ...(r as unknown as CommentRow), depth: num(r.depth), like_count: num(r.like_count), helpful_count: num(r.helpful_count) });
export const mapEventRow = (r: Record<string, unknown>): EventRow => ({ ...(r as unknown as EventRow), going_count: num(r.going_count), interested_count: num(r.interested_count), capacity: r.capacity == null ? null : num(r.capacity) });
export const mapCommunityListItem = (r: Record<string, unknown>): CommunityListItem => ({ ...(r as unknown as CommunityListItem), member_count: num(r.member_count) });

/** Cursor for the next feed page (created_at + id of the last row), or null when the page was short. */
export function nextPostCursor(rows: ReadonlyArray<Pick<PostCard, "created_at" | "id">>, pageSize = CAMPUS_PAGE_SIZE): { ts: string; id: string } | null {
  const last = rows[rows.length - 1];
  return rows.length >= pageSize && last ? { ts: last.created_at, id: last.id } : null;
}

/** Threads the flat, time-ordered comment list. A comment whose parent is not visible (blocked, removed) is promoted to a root. */
export function buildCommentTree(rows: readonly CommentRow[]): CommentNode[] {
  const byId = new Map<string, CommentNode>();
  for (const r of rows) byId.set(r.id, { ...r, children: [] });
  const roots: CommentNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
/** True while another reply level is allowed below this comment (server cap: depth 3). */
export const canReplyTo = (depth: number): boolean => depth < CAMPUS_LIMITS.commentDepth;

/** Mirror of the server's campus_text_ok: plain text only. Returns the problem, or null when the text is fine. */
export function campusTextProblem(text: string): "html" | "link" | "control" | null {
  // eslint-disable-next-line no-control-regex -- intentional: reject/strip control characters
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return "control";
  if (/<\s*\/?\s*(script|iframe|img|a|b|i|u|div|span|p|br|svg|style|link|meta|object|embed|form|input|button|html|body|h[1-6]|ul|ol|li|table|video|audio|source|base)\b/i.test(text) || text.includes("<!--")) return "html";
  if (/(^|[^a-z0-9])(http|ftp|ftps|sftp|file|ws|wss):\/\//i.test(text) || /(^|[^a-z0-9])(javascript|vbscript):/i.test(text) || /(^|[^a-z0-9])data:[a-z]+\//i.test(text)) return "link";
  return null;
}

/** Splits text into plain and https-link parts for rendering (no HTML is ever produced). */
export function linkify(text: string): Array<{ text: string; href?: string }> {
  const out: Array<{ text: string; href?: string }> = [];
  const re = /https:\/\/[^\s<>"']+/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const href = m[0].replace(/[.,;:!?)]+$/, "");
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: href, href });
    last = m.index + href.length;
    re.lastIndex = last;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export type CampusErrorKey = "rateLimited" | "duplicate" | "invalidText" | "notAllowed" | "notFound" | "full" | "banned" | "offline" | "generic";
/** Maps a server/RPC error message to a translated message key (`campus.errors.<key>`). */
export function campusErrorKey(message: string | undefined | null): CampusErrorKey {
  const m = (message ?? "").toLowerCase();
  if (/rate limit/.test(m)) return "rateLimited";
  if (/duplicate content|already have an open report/.test(m)) return "duplicate";
  if (/invalid (title|body|comment|name|description|rules|details|location)|html, non-https/.test(m)) return "invalidText";
  if (/banned/.test(m)) return "banned";
  if (/event is full/.test(m)) return "full";
  if (/not found|invalid invite code/.test(m)) return "notFound";
  if (/privileges|not allowed|only the|must be an active member|cannot|only students|not yours|permission denied/.test(m)) return "notAllowed";
  if (/failed to fetch|network/.test(m)) return "offline";
  return "generic";
}

/** Deep link for a notification (same path shape on web and mobile), or null when it has no destination. */
export function notificationHref(n: { kind: string; params?: Record<string, unknown> | null }): string | null {
  if (n.kind !== "campus" && n.kind !== "system") return null;
  const p = n.params ?? {};
  const s = (k: string) => (typeof p[k] === "string" && /^[0-9a-f-]{36}$/i.test(p[k] as string) ? (p[k] as string) : null);
  if (s("event_id")) return `/campus/event/${s("event_id")}`;
  if (s("post_id")) return `/campus/post/${s("post_id")}`;
  if (s("community_id")) return `/campus/community/${s("community_id")}`;
  if (s("user_id")) return `/campus/user/${s("user_id")}`;
  return null;
}

/** Study-group invite codes are 10 chars of A-Z0-9; accept pasted lower case and spaces. */
/** Server invite codes (campus_gen_invite_code): 20 characters A-Z0-9 today; the column accepts 16-64. */
export const INVITE_CODE_MIN = 16;
export const INVITE_CODE_MAX = 64;
/**
 * Typed or pasted invite code -> canonical form. A pasted share message ("... qoşul: kod HKEUF32IZD81TI41A34N") yields
 * the last standalone code-length token; a code typed with spaces or dashes is joined up.
 */
export const normalizeInviteCode = (raw: string): string => {
  const up = raw.toUpperCase();
  const token = up.split(/[^A-Z0-9]+/).filter((t) => t.length >= INVITE_CODE_MIN && t.length <= INVITE_CODE_MAX).pop();
  return (token ?? up.replace(/[^A-Z0-9]+/g, "")).slice(0, INVITE_CODE_MAX);
};
export const isInviteCode = (raw: string): boolean => new RegExp(`^[A-Z0-9]{${INVITE_CODE_MIN},${INVITE_CODE_MAX}}$`).test(normalizeInviteCode(raw));
