/**
 * Mobile design tokens as a plain TS object (no React, no react-native import: unit-testable).
 * Brand colours come from packages/ui (BRAND_COLORS); the semantic light values mirror packages/ui/src/styles.css.
 * Dark is the default look (the approved mobile mockup): deep navy to indigo/purple, translucent "glass" cards with
 * thin borders and large radii. Light stays premium: cloud background, white cards, indigo accents.
 */
export type ThemeMode = "light" | "dark";
export type ThemePref = ThemeMode | "system";
export const DEFAULT_THEME_PREF: ThemePref = "system"; // Apple HIG: follow the device appearance

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
  secondary: string;
  accent: string;
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
  /** Near-black data card (progress), white text on top in both modes. */
  ink: string;
  gradient: readonly [string, string, string];
}

/** Midnight Indigo palette (light + dark). */
export const palettes: Readonly<Record<ThemeMode, Palette>> = {
  dark: {
    mode: "dark",
    bgGradient: ["#090D1A", "#090D1A", "#090D1A"],
    bg: "#090D1A",
    surface: "#11182B",
    card: "#11182B",
    cardBorder: "#252F49",
    cardStrong: "#19223A",
    text: "#F4F5FF",
    textMuted: "#9BA5C1",
    primary: "#818CF8",
    secondary: "#6366F1",
    accent: "#A78BFA",
    primarySoft: "rgba(129,140,248,0.18)",
    onPrimary: "#090D1A", // white on #818CF8 is 2.98:1; dark ink gives 6.49:1
    active: "#818CF8",
    border: "#252F49",
    danger: "#FF8597",
    dangerSoft: "rgba(255,107,129,0.18)",
    success: "#4FDDBA",
    successSoft: "rgba(33,201,168,0.18)",
    warning: "#F7C265",
    warningSoft: "rgba(247,194,101,0.18)",
    info: "#818CF8",
    inputBg: "#19223A",
    overlay: "rgba(0,0,0,0.6)",
    tabBar: "rgba(17,24,43,0.96)",
    ink: "#19223A",
    gradient: ["#818CF8", "#6366F1", "#A78BFA"],
  },
  light: {
    mode: "light",
    bgGradient: ["#F8F9FE", "#F8F9FE", "#F8F9FE"],
    bg: "#F8F9FE",
    surface: "#FFFFFF",
    card: "#FFFFFF",
    cardBorder: "#E8EAF4",
    cardStrong: "#EEF0FA",
    text: "#11152B",
    textMuted: "#6A718C", // given #747B96 is 3.98:1 on #F8F9FE; this is the nearest shade at 4.59:1
    primary: "#4338CA",
    secondary: "#6366F1",
    accent: "#8B5CF6",
    primarySoft: "#E9E8FA",
    onPrimary: "#FFFFFF",
    active: "#4338CA",
    border: "#E8EAF4",
    danger: "#C5283D",
    dangerSoft: "#FDE6E9",
    success: "#0A7060",
    successSoft: "#D9F5EE",
    warning: "#8F5200",
    warningSoft: "#FDF0D5",
    info: "#4338CA",
    inputBg: "#F1F3FC",
    overlay: "rgba(17,21,43,0.5)",
    tabBar: "rgba(255,255,255,0.97)",
    ink: "#11152B",
    gradient: ["#4338CA", "#6366F1", "#8B5CF6"],
  },
};

/** Apple-inspired rhythm: 4pt grid, generous radii. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Responsive layout: content never grows wider than this (tablets, landscape), it is centred instead. */
export const CONTENT_MAX = 640;
/** Width available to content on a screen of `screenW` (gutters on both sides, capped at CONTENT_MAX). */
export const contentWidth = (screenW: number) => Math.min(screenW - spacing.lg * 2, CONTENT_MAX);
/** Hero title size: 42 on a 390pt phone, down to 32 on 320pt (iPhone SE 1st gen / small Android), up to 48 on tablets. */
export const heroFontSize = (screenW: number) => Math.round(Math.min(48, Math.max(32, screenW * 0.108)));
/** Icon grid columns: 3 on phones, 4 from large phones in landscape / small tablets, 5 on wide tablets. */
export const gridColumns = (contentW: number) => (contentW >= 600 ? 5 : contentW >= 480 ? 4 : 3);
export const radii = { sm: 10, md: 16, lg: 22, xl: 28, xxl: 32, pill: 999 } as const;
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
