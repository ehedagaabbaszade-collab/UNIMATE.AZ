import type { IconName } from "@unimate/ui";
import type { Locale, MessageKey } from "@unimate/i18n";

export interface NavItem { href: string; key: MessageKey; icon: IconName }
export interface NavGroup { id: "home" | "study" | "plan" | "grow"; label: MessageKey | null; items: readonly NavItem[] }

/** Sidebar information architecture: what students do daily first, then study, organise, grow. */
export const NAV_GROUPS: readonly NavGroup[] = [
  { id: "home", label: null, items: [{ href: "/dashboard", key: "nav.dashboard", icon: "home" }] },
  {
    id: "study",
    label: "nav.groups.study",
    items: [
      { href: "/study", key: "brand.module.aiStudy", icon: "ai-study" },
      { href: "/documents", key: "nav.documents", icon: "materials" },
      { href: "/flashcards", key: "nav.flashcards", icon: "flashcard" },
      { href: "/notes", key: "brand.module.notes", icon: "notes" },
      { href: "/writing", key: "writing.title", icon: "notes" },
      { href: "/quizzes", key: "mobile.quizzes.title", icon: "flashcard" },
      { href: "/classes", key: "teach.class.title", icon: "group" },
    ],
  },
  {
    id: "plan",
    label: "nav.groups.plan",
    items: [
      { href: "/planner", key: "nav.planner", icon: "planner" },
      { href: "/focus", key: "nav.focus", icon: "pomodoro" },
      { href: "/gpa", key: "nav.gpa", icon: "gpa" },
      { href: "/courses", key: "semester.title", icon: "tasks" },
      { href: "/budget", key: "budget.title", icon: "wallet" },
    ],
  },
  {
    id: "grow",
    label: "nav.groups.grow",
    items: [
      { href: "/campus", key: "brand.module.campus", icon: "campus" },
      { href: "/career", key: "brand.module.career", icon: "career" },
      { href: "/colleges", key: "colleges.viewColleges", icon: "institution" },
      { href: "/gamification", key: "brand.module.gamification", icon: "gamification" },
    ],
  },
];

const TEACHER_ITEMS: readonly NavItem[] = [
  { href: "/teacher", key: "teach.exams.tab", icon: "exams" },
  { href: "/teacher/classes", key: "teach.class.title", icon: "group" },
  { href: "/planner", key: "teach.exams.scheduleTab", icon: "planner" },
  { href: "/profile", key: "brand.module.profile", icon: "profile" },
];
export const TEACHER_NAV_GROUPS: readonly NavGroup[] = [{ id: "home", label: null, items: TEACHER_ITEMS }];
export const TEACHER_TAB_ITEMS: readonly NavItem[] = TEACHER_ITEMS;

export const SETTINGS_ITEM: NavItem = { href: "/settings", key: "nav.settings", icon: "settings" };

/** Phone tab bar: four destinations + "More" (opens the command palette, which reaches everything else). */
export const TAB_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", key: "nav.dashboard", icon: "home" },
  { href: "/study", key: "brand.module.aiStudy", icon: "ai-study" },
  { href: "/planner", key: "nav.planner", icon: "planner" },
  { href: "/campus", key: "brand.module.campus", icon: "campus" },
];

/** Quick actions: each one opens the existing screen where that action happens. */
export const ACTIONS: readonly NavItem[] = [
  { href: "/documents", key: "palette.uploadDoc", icon: "upload" },
  { href: "/planner?tab=tasks", key: "palette.addTask", icon: "tasks" },
  { href: "/planner?tab=exams", key: "palette.addExam", icon: "exams" },
  { href: "/focus", key: "palette.startFocus", icon: "pomodoro" },
  { href: "/flashcards", key: "palette.reviewCards", icon: "flashcard" },
  { href: "/notes/upload", key: "palette.shareNote", icon: "notes" },
];

export const PAGES: readonly NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM, { href: "/notifications", key: "notifications.title", icon: "notifications" }];

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** Case- and accent-insensitive in the UI locale (az/tr dotted/dotless i, ə, ş, ç...). */
export const fold = (s: string, locale: Locale) => s.toLocaleLowerCase(locale).normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/ə/g, "e");

/** Items whose translated label contains every word of the query. */
export function filterItems<T extends NavItem>(items: readonly T[], query: string, label: (key: MessageKey) => string, locale: Locale): T[] {
  const words = fold(query, locale).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((i) => {
    const hay = fold(label(i.key), locale);
    return words.every((w) => hay.includes(w));
  });
}
