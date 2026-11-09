import { describe, expect, it } from "vitest";
import { MAX_EASE, MIN_EASE, NEW_CARD, isDue, scheduleReview } from "./srs";

const now = new Date("2026-01-01T00:00:00Z");
const day = 86_400_000;

describe("scheduleReview", () => {
  it("again resets repetitions and schedules a short relearn", () => {
    const r = scheduleReview({ ease: 2.5, intervalDays: 10, repetitions: 4 }, "again", now);
    expect(r.repetitions).toBe(0);
    expect(r.intervalDays).toBe(0);
    expect(r.ease).toBe(2.3);
    expect(r.dueAt.getTime() - now.getTime()).toBe(10 * 60 * 1000);
  });
  it("good progresses 1d, 3d, then multiplies by ease", () => {
    const a = scheduleReview(NEW_CARD, "good", now);
    expect(a.intervalDays).toBe(1);
    const b = scheduleReview(a, "good", now);
    expect(b.intervalDays).toBe(3);
    const c = scheduleReview(b, "good", now);
    expect(c.intervalDays).toBe(8); // round(3 * 2.5)
    expect(c.dueAt.getTime() - now.getTime()).toBe(8 * day);
  });
  it("easy raises ease and interval faster than good", () => {
    const e = scheduleReview({ ease: 2.5, intervalDays: 6, repetitions: 2 }, "easy", now);
    const g = scheduleReview({ ease: 2.5, intervalDays: 6, repetitions: 2 }, "good", now);
    expect(e.intervalDays).toBeGreaterThan(g.intervalDays);
    expect(e.ease).toBe(2.65);
  });
  it("hard lowers ease and always advances at least one day", () => {
    const h = scheduleReview({ ease: 2.5, intervalDays: 1, repetitions: 1 }, "hard", now);
    expect(h.ease).toBe(2.35);
    expect(h.intervalDays).toBeGreaterThanOrEqual(1);
  });
  it("clamps ease to the database range and 2 decimals", () => {
    let c = { ease: 1.35, intervalDays: 3, repetitions: 2 };
    for (let i = 0; i < 5; i++) c = scheduleReview(c, "again", now);
    expect(c.ease).toBe(MIN_EASE);
    let d = { ease: 4.95, intervalDays: 3, repetitions: 2 };
    for (let i = 0; i < 5; i++) d = scheduleReview(d, "easy", now);
    expect(d.ease).toBe(MAX_EASE);
  });
  it("survives corrupt input", () => {
    const r = scheduleReview({ ease: NaN, intervalDays: -4, repetitions: -1 }, "good", now);
    expect(r.ease).toBe(2.5);
    expect(r.intervalDays).toBe(1);
  });
  it("isDue compares against now", () => {
    expect(isDue("2025-12-31T00:00:00Z", now)).toBe(true);
    expect(isDue("2026-01-02T00:00:00Z", now)).toBe(false);
  });
});
