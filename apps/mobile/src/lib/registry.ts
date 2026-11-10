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
  /** Tab screen name inside app/(tabs) (without slashes). Present = shows in the bottom bar. */
  tabRoute?: string;
  icon: IconName;
  /** Brand module gradient to use for the tile. Without it `tileColors` is used. */
  module?: ModuleName;
  tileColors?: readonly [string, string];
  labelKey: MessageKey;
  /** Sort position in the tab bar (home is first and profile last, both fixed). */
  tabOrder?: number;
  /** Which module tabs survive when there are more than MAX_MODULE_TABS (lower = kept first). The rest stay reachable via tiles/hero. */
  tabPriority?: number;
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
    tabOrder: 1,
    tabPriority: 1,
    tileOrder: 1,
    hero: { order: 1, bodyKey: "mobile.home.heroAiBody", ctaKey: "mobile.home.heroAiCta" },
  },
  {
    id: "notes",
    href: "/notes",
    tabRoute: "notes",
    icon: "notes",
    module: "notes",
    labelKey: "brand.module.notes",
    tabOrder: 2,
    tabPriority: 2,
    tileOrder: 5,
  },
  {
    id: "campus",
    href: "/campus",
    tabRoute: "campus",
    icon: "campus",
    module: "campus",
    labelKey: "brand.module.campus",
    // Third module tab: AI Study, Notes and Campus fill the bar; Planner moves to the Home grid (it already has a tile).
    tabOrder: 3,
    tabPriority: 3,
  },
  {
    id: "career",
    href: "/career",
    tabRoute: "career",
    icon: "career",
    module: "career",
    labelKey: "brand.module.career",
    // Lowest tab priority: the bar keeps AI Study, Notes and Planner; Career is a Home tile (its tab file stays hidden).
    tabOrder: 5,
    tabPriority: 10,
    tileOrder: 6,
  },
  { id: "quiz", href: "/quizzes", icon: "quiz", tileColors: ["#7C3AED", "#4F46E5"], labelKey: "mobile.quizzes.title", tileOrder: 2 },
  { id: "flashcards", href: "/flashcards", icon: "flashcard", tileColors: ["#0E7490", "#06B6DA"], labelKey: "nav.flashcards", tileOrder: 3 },
  {
    id: "planner",
    href: "/planner",
    tabRoute: "planner",
    icon: "planner",
    module: "planner",
    labelKey: "brand.module.planner",
    tabOrder: 4,
    tabPriority: 9,
    tileOrder: 4,
    hero: { order: 2, bodyKey: "mobile.home.heroPlannerBody", ctaKey: "mobile.home.heroPlannerCta" },
  },
  { id: "gamification", href: "/gamification", icon: "gamification", module: "gamification", labelKey: "brand.module.gamification", tileOrder: 8 },
  { id: "focus", href: "/focus", icon: "pomodoro", tileColors: ["#B45309", "#C2410C"], labelKey: "nav.focus", tileOrder: 9 },
  { id: "gpa", href: "/gpa", icon: "gpa", tileColors: ["#2563EB", "#4F46E5"], labelKey: "nav.gpa", tileOrder: 10 },
];

const byOrder = <T,>(get: (m: ModuleEntry) => T | undefined) => (a: ModuleEntry, b: ModuleEntry) => Number(get(a)) - Number(get(b));

/** The mockup's bar is Home + 3 modules + Profile = 5 tabs. */
export const MAX_MODULE_TABS = 3;
/** The Home grid is 3x3: when more than 9 tiles are registered, 8 are shown plus a "more" tile. */
export const MAX_TILES = 9;

const allTabs = (mods: readonly ModuleEntry[]) => mods.filter((m) => m.tabRoute);
/** Module tabs shown in the bar: the MAX_MODULE_TABS highest-priority ones, in tabOrder. */
export const tabModules = (mods: readonly ModuleEntry[] = MODULES): ModuleEntry[] =>
  [...allTabs(mods)].sort(byOrder((m) => m.tabPriority ?? 50)).slice(0, MAX_MODULE_TABS).sort(byOrder((m) => m.tabOrder));
/** Tab files that exist but do not fit the bar: declared hidden (href: null) so Expo Router does not auto-add them. */
export const overflowTabModules = (mods: readonly ModuleEntry[] = MODULES): ModuleEntry[] => {
  const shown = new Set(tabModules(mods).map((m) => m.id));
  return allTabs(mods).filter((m) => !shown.has(m.id));
};

export const heroModules = (mods: readonly ModuleEntry[] = MODULES): ModuleEntry[] => mods.filter((m) => m.hero).sort((a, b) => a.hero!.order - b.hero!.order);

/** Home grid: all tiles up to MAX_TILES; beyond that MAX_TILES-1 tiles and the rest in `overflow` (opened from a "more" tile). */
export function tileLayout(mods: readonly ModuleEntry[] = MODULES): { tiles: ModuleEntry[]; overflow: ModuleEntry[] } {
  const sorted = mods.filter((m) => m.tileOrder !== undefined).sort(byOrder((m) => m.tileOrder));
  return sorted.length <= MAX_TILES ? { tiles: sorted, overflow: [] } : { tiles: sorted.slice(0, MAX_TILES - 1), overflow: sorted.slice(MAX_TILES - 1) };
}
