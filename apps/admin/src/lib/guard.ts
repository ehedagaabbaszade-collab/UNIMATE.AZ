import type { IconName } from "@unimate/ui";
import type { MessageKey } from "@unimate/i18n";

/**
 * Role -> allowed routes. PURE (no I/O) so proxy.ts, the server layout, every page and the navigation share one rule
 * set and the tests can pin it down. This is UX + first line of defence only: every privileged action is re-checked
 * by the database (RPCs authorize via auth.uid() -> profiles.role; RLS stays enabled).
 */
export const APP_ROLES = ["student", "moderator", "admin", "super_admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];
export const STAFF_ROLES = ["moderator", "admin", "super_admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

const RANK: Record<AppRole, number> = { student: 0, moderator: 1, admin: 2, super_admin: 3 };

export const toRole = (v: unknown): AppRole | null => (typeof v === "string" && (APP_ROLES as readonly string[]).includes(v) ? (v as AppRole) : null);
export const isStaff = (role: AppRole | null | undefined): role is StaffRole => !!role && RANK[role] >= RANK.moderator;
export const atLeast = (role: AppRole | null | undefined, min: AppRole): boolean => !!role && RANK[role] >= RANK[min];
/** Only super admins may change roles (admin_set_role re-checks in the database). */
export const canChangeRoles = (role: AppRole | null | undefined): boolean => atLeast(role, "super_admin");

export interface NavItem {
  href: string;
  key: MessageKey;
  icon: IconName;
  min: StaffRole;
}
/** Order = display order. `min` is the lowest role that may open the route. */
export const NAV: readonly NavItem[] = [
  { href: "/", key: "admin.nav.dashboard", icon: "home", min: "moderator" },
  { href: "/moderation", key: "admin.nav.moderation", icon: "report", min: "moderator" },
  { href: "/users", key: "admin.nav.users", icon: "profile", min: "admin" },
  { href: "/academic", key: "admin.nav.academic", icon: "materials", min: "admin" },
  { href: "/career", key: "admin.nav.career", icon: "career", min: "admin" },
  { href: "/subscriptions", key: "admin.nav.subscriptions", icon: "rewards", min: "admin" },
  { href: "/prompts", key: "admin.nav.prompts", icon: "ai-chat", min: "admin" },
  // Part 2. All admin+: the AI/config RPCs authorize with is_admin() (admin_revert_config needs admin, not super_admin).
  { href: "/ai/models", key: "admin.nav.aiModels", icon: "ai-study", min: "admin" },
  { href: "/ai/routes", key: "admin.nav.aiRoutes", icon: "tasks", min: "admin" },
  { href: "/ai/budgets", key: "admin.nav.aiBudgets", icon: "gpa", min: "admin" },
  { href: "/ai/versions", key: "admin.nav.aiVersions", icon: "saved", min: "admin" },
  { href: "/ai/cost", key: "admin.nav.aiCost", icon: "xp", min: "admin" },
  { href: "/analytics", key: "admin.nav.analytics", icon: "leaderboard", min: "admin" },
  { href: "/audit", key: "admin.nav.audit", icon: "locked", min: "admin" },
  { href: "/config", key: "admin.nav.config", icon: "settings", min: "admin" },
  { href: "/content", key: "admin.nav.content", icon: "announcement", min: "admin" },
  { href: "/jobs", key: "admin.nav.jobs", icon: "pending", min: "admin" },
];

export const navFor = (role: AppRole | null | undefined): NavItem[] => NAV.filter((n) => atLeast(role, n.min));

const matches = (pathname: string, prefix: string) => (prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`));

/** Public pages: sign-in and the access-denied page (which itself shows no data). */
export const PUBLIC_PATHS = ["/sign-in", "/access-denied"] as const;
export const isPublicPath = (pathname: string) => PUBLIC_PATHS.some((p) => matches(pathname, p));

/** Lowest role needed for a path; unknown paths default to admin (deny-by-default for new routes). */
export function minRoleFor(pathname: string): StaffRole {
  const hit = NAV.filter((n) => n.href !== "/" && matches(pathname, n.href))[0];
  if (hit) return hit.min;
  return pathname === "/" ? "moderator" : "admin";
}

/** May `role` open `pathname`? Public paths are always allowed (they render no data). */
export function canAccess(role: AppRole | null | undefined, pathname: string): boolean {
  if (isPublicPath(pathname)) return true;
  return atLeast(role, minRoleFor(pathname));
}

export type GuardDecision = { kind: "allow" } | { kind: "sign-in" } | { kind: "denied" };
/** Decision for a request: no session -> sign-in; signed in but not allowed -> access denied. */
export function decide(signedIn: boolean, role: AppRole | null | undefined, pathname: string): GuardDecision {
  if (isPublicPath(pathname)) return { kind: "allow" };
  if (!signedIn) return { kind: "sign-in" };
  return canAccess(role, pathname) ? { kind: "allow" } : { kind: "denied" };
}

/** Open-redirect guard for the post-sign-in target. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || typeof next !== "string") return fallback;
  // eslint-disable-next-line no-control-regex -- intentional: reject/strip control characters
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}
