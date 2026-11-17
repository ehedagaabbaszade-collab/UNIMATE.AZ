/** Minimal row shapes shared by web and mobile (both apps' db rows satisfy them). */
export interface AgendaTask { id: string; title: string; due_at: string | null; status: string }
export interface AgendaExam { id: string; title: string; starts_at: string }

/** One ranked "do this now" item on the dashboard. Built only from rows the student already has. */
export type AgendaItem =
  | { kind: "overdue"; id: string; title: string; at: string; href: string }
  | { kind: "dueSoon"; id: string; title: string; at: string; href: string }
  | { kind: "exam"; id: string; title: string; at: string; days: number; href: string }
  | { kind: "cards"; id: "cards"; count: number; href: string };

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** Calendar days from `now` to `at` in local time (today = 0, tomorrow = 1). */
export const calendarDaysUntil = (at: string | Date, now: Date): number => Math.round((startOfDay(new Date(at)) - startOfDay(now)) / DAY);

export const EXAM_WINDOW_DAYS = 14;
export const DUE_SOON_HOURS = 48;

/**
 * Ranks what a student should do next:
 * overdue tasks, exams in the next 3 days, tasks due within 48h, due flashcards, then later tasks and exams (2-week window) by date.
 * Exams link to flashcard review when cards are due (revision), otherwise to the exam list.
 */
export function buildAgenda(tasks: readonly AgendaTask[], exams: readonly AgendaExam[], dueCards: number, now: Date, limit = 5): AgendaItem[] {
  const t = now.getTime();
  const open = tasks.filter((x) => x.status !== "done" && x.due_at);
  const byAt = <T extends { at: string }>(a: T, b: T) => new Date(a.at).getTime() - new Date(b.at).getTime();

  const overdue = open
    .filter((x) => new Date(x.due_at!).getTime() < t)
    .map((x) => ({ kind: "overdue" as const, id: x.id, title: x.title, at: x.due_at!, href: "/planner?tab=tasks" }))
    .sort(byAt);
  const dueSoon = open
    .filter((x) => {
      const at = new Date(x.due_at!).getTime();
      return at >= t && at - t <= DUE_SOON_HOURS * 3_600_000;
    })
    .map((x) => ({ kind: "dueSoon" as const, id: x.id, title: x.title, at: x.due_at!, href: "/planner?tab=tasks" }))
    .sort(byAt);
  const examHref = dueCards > 0 ? "/flashcards" : "/planner?tab=exams";
  const examsAhead = exams
    .filter((e) => new Date(e.starts_at).getTime() >= t)
    .map((e) => ({ kind: "exam" as const, id: e.id, title: e.title, at: e.starts_at, days: calendarDaysUntil(e.starts_at, now), href: examHref }))
    .filter((e) => e.days <= EXAM_WINDOW_DAYS)
    .sort(byAt);
  const cards: AgendaItem[] = dueCards > 0 ? [{ kind: "cards", id: "cards", count: dueCards, href: "/flashcards" }] : [];

  const laterTasks = open
    .filter((x) => new Date(x.due_at!).getTime() - t > DUE_SOON_HOURS * 3_600_000)
    .map((x) => ({ kind: "dueSoon" as const, id: x.id, title: x.title, at: x.due_at!, href: "/planner?tab=tasks" }));
  const later: AgendaItem[] = [...examsAhead.filter((e) => e.days > 3), ...laterTasks].sort(byAt);

  return [...overdue, ...examsAhead.filter((e) => e.days <= 3), ...dueSoon, ...cards, ...later].slice(0, limit);
}
