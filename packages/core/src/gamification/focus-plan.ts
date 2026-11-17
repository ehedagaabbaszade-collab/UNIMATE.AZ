import { z } from "zod";

/** Shared focus-timer plan (minutes) for web and mobile. */
export interface FocusPlan {
  workMin: number;
  shortMin: number;
  longMin: number;
}
export const FOCUS_LIMITS = { workMin: [1, 180], shortMin: [1, 60], longMin: [1, 90] } as const;

export const FOCUS_PRESETS = [
  { id: "classic", workMin: 25, shortMin: 5, longMin: 15 },
  { id: "deep", workMin: 50, shortMin: 10, longMin: 30 },
  { id: "sprint", workMin: 15, shortMin: 3, longMin: 10 },
] as const;
export type FocusPresetId = (typeof FOCUS_PRESETS)[number]["id"] | "custom";
export const DEFAULT_FOCUS_PLAN: FocusPlan = { workMin: 25, shortMin: 5, longMin: 15 };

const minutes = ([lo, hi]: readonly [number, number]) => z.number().int().min(lo).max(hi);
export const focusPlanSchema = z.object({ workMin: minutes(FOCUS_LIMITS.workMin), shortMin: minutes(FOCUS_LIMITS.shortMin), longMin: minutes(FOCUS_LIMITS.longMin) });
/** Persisted choice: the preset id plus the custom values (kept even while a preset is selected). */
export const focusPrefSchema = z.object({ preset: z.enum(["classic", "deep", "sprint", "custom"]), custom: focusPlanSchema });
export type FocusPref = z.infer<typeof focusPrefSchema>;
export const DEFAULT_FOCUS_PREF: FocusPref = { preset: "classic", custom: DEFAULT_FOCUS_PLAN };

export const clampMinutes = (n: number, [lo, hi]: readonly [number, number]): number => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo);
export const clampPlan = (p: Partial<FocusPlan>): FocusPlan => ({
  workMin: clampMinutes(p.workMin ?? DEFAULT_FOCUS_PLAN.workMin, FOCUS_LIMITS.workMin),
  shortMin: clampMinutes(p.shortMin ?? DEFAULT_FOCUS_PLAN.shortMin, FOCUS_LIMITS.shortMin),
  longMin: clampMinutes(p.longMin ?? DEFAULT_FOCUS_PLAN.longMin, FOCUS_LIMITS.longMin),
});
export const planFor = (pref: FocusPref): FocusPlan => {
  const p = FOCUS_PRESETS.find((x) => x.id === pref.preset);
  return p ? { workMin: p.workMin, shortMin: p.shortMin, longMin: p.longMin } : clampPlan(pref.custom);
};
export const planDurationMs = (mode: "work" | "shortBreak" | "longBreak", plan: FocusPlan): number =>
  (mode === "work" ? plan.workMin : mode === "shortBreak" ? plan.shortMin : plan.longMin) * 60_000;
