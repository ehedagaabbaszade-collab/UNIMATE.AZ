import { describe, expect, it } from "vitest";
import type { ExamRow, TaskRow } from "@/lib/db";
import { buildAgenda, daysUntil } from "./agenda";

const now = new Date(2026, 10, 14, 10, 0); // 14 Nov 2026 10:00 local
const iso = (d: number, h = 9) => new Date(2026, 10, 14 + d, h, 0).toISOString();
const task = (id: string, due: string | null, status: TaskRow["status"] = "todo"): TaskRow => ({ id, title: id, due_at: due, status, priority: 0, completed_at: null });
const exam = (id: string, at: string): ExamRow => ({ id, title: id, starts_at: at, duration_minutes: null, location: null, weight: null });

describe("buildAgenda", () => {
  it("ranks overdue, imminent exams, due-soon tasks, cards, then later items by date", () => {
    const out = buildAgenda(
      [task("late", iso(-2)), task("soon", iso(1)), task("far", iso(6)), task("done", iso(-1), "done"), task("nodate", null)],
      [exam("exam2", iso(2)), exam("exam10", iso(10)), exam("exam30", iso(30)), exam("past", iso(-1))],
      7,
      now,
    );
    expect(out.map((i) => i.id)).toEqual(["late", "exam2", "soon", "cards", "far"]);
  });

  it("keeps later tasks at the tail, ordered with later exams by date", () => {
    const out = buildAgenda([task("far", iso(6)), task("farther", iso(12))], [exam("exam10", iso(10))], 0, now);
    expect(out.map((i) => i.id)).toEqual(["far", "exam10", "farther"]);
  });

  it("links exams to flashcards only when cards are due", () => {
    expect(buildAgenda([], [exam("e", iso(1))], 0, now)[0]).toMatchObject({ kind: "exam", days: 1, href: "/planner?tab=exams" });
    expect(buildAgenda([], [exam("e", iso(1))], 3, now)[0]).toMatchObject({ href: "/flashcards" });
  });

  it("is empty when there is nothing to act on, and respects the limit", () => {
    expect(buildAgenda([], [], 0, now)).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => task(`t${i}`, iso(-1, i)));
    expect(buildAgenda(many, [], 0, now, 3)).toHaveLength(3);
  });

  it("counts calendar days, not 24h blocks", () => {
    expect(daysUntil(new Date(2026, 10, 15, 1, 0), now)).toBe(1);
    expect(daysUntil(new Date(2026, 10, 14, 23, 0), now)).toBe(0);
  });
});
