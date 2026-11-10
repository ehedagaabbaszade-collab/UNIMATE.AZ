import { describe, expect, it } from "vitest";
import type { ExamRow, TaskRow, TimetableRow } from "./db";
import { classesOn, groupByWeekday, isOverdue, isoWeekday, upcomingItems } from "./schedule";

const cls = (id: string, weekday: number, start: string): TimetableRow => ({ id, title: id, weekday, start_time: start, end_time: "23:00:00", location: null });
const task = (id: string, due: string | null, status: TaskRow["status"] = "todo"): TaskRow => ({ id, title: id, due_at: due, status, priority: 2, completed_at: status === "done" ? "x" : null });
const exam = (id: string, at: string): ExamRow => ({ id, title: id, starts_at: at, duration_minutes: null, location: null, weight: null });

describe("planner helpers", () => {
  it("isoWeekday: Monday=1 .. Sunday=7", () => {
    expect(isoWeekday(new Date(2026, 2, 2))).toBe(1);
    expect(isoWeekday(new Date(2026, 2, 8))).toBe(7);
  });
  it("groups and orders classes by start time", () => {
    const g = groupByWeekday([cls("b", 1, "11:00:00"), cls("a", 1, "09:00:00"), cls("c", 3, "08:00:00")]);
    expect(g.get(1)!.map((c) => c.id)).toEqual(["a", "b"]);
    expect(classesOn([cls("a", 1, "09:00:00"), cls("c", 3, "08:00:00")], new Date(2026, 2, 2)).map((c) => c.id)).toEqual(["a"]);
  });
  it("overdue only for open tasks with a past due date", () => {
    const now = new Date("2026-03-05T12:00:00Z");
    expect(isOverdue(task("a", "2026-03-04T00:00:00Z"), now)).toBe(true);
    expect(isOverdue(task("a", "2026-03-04T00:00:00Z", "done"), now)).toBe(false);
    expect(isOverdue(task("a", null), now)).toBe(false);
    expect(isOverdue(task("a", "2026-03-06T00:00:00Z"), now)).toBe(false);
  });
  it("upcoming merges open dated tasks and future exams, soonest first", () => {
    const now = new Date("2026-03-05T12:00:00Z");
    const items = upcomingItems(
      [task("t1", "2026-03-07T00:00:00Z"), task("t2", null), task("t3", "2026-03-06T00:00:00Z", "done")],
      [exam("e1", "2026-03-06T09:00:00Z"), exam("e0", "2026-03-01T09:00:00Z")],
      now,
    );
    expect(items.map((i) => i.id)).toEqual(["e1", "t1"]);
  });
});
