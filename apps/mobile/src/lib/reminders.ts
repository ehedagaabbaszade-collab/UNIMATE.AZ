import type { ExamRow, TaskRow } from "./db";

/** iOS keeps at most 64 pending local notifications; stay below it. */
export const MAX_REMINDERS = 50;
export const LEAD_MINUTES = 60;

/** A student's open class work with a deadline: an assignment not handed in, or a class exam not yet taken. */
export interface ClassDeadline {
  id: string;
  kind: "assignment" | "classExam";
  title: string;
  /** Due date of the assignment, or when the exam closes. */
  at: string;
}

export interface PlannedReminder {
  /** Stable identifier: re-scheduling replaces instead of duplicating. */
  id: string;
  kind: "task" | "exam" | "assignment" | "classExam";
  title: string;
  at: Date;
}

/** Fire time = start minus the lead time. Items whose fire time already passed are not scheduled. */
export function reminderTime(startIso: string, now: Date, leadMinutes = LEAD_MINUTES): Date | null {
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return null;
  const at = new Date(start - leadMinutes * 60_000);
  return at.getTime() > now.getTime() ? at : null;
}

/** Open tasks with a due date and upcoming exams, soonest first, capped. Pure; the app schedules the result. */
export function planReminders(tasks: readonly TaskRow[], exams: readonly ExamRow[], now: Date, leadMinutes = LEAD_MINUTES, classWork: readonly ClassDeadline[] = []): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  for (const t of tasks) {
    if (t.status === "done" || !t.due_at) continue;
    const at = reminderTime(t.due_at, now, leadMinutes);
    if (at) out.push({ id: `um-task-${t.id}`, kind: "task", title: t.title, at });
  }
  for (const e of exams) {
    const at = reminderTime(e.starts_at, now, leadMinutes);
    if (at) out.push({ id: `um-exam-${e.id}`, kind: "exam", title: e.title, at });
  }
  for (const c of classWork) {
    const at = reminderTime(c.at, now, leadMinutes);
    if (at) out.push({ id: `um-cls-${c.kind}-${c.id}`, kind: c.kind, title: c.title, at });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_REMINDERS);
}

export const isClassReminderId = (id: string): boolean => id.startsWith("um-cls-");
export const isReminderId = (id: string): boolean => id.startsWith("um-task-") || id.startsWith("um-exam-") || isClassReminderId(id);
