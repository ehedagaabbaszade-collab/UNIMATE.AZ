import { BRAND_COLORS } from "@unimate/ui/icons";

/**
 * Mobile design tokens as a plain TS object (no React, no react-native import: unit-testable).
 * Brand colours come from packages/ui (BRAND_COLORS); the semantic light values mirror packages/ui/src/styles.css.
 * Dark is the default look (the approved mobile mockup): deep navy to indigo/purple, translucent "glass" cards with
 * thin borders and large radii. Light stays premium: cloud background, white cards, indigo accents.
 */
export type ThemeMode = "light" | "dark";
export type ThemePref = ThemeMode | "system";
export const DEFAULT_THEME_PREF: ThemePref = "dark";

export interface Palette {
  mode: ThemeMode;
  /** Screen background gradient, top to bottom. */
  bgGradient: readonly [string, string, string];
  bg: string;
  surface: string;
  /** Glass card: translucent fill + thin border. */
  card: string;
  cardBorder: string;
  cardStrong: string;
  text: string;
  textMuted: string;
  primary: string;
  primarySoft: string;
  onPrimary: string;
  /** Active tab / accent highlight. */
  active: string;
  border: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  inputBg: string;
  overlay: string;
  tabBar: string;
  gradient: readonly [string, string, string];
}

const gradient = [BRAND_COLORS.indigo, BRAND_COLORS.purple, BRAND_COLORS.blue] as const;

export const palettes: Readonly<Record<ThemeMode, Palette>> = {
  dark: {
    mode: "dark",
    bgGradient: ["#0A0F2E", "#161650", "#32197A"],
    bg: "#0A0F2E",
    surface: "#141A44",
    card: "rgba(255,255,255,0.07)",
    cardBorder: "rgba(255,255,255,0.14)",
    cardStrong: "rgba(255,255,255,0.12)",
    text: "#FFFFFF",
    textMuted: "#B9C1E3",
    primary: "#5F54EA",
    primarySoft: "rgba(124,58,237,0.28)",
    onPrimary: "#FFFFFF",
    active: "#B79CFF",
    border: "rgba(255,255,255,0.16)",
    danger: "#FF8597",
    dangerSoft: "rgba(255,107,129,0.18)",
    success: "#4FDDBA",
    successSoft: "rgba(33,201,168,0.18)",
    warning: "#F7C265",
    warningSoft: "rgba(247,194,101,0.18)",
    info: "#7FB0FF",
    inputBg: "rgba(255,255,255,0.08)",
    overlay: "rgba(5,8,24,0.72)",
    tabBar: "rgba(14,17,52,0.96)",
    gradient,
  },
  light: {
    mode: "light",
    bgGradient: ["#F1F5FF", "#EEF0FF", "#E6E4FF"],
    bg: "#F1F5FF",
    surface: "#FFFFFF",
    card: "#FFFFFF",
    cardBorder: "#DDE2EE",
    cardStrong: "#F4F6FD",
    text: "#10182B",
    textMuted: "#4B556B",
    primary: "#4F46E5",
    primarySoft: "#E8E9FF",
    onPrimary: "#FFFFFF",
    active: "#4F46E5",
    border: "#DDE2EE",
    danger: "#C5283D",
    dangerSoft: "#FDE6E9",
    success: "#0A7060",
    successSoft: "#D9F5EE",
    warning: "#8F5200",
    warningSoft: "#FDF0D5",
    info: "#1F5FBF",
    inputBg: "#FFFFFF",
    overlay: "rgba(16,24,43,0.5)",
    tabBar: "rgba(255,255,255,0.97)",
    gradient,
  },
};

/** Apple-inspired rhythm: 4pt grid, generous radii. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 } as const;
/** Base sizes in dp; Text scales with the user's font-size setting (allowFontScaling), so layouts use minHeight not height. */
export const fontSizes = { xs: 12, sm: 14, base: 16, lg: 18, xl: 22, xxl: 28 } as const;
export const MIN_TOUCH = 44;

export const resolveMode = (pref: ThemePref, system: ThemeMode | null | undefined): ThemeMode => (pref === "system" ? (system === "light" ? "light" : system === "dark" ? "dark" : "dark") : pref);
export const isThemePref = (v: unknown): v is ThemePref => v === "light" || v === "dark" || v === "system";

/** WCAG relative-luminance contrast for #rrggbb pairs (used by tokens.test.ts). */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
