/** Route classification shared by proxy.ts and tests. */
export const PROTECTED_PREFIXES = [
  "/dashboard", "/documents", "/flashcards", "/planner", "/focus", "/gpa", "/settings", "/onboarding",
  "/notes", "/campus", "/career", "/gamification", "/notifications",
  "/classes", "/class", "/budget", "/writing", "/colleges", "/courses", "/quizzes", "/quiz", "/profile", "/plans",
  "/teacher", "/study",
] as const;
/** Auth pages a signed-in user is bounced away from. /reset-password and /verify-email are deliberately excluded. */
export const AUTH_ONLY_PATHS = ["/sign-in", "/sign-up", "/forgot-password"] as const;

const matches = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
export const isProtectedPath = (pathname: string) => PROTECTED_PREFIXES.some((p) => matches(pathname, p));
export const isAuthOnlyPath = (pathname: string) => AUTH_ONLY_PATHS.some((p) => matches(pathname, p));

/** Accept only same-origin relative paths as post-login redirect targets (open-redirect guard). */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || typeof next !== "string") return fallback;
  // eslint-disable-next-line no-control-regex -- intentional: reject/strip control characters
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}
