import type { IconName, ModuleName } from "@unimate/ui/icons";
import type { MessageKey } from "@unimate/i18n";

/**
 * THE module registry. The bottom tab bar, the Home tile grid and the Home hero carousel are all derived from it,
 * so a module appears only when it is registered (no dead tabs or tiles).
 *
 * To add a module (Campus, Notes, Career, Gamification, ...):
 *   1. create its screens (a tab screen goes in app/(tabs)/<route>, other screens in app/<route>);
 *   2. add ONE entry below (and its catalog keys). Nothing else changes: the tab, the tile and the hero appear.
 * Planned modules are deliberately NOT listed here until their screens exist.
 */
export interface ModuleEntry {
  id: string;
  /** Expo Router path, e.g. "/study". */
  href: string;
  /** Tab screen name inside app/(tabs) when it differs from `pin-<id>` (the pinned-tab file every module has). */
  tabRoute?: string;
  icon: IconName;
  /** Brand module gradient to use for the tile. Without it `tileColors` is used. */
  module?: ModuleName;
  tileColors?: readonly [string, string];
  labelKey: MessageKey;
  /** Position in the Home grid. Absent = not a tile. */
  tileOrder?: number;
  /** Home hero carousel card. */
  hero?: { order: number; bodyKey: MessageKey; ctaKey: MessageKey };
}

export const MODULES: readonly ModuleEntry[] = [
  {
    id: "aiStudy",
    href: "/study",
    tabRoute: "study",
    icon: "ai-study",
    module: "ai-study",
    labelKey: "brand.module.aiStudy",
    tileOrder: 1,
    hero: { order: 1, bodyKey: "mobile.home.heroAiBody", ctaKey: "mobile.home.heroAiCta" },
  },
  {
    id: "notes",
    href: "/notes",
    icon: "notes",
    module: "notes",
    labelKey: "brand.module.notes",
    tileOrder: 5,
  },
  {
    id: "campus",
    href: "/campus",
    tabRoute: "campus",
    icon: "campus",
    module: "campus",
    labelKey: "brand.module.campus",
  },
  {
    id: "career",
    href: "/career",
    tabRoute: "career",
    icon: "career",
    module: "career",
    labelKey: "brand.module.career",
    tileOrder: 6,
  },
  { id: "quiz", href: "/quizzes", icon: "quiz", tileColors: ["#7C3AED", "#4F46E5"], labelKey: "mobile.quizzes.title", tileOrder: 2 },
  { id: "flashcards", href: "/flashcards", icon: "flashcard", tileColors: ["#0E7490", "#06B6DA"], labelKey: "nav.flashcards", tileOrder: 3 },
  {
    id: "planner",
    href: "/planner",
    icon: "planner",
    module: "planner",
    labelKey: "brand.module.planner",
    tileOrder: 4,
    hero: { order: 2, bodyKey: "mobile.home.heroPlannerBody", ctaKey: "mobile.home.heroPlannerCta" },
  },
  // Azerbaijan-specific daily tools (device-local): absence limit + exam score targets, and an AZN budget.
  { id: "courses", href: "/courses", icon: "timetable", tileColors: ["#4F46E5", "#7C3AED"], labelKey: "semester.title", tileOrder: 4.5 },
  { id: "budget", href: "/budget", icon: "wallet", tileColors: ["#0F766E", "#0E7490"], labelKey: "budget.title", tileOrder: 5.5 },
  { id: "gamification", href: "/gamification", icon: "gamification", module: "gamification", labelKey: "brand.module.gamification", tileOrder: 8 },
  { id: "focus", href: "/focus", icon: "pomodoro", tileColors: ["#B45309", "#C2410C"], labelKey: "nav.focus", tileOrder: 5.2 },
  // Teacher classes (exams, assignments). Not a Home tile: reached from More, pinnable to the tab bar.
  { id: "classes", href: "/classes", icon: "institution", labelKey: "teach.class.title" },
  { id: "gpa", href: "/gpa", icon: "gpa", tileColors: ["#2563EB", "#4F46E5"], labelKey: "nav.gpa", tileOrder: 10 },
];

const byOrder = <T,>(get: (m: ModuleEntry) => T | undefined) => (a: ModuleEntry, b: ModuleEntry) => Number(get(a)) - Number(get(b));

/** Bar: Home + up to MAX_PINS user-pinned modules + More. iOS shows at most 5 tabs before adding its own "More". */
export const MAX_PINS = 3;
export const DEFAULT_PINS: readonly string[] = ["aiStudy", "career", "campus"];
/** The Home grid is 3x3: when more than 9 tiles are registered, 8 are shown plus a "more" tile. */
export const MAX_TILES = 9;

/** Tab screen name in app/(app)/(tabs) for a module. */
export const tabRouteOf = (m: ModuleEntry): string => m.tabRoute ?? `pin-${m.id}`;
/** Where a tile opens: an unpinned tab module's tab is hidden (opening it falls back to Home), so it gets its stack page. */
export const moduleHref = (m: ModuleEntry, pinnedIds: readonly string[]): string => (m.tabRoute && !pinnedIds.includes(m.id) ? `/module/${m.id}` : m.href);
/** Pinned ids -> modules, in pin order; unknown ids are dropped and the list is capped. */
export const pinnedModules = (ids: readonly string[], mods: readonly ModuleEntry[] = MODULES): ModuleEntry[] =>
  ids.flatMap((id) => mods.find((m) => m.id === id) ?? []).slice(0, MAX_PINS);

export const heroModules = (mods: readonly ModuleEntry[] = MODULES): ModuleEntry[] => mods.filter((m) => m.hero).sort((a, b) => a.hero!.order - b.hero!.order);

/** Home grid: all tiles up to MAX_TILES; beyond that MAX_TILES-1 tiles and the rest in `overflow` (opened from a "more" tile). */
export function tileLayout(mods: readonly ModuleEntry[] = MODULES): { tiles: ModuleEntry[]; overflow: ModuleEntry[] } {
  const sorted = mods.filter((m) => m.tileOrder !== undefined).sort(byOrder((m) => m.tileOrder));
  return sorted.length <= MAX_TILES ? { tiles: sorted, overflow: [] } : { tiles: sorted.slice(0, MAX_TILES - 1), overflow: sorted.slice(MAX_TILES - 1) };
}
