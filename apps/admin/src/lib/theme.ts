export const THEME_COOKIE = "um-theme";
export type ThemePref = "system" | "light" | "dark";
export const toTheme = (v: unknown): ThemePref => (v === "light" || v === "dark" ? v : "system");
