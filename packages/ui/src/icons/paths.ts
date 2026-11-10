/**
 * UNIMATE icon path data. FRAMEWORK-NEUTRAL: no React, no DOM, no CSS variables.
 * Web renders it with an svg element; React Native renders the same data with react-native-svg
 * (`<Svg viewBox={icon.viewBox}>{icon.paths.map(d => <Path d={d} fill="none" stroke={color} strokeWidth={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" />)}</Svg>`).
 *
 * Rules (docs/BRAND_IDENTITY.md): 24x24 grid, 2px safe padding, stroke ICON_STROKE (1.75), round caps and joins,
 * stroke-only (fill none), colour = currentColor. A "dot" is a zero-length segment ("M12 17h.01") drawn with a round cap.
 */

export const ICON_VIEWBOX = "0 0 24 24" as const;
export const ICON_STROKE = 1.75;
/** Mirrors the --icon-* CSS tokens in styles.css. */
export const ICON_SIZES = { xs: 16, sm: 20, md: 24, lg: 32, xl: 48 } as const;
export type IconSize = keyof typeof ICON_SIZES;

export interface IconData {
  readonly viewBox: typeof ICON_VIEWBOX;
  readonly paths: readonly string[];
}

const n = (v: number) => Number(v.toFixed(2));
const circle = (cx: number, cy: number, r: number) => `M${n(cx - r)} ${cy}a${r} ${r} 0 1 0 ${n(2 * r)} 0a${r} ${r} 0 1 0 ${n(-2 * r)} 0z`;
const rect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
const dot = (x: number, y: number) => `M${x} ${y}h.01`;
const icon = (...paths: string[]): IconData => ({ viewBox: ICON_VIEWBOX, paths });

// ---- shared glyphs (one drawing per function; aliases below reuse these)
const BRIEFCASE = icon(rect(3, 7.5, 18, 12.5, 2.5), "M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5", "M3 13h18", "M10.5 13v1.5h3V13");
const GROUP = icon(circle(9, 8, 3), "M3.5 20v-1a5 5 0 0 1 5-5h1a5 5 0 0 1 5 5v1", circle(17.5, 9, 2.5), "M17 14.2a4.5 4.5 0 0 1 3.9 4.4V20");
const BELL = icon("M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z", "M10 21h4");
const SEARCH = icon(circle(11, 11, 6.5), "M16 16l4.5 4.5");
const FLASHCARD = icon(rect(3, 7, 14, 12, 2.5), "M7 4h11a3 3 0 0 1 3 3v8");
const QUIZ = icon(rect(4, 3.5, 16, 17, 3), "M8 9l1.2 1.2L11.8 8", "M14.5 9.5H17", "M8 15l1.2 1.2L11.8 14", "M14.5 15.5H17");
const CAP = icon("M3 9.5 12 5l9 4.5-9 4.5z", "M7 12v4.5c1.5 1.5 3.2 2 5 2s3.5-.5 5-2V12", "M21 9.5V15");
const BARS = icon("M5.5 20v-6", "M12 20V6", "M18.5 20V10");
const FOLDER = icon("M3.5 7a2 2 0 0 1 2-2H10l2 2.5h6.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z");
const DOC = icon("M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M14 3v5h5", "M9 13.5h6", "M9 17h4");
const CALENDAR_BASE = [rect(3.5, 5, 17, 15, 3), "M3.5 10h17", "M8 3v4", "M16 3v4"] as const;

const defs = {
  // ---- modules (8)
  "ai-study": icon("M12 3 3 7.5l9 4.5 9-4.5z", "M3 12l9 4.5 9-4.5", "M3 16.5l9 4.5 9-4.5"),
  campus: GROUP,
  notes: icon("M12 6.5C10.5 5 8 4.5 4 4.5v14c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-14c-4 0-6.5.5-8 2z", "M12 6.5v14"),
  planner: icon(...CALENDAR_BASE, dot(8, 14), dot(12, 14), dot(16, 14), dot(8, 17), dot(12, 17), dot(16, 17)),
  career: BRIEFCASE,
  gamification: icon("M8 4h8v5a4 4 0 0 1-8 0z", "M8 6H4.5v1.5A3.5 3.5 0 0 0 8 11", "M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11", "M12 13v4", "M8 20h8", "M9.5 20l.5-3h4l.5 3"),
  profile: icon(circle(12, 8, 4), "M4.5 20.5v-1a6 6 0 0 1 6-6h3a6 6 0 0 1 6 6v1"),
  settings: icon(
    circle(12, 12, 3),
    "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  ),

  // ---- AI Study
  upload: icon("M12 16V4", "M7 9l5-5 5 5", "M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"),
  summary: icon(rect(5, 3, 14, 18, 2.5), "M9 8.5h6", "M9 12h6", "M9 15.5h3.5"),
  quiz: QUIZ,
  flashcard: FLASHCARD,
  "exam-simulation": CAP,
  "study-plan": icon("M9 6h11", "M9 12h11", "M9 18h11", dot(4.5, 6), dot(4.5, 12), dot(4.5, 18)),
  "ai-chat": icon("M5.5 4h13A2.5 2.5 0 0 1 21 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4H5.5A2.5 2.5 0 0 1 3 13.5v-7A2.5 2.5 0 0 1 5.5 4z", "M12 6.8l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z"),

  // ---- Campus
  post: icon("M11 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V13", "M18.5 3.5a1.8 1.8 0 0 1 2.5 2.5L12 15l-3.5 1 1-3.5z"),
  group: GROUP,
  event: icon(...CALENDAR_BASE, "M12 12.5l1.1 2.2 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z"),
  announcement: icon("M3.5 10v4H7l9 5V5l-9 5z", "M19.5 9.5a4 4 0 0 1 0 5", "M7 14l1 5.5h2.5L9.8 15"),
  reaction: icon("M12 20 4.6 12.6A4.6 4.6 0 0 1 11.1 6.1L12 7l.9-.9a4.6 4.6 0 0 1 6.5 6.5z"),
  comment: icon("M5.5 4h13A2.5 2.5 0 0 1 21 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4H5.5A2.5 2.5 0 0 1 3 13.5v-7A2.5 2.5 0 0 1 5.5 4z", "M8 8.5h8", "M8 11.8h5"),
  report: icon("M5 21V4", "M5 4.5h11l-2 4 2 4H5"),

  // ---- Notes
  materials: FOLDER,
  search: SEARCH,
  saved: icon("M7 3.5h10A1.5 1.5 0 0 1 18.5 5v16L12 16.5 5.5 21V5A1.5 1.5 0 0 1 7 3.5z"),
  rating: icon("M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"),
  download: icon("M12 4v11", "M7 10.5l5 5 5-5", "M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"),

  // ---- Planner
  calendar: icon(...CALENDAR_BASE, dot(12, 15)),
  timetable: icon(rect(3.5, 5, 17, 14, 2.5), "M3.5 10h17", "M10 10v9"),
  tasks: icon(rect(5, 4.5, 14, 16.5, 2.5), "M9 4.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.5", "M8.8 13l2.2 2.2 4.2-4.4"),
  exams: icon(rect(5, 4.5, 14, 16.5, 2.5), "M9 4.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.5", "M9 11h6", "M9 15h6"),
  reminder: icon(circle(12, 13, 7), "M12 9.5V13l2.5 1.5", "M5 4.5 3 6.5", "M19 4.5l2 2"),
  pomodoro: icon(circle(12, 13.5, 7.5), "M12 13.5l3-3", "M10 3h4", "M12 3v3"),
  gpa: BARS,

  // ---- Career
  jobs: BRIEFCASE,
  internship: icon(rect(5, 3.5, 14, 17, 2.5), circle(12, 10, 2.5), "M8 17c.5-2 2-3 4-3s3.5 1 4 3"),
  scholarship: icon(circle(12, 9, 5.5), "M8.8 13.5 7.5 21l4.5-2.5 4.5 2.5-1.3-7.5"),
  cv: icon("M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M14 3v5h5", circle(10.5, 12.5, 1.8), "M8 18c.4-1.6 1.4-2.5 2.5-2.5s2.1.9 2.5 2.5"),
  "interview-prep": icon("M5.5 4h9A2.5 2.5 0 0 1 17 6.5v3a2.5 2.5 0 0 1-2.5 2.5H10l-3 2.5V12H5.5A2.5 2.5 0 0 1 3 9.5v-3A2.5 2.5 0 0 1 5.5 4z", "M17 9h1.5a2.5 2.5 0 0 1 2.5 2.5v3a2.5 2.5 0 0 1-2.5 2.5H17v2.5L14 17h-3.5A2.5 2.5 0 0 1 8 14.5"),
  development: icon("M12 3c3.5 2 5.5 5.5 5 10l-2 2.5H9L7 13c-.5-4.5 1.5-8 5-10z", circle(12, 9.5, 1.5), "M9 15.5 6.5 18 7 20.5l2.5-.5", "M15 15.5l2.5 2.5-.5 2.5-2.5-.5"),

  // ---- Gamification
  xp: icon(circle(12, 12, 8.5), "M12.8 7l-3.3 5h4.5l-1.8 5"),
  streak: icon("M12 21.5c-3.6 0-6-2.5-6-5.8 0-2.4 1.5-4.2 3-5.6.9-.9 1.5-2.4 1.5-4.6 3.9 1.9 7.5 5.2 7.5 10.4 0 3.4-2.5 5.6-6 5.6z", "M12 21.5c-1.6 0-2.6-1.1-2.6-2.5 0-1.7 1.6-2.2 2.6-4 1 1.8 2.6 2.3 2.6 4 0 1.4-1 2.5-2.6 2.5z"),
  achievements: icon(circle(12, 12, 8.5), "M12 7.5l1.4 2.8 3.1.5-2.2 2.2.5 3.1-2.8-1.5-2.8 1.5.5-3.1-2.2-2.2 3.1-.5z"),
  challenges: icon(circle(12, 12, 8.5), circle(12, 12, 4.5), dot(12, 12)),
  leaderboard: icon("M3.5 20.5V14H9v6.5", "M9 20.5V9h6v11.5", "M15 20.5v-8h5.5v8", "M3 20.5h18"),
  rewards: icon(rect(4, 9.5, 16, 4, 1.5), "M5.5 13.5V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-5.5", "M12 9.5v11", "M12 9.5C12 7 10.5 4.5 8.5 4.5a2 2 0 0 0 0 4H12", "M12 9.5c0-2.5 1.5-5 3.5-5a2 2 0 0 1 0 4H12"),

  // ---- system
  home: icon("M3 11.5 12 4l9 7.5", "M5.5 10v9.5h13V10", "M10 19.5v-5h4v5"),
  notifications: BELL,
  add: icon("M12 5v14", "M5 12h14"),
  more: icon("M12 5.2v.8", "M12 11.6v.8", "M12 18v.8"),
  "sign-out": icon("M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4", "M16 8l4 4-4 4", "M20 12H9"),
  close: icon("M6 6l12 12", "M18 6 6 18"),
  check: icon("M5 12.5l4.5 4.5L19 7.5"),
  offline: icon("M2 8.8a15 15 0 0 1 20 0", "M5 12.5a10 10 0 0 1 14 0", "M8.5 16a5 5 0 0 1 7 0", dot(12, 20), "M3 3l18 18"),

  // ---- file types (glyph only; FileIcon adds the coloured tile + label)
  "file-pdf": DOC,
  "file-docx": DOC,
  "file-pptx": DOC,
  "file-xlsx": DOC,
  "file-image": icon(rect(3.5, 4.5, 17, 15, 3), circle(9, 10, 1.6), "M4 17l5-4.5 3.5 3 3-2.5 4.5 4"),
  "file-video": icon(circle(12, 12, 8.5), "M10.5 8.8l4.8 3.2-4.8 3.2z"),
  "file-audio": icon("M4 15v-3a8 8 0 0 1 16 0v3", "M4 15a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2z", "M20 15a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z"),
  "file-zip": icon("M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M14 3v5h5", "M11 11h2", "M11 14h2", "M11 17h2"),

  // ---- statuses
  success: icon(circle(12, 12, 8.5), "M8 12.3l2.8 2.8L16 9.5"),
  info: icon(circle(12, 12, 8.5), "M12 11v5.5", dot(12, 7.8)),
  warning: icon("M10.3 4.5a2 2 0 0 1 3.4 0L21 17.2A2 2 0 0 1 19.3 20H4.7A2 2 0 0 1 3 17.2z", "M12 9.5v4", dot(12, 16.8)),
  error: icon(circle(12, 12, 8.5), "M9 9l6 6", "M15 9l-6 6"),
  pending: icon(circle(12, 12, 8.5), "M12 7.5V12l3 2"),
  locked: icon(rect(5, 10.5, 14, 10, 2.5), "M8 10.5V8a4 4 0 0 1 8 0v2.5", dot(12, 15.5)),
} satisfies Record<string, IconData>;

export type IconName = keyof typeof defs;
export const ICON_PATHS: Readonly<Record<IconName, IconData>> = defs;
export const ICON_NAMES = Object.keys(defs) as IconName[];

/** Grouping that mirrors the official board (docs/BRAND_IDENTITY.md). The completeness test hard-codes the same lists. */
export const ICON_GROUPS = {
  module: ["ai-study", "campus", "notes", "planner", "career", "gamification", "profile", "settings"],
  aiStudy: ["upload", "summary", "quiz", "flashcard", "exam-simulation", "study-plan", "ai-chat"],
  campus: ["post", "group", "event", "announcement", "reaction", "comment", "report"],
  notes: ["materials", "search", "saved", "rating", "download", "quiz", "flashcard"],
  planner: ["calendar", "timetable", "tasks", "exams", "reminder", "pomodoro", "gpa"],
  career: ["jobs", "internship", "scholarship", "cv", "interview-prep", "development"],
  gamification: ["xp", "streak", "achievements", "challenges", "leaderboard", "rewards"],
  system: ["home", "notifications", "search", "add", "more", "sign-out", "close", "check", "offline"],
  file: ["file-pdf", "file-docx", "file-pptx", "file-xlsx", "file-image", "file-video", "file-audio", "file-zip"],
  status: ["success", "info", "warning", "error", "pending", "locked"],
} as const satisfies Record<string, readonly IconName[]>;

export type ModuleName = (typeof ICON_GROUPS.module)[number];
export type FileKind = "pdf" | "docx" | "pptx" | "xlsx" | "image" | "video" | "audio" | "zip";
export type StatusName = (typeof ICON_GROUPS.status)[number];

/**
 * Module tile gradients (hex only, so React Native can use them in a LinearGradient). White glyph on top.
 * Every stop keeps >= 3:1 against #FFFFFF (non-text contrast), checked in contrast.test.ts.
 */
export const MODULE_TILES: Readonly<Record<ModuleName, readonly [string, string]>> = {
  "ai-study": ["#4F46E5", "#7C3AED"],
  campus: ["#2563EB", "#4F46E5"],
  notes: ["#D97706", "#C2410C"],
  planner: ["#0E7490", "#3B82F6"],
  career: ["#7C3AED", "#4F46E5"],
  gamification: ["#B45309", "#C2410C"],
  profile: ["#2563EB", "#1D4ED8"],
  settings: ["#475569", "#334155"],
};

/** File-type accents. `label` is the text drawn on the tile (null = glyph instead). Accent vs white >= 4.5:1 where label is text. */
export const FILE_TYPES: Readonly<Record<FileKind, { color: string; label: string | null }>> = {
  pdf: { color: "#DC2626", label: "PDF" },
  docx: { color: "#1D4ED8", label: "DOCX" },
  pptx: { color: "#C2410C", label: "PPTX" },
  xlsx: { color: "#15803D", label: "XLSX" },
  image: { color: "#2563EB", label: null },
  video: { color: "#4F46E5", label: null },
  audio: { color: "#7C3AED", label: null },
  zip: { color: "#B45309", label: "ZIP" },
};

/** Colours for the small stripe on language chips. Decorative (the chip text carries the meaning). */
export const LANGUAGE_ACCENTS: Readonly<Record<string, string>> = { az: "#0092BC", tr: "#E30A17", en: "#1D4ED8", ru: "#C8102E" };

/** Semantic status colours (light theme, text-safe on white). Mobile theme can reuse them. */
export const STATUS_COLORS: Readonly<Record<StatusName, string>> = {
  success: "#0A7060",
  info: "#1F5FBF",
  warning: "#8F5200",
  error: "#C5283D",
  pending: "#4B556B",
  locked: "#4B556B",
};

/** Brand colours for TS consumers (mobile theme, emails). CSS tokens in styles.css are the source for web. */
export const BRAND_COLORS = {
  indigo: "#4F46E5",
  purple: "#7C3AED",
  blue: "#3B82F6",
  cyan: "#06B6DA",
  cloud: "#F1F5FF",
  navy: "#10182B",
  mint: "#21C9A8",
} as const;

/** Map a MIME type or file name extension to a file icon kind (null when unknown). */
export function fileKindFromMime(mime: string, filename = ""): FileKind | null {
  const m = mime.toLowerCase();
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.includes("wordprocessingml") || m === "application/msword" || ext === "docx" || ext === "doc") return "docx";
  if (m.includes("presentationml") || m === "application/vnd.ms-powerpoint" || ext === "pptx" || ext === "ppt") return "pptx";
  if (m.includes("spreadsheetml") || m === "application/vnd.ms-excel" || ext === "xlsx" || ext === "xls") return "xlsx";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/zip" || m === "application/x-zip-compressed" || ext === "zip") return "zip";
  return null;
}
