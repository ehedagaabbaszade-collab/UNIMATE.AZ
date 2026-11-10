import { zonedParts } from "@unimate/i18n";
import type { ExamRow, TaskRow, TimetableRow } from "./db";

/** ISO weekday: Monday = 1 ... Sunday = 7 (matches timetable_entries.weekday). */
export const isoWeekday = (d: Date): number => zonedParts(d).isoWeekday;

export const hhmm = (t: string): string => t.slice(0, 5);

export function groupByWeekday(entries: readonly TimetableRow[]): Map<number, TimetableRow[]> {
  const map = new Map<number, TimetableRow[]>();
  for (const e of [...entries].sort((a, b) => a.start_time.localeCompare(b.start_time))) {
    const list = map.get(e.weekday) ?? [];
    list.push(e);
    map.set(e.weekday, list);
  }
  return map;
}

export const classesOn = (entries: readonly TimetableRow[], day: Date): TimetableRow[] =>
  entries.filter((e) => e.weekday === isoWeekday(day)).sort((a, b) => a.start_time.localeCompare(b.start_time));

export const isOverdue = (task: Pick<TaskRow, "due_at" | "status">, now: Date): boolean =>
  task.status !== "done" && task.due_at !== null && new Date(task.due_at).getTime() < now.getTime();

export type UpcomingItem = { kind: "task"; id: string; title: string; at: string } | { kind: "exam"; id: string; title: string; at: string };

/** Open tasks with a due date and exams, soonest first. Past exams are excluded; overdue tasks are kept. */
export function upcomingItems(tasks: readonly TaskRow[], exams: readonly ExamRow[], now: Date, limit = 5): UpcomingItem[] {
  const items: UpcomingItem[] = [
    ...tasks.filter((t) => t.status !== "done" && t.due_at).map((t) => ({ kind: "task" as const, id: t.id, title: t.title, at: t.due_at! })),
    ...exams.filter((e) => new Date(e.starts_at).getTime() >= now.getTime()).map((e) => ({ kind: "exam" as const, id: e.id, title: e.title, at: e.starts_at })),
  ];
  return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()).slice(0, limit);
}

/** <input type="datetime-local"> value (local time) -> ISO string. */
export const localInputToIso = (v: string): string => new Date(v).toISOString();
