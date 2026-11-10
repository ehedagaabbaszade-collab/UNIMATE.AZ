import { describe, expect, it } from "vitest";
import { hasProgress, liveStreak, parseStreak, sumPoints } from "./progress";

describe("progress", () => {
  it("sums points across pages and stops on a short page", async () => {
    const calls: number[] = [];
    const total = await sumPoints(async (from) => {
      calls.push(from);
      return from === 0 ? Array(1000).fill(2) : [5, 5, 5];
    });
    expect(total).toBe(2015);
    expect(calls).toEqual([0, 1000]);
  });
  it("ignores non-finite values and handles no rows", async () => {
    expect(await sumPoints(async () => [])).toBe(0);
    expect(await sumPoints(async () => [3, Number.NaN, 4])).toBe(7);
  });
  it("shows a streak only while it can be alive", () => {
    const row = { current_streak: 5, longest_streak: 9, last_active_date: "2026-11-09" };
    expect(liveStreak(row, "2026-11-10")).toBe(5);
    expect(liveStreak(row, "2026-11-09")).toBe(5);
    expect(liveStreak(row, "2026-11-11")).toBeNull();
    expect(liveStreak(null, "2026-11-10")).toBeNull();
    expect(liveStreak({ ...row, current_streak: 0 }, "2026-11-10")).toBeNull();
  });
  it("parses the streak row defensively", () => {
    expect(parseStreak({ current_streak: 1, longest_streak: 2, last_active_date: "2026-01-01" })).not.toBeNull();
    expect(parseStreak({ current_streak: "1" })).toBeNull();
    expect(parseStreak(null)).toBeNull();
  });
  it("hasProgress is false for a brand new account (empty state, no invented numbers)", () => {
    expect(hasProgress({ xp: 0, streak: null }, "2026-11-10")).toBe(false);
    expect(hasProgress({ xp: 120, streak: null }, "2026-11-10")).toBe(true);
  });
});
