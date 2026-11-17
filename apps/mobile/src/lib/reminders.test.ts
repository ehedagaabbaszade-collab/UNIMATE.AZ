import { describe, expect, it } from "vitest";
import type { ExamRow, TaskRow } from "./db";
import { MAX_REMINDERS, isReminderId, planReminders, reminderTime } from "./reminders";

const now = new Date("2026-11-10T10:00:00Z");
const task = (id: string, due: string | null, status: TaskRow["status"] = "todo"): TaskRow => ({ id, title: id, due_at: due, status, priority: 2, completed_at: status === "done" ? due : null });
const exam = (id: string, at: string): ExamRow => ({ id, title: id, starts_at: at, duration_minutes: null, location: null, weight: null });

describe("reminders", () => {
  it("fires one lead-time before and skips the past", () => {
    expect(reminderTime("2026-11-10T13:00:00Z", now)?.toISOString()).toBe("2026-11-10T12:00:00.000Z");
    expect(reminderTime("2026-11-10T10:30:00Z", now)).toBeNull();
    expect(reminderTime("garbage", now)).toBeNull();
  });
  it("plans open tasks and exams only, sorted, with stable ids", () => {
    const plan = planReminders([task("a", "2026-11-12T10:00:00Z"), task("done", "2026-11-12T10:00:00Z", "done"), task("nodue", null)], [exam("e", "2026-11-11T10:00:00Z")], now);
    expect(plan.map((p) => p.id)).toEqual(["um-exam-e", "um-task-a"]);
    expect(plan.every((p) => isReminderId(p.id))).toBe(true);
  });
  it("adds open class work (assignment due dates, class exams closing) with their own ids", () => {
    const plan = planReminders([], [], now, 60, [
      { id: "a1", kind: "assignment", title: "Lab report", at: "2026-11-10T15:00:00Z" },
      { id: "x1", kind: "classExam", title: "Midterm", at: "2026-11-10T10:30:00Z" }, // fires in the past: skipped
    ]);
    expect(plan.map((p) => [p.id, p.kind, p.at.toISOString()])).toEqual([["um-cls-assignment-a1", "assignment", "2026-11-10T14:00:00.000Z"]]);
    expect(isReminderId("um-cls-assignment-a1")).toBe(true);
  });
  it("caps below the iOS pending-notification limit", () => {
    const many = Array.from({ length: 80 }, (_, i) => task(`t${i}`, `2026-12-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z`));
    expect(planReminders(many, [], now)).toHaveLength(MAX_REMINDERS);
  });
});
