import { describe, expect, it } from "vitest";
import { DEFAULT_FOCUS_PREF, clampPlan, focusPrefSchema, planDurationMs, planFor } from "./focus-plan";

describe("focus plan", () => {
  it("resolves presets and clamps custom values", () => {
    expect(planFor({ ...DEFAULT_FOCUS_PREF, preset: "deep" })).toEqual({ workMin: 50, shortMin: 10, longMin: 30 });
    expect(planFor({ preset: "custom", custom: { workMin: 999, shortMin: 0, longMin: 500 } })).toEqual({ workMin: 180, shortMin: 1, longMin: 90 });
    expect(clampPlan({ workMin: Number.NaN, shortMin: 2.6 })).toEqual({ workMin: 1, shortMin: 3, longMin: 15 });
    expect(planDurationMs("longBreak", { workMin: 25, shortMin: 5, longMin: 20 })).toBe(20 * 60_000);
  });
  it("validates persisted preferences", () => {
    expect(focusPrefSchema.safeParse(DEFAULT_FOCUS_PREF).success).toBe(true);
    expect(focusPrefSchema.safeParse({ preset: "x", custom: DEFAULT_FOCUS_PREF.custom }).success).toBe(false);
    expect(focusPrefSchema.safeParse({ preset: "custom", custom: { workMin: 181, shortMin: 5, longMin: 15 } }).success).toBe(false);
  });
});
