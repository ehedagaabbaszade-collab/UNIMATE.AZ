/** Student or teacher portal. A UI preference like on mobile (state/mode.ts): it never touches profiles.role. */
export type AppMode = "student" | "teacher";

export const MODE_COOKIE = "um-mode";

export const parseMode = (v: string | null | undefined): AppMode => (v === "teacher" ? "teacher" : "student");

/** Where each portal starts after sign-in. */
export const homeFor = (mode: AppMode): string => (mode === "teacher" ? "/teacher" : "/dashboard");

/** Client side: the portal remembered by setModeCookie (student when unset). */
export const readModeCookie = (): AppMode => parseMode(document.cookie.match(new RegExp(`(?:^|; )${MODE_COOKIE}=([^;]*)`))?.[1]);

/** Client side: remember the portal for a year (read by the server layout and proxy). */
export function setModeCookie(mode: AppMode): void {
  document.cookie = `${MODE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
}
