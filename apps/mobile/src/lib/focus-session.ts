import { DEFAULT_FOCUS_PLAN, FOCUS_PRESETS, clampPlan, planDurationMs, planFor as corePlanFor, type FocusPlan, type FocusPresetId } from "@unimate/core";
import { DURATION_MS, type TimerMode } from "./timer";

export type PresetId = FocusPresetId;
export type { FocusPlan };
export const durationMs = planDurationMs;
export const planFor = (preset: PresetId, custom: FocusPlan): FocusPlan => corePlanFor({ preset, custom });

/** What survives an app kill: enough to rebuild the timer from the wall clock. */
export interface PersistedFocus {
  v: 1;
  preset: PresetId;
  custom: FocusPlan;
  mode: TimerMode;
  /** epoch ms the running block ends; null when paused/idle */
  endAt: number | null;
  /** ms left when paused/idle */
  remainingMs: number;
  /** length of the block on screen (a plan change never alters it); falls back to the plan when absent */
  plannedMs?: number;
  /** ISO start of the current focus block, for saving the session */
  startedAt: string | null;
  blocks: number;
  lock: boolean;
}

const MODES: readonly TimerMode[] = ["work", "shortBreak", "longBreak"];
export function parsePersisted(raw: string | null): PersistedFocus | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<PersistedFocus>;
    if (o.v !== 1 || !MODES.includes(o.mode as TimerMode)) return null;
    const preset = o.preset === "custom" || FOCUS_PRESETS.some((p) => p.id === o.preset) ? (o.preset as PresetId) : "classic";
    const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
    return {
      v: 1,
      preset,
      // older saves stored one break length (breakMin); it becomes the short break
      custom: clampPlan({ workMin: num(o.custom?.workMin, DEFAULT_FOCUS_PLAN.workMin), shortMin: num(o.custom?.shortMin ?? (o.custom as { breakMin?: number } | undefined)?.breakMin, DEFAULT_FOCUS_PLAN.shortMin), longMin: num(o.custom?.longMin, DEFAULT_FOCUS_PLAN.longMin) }),
      mode: o.mode as TimerMode,
      endAt: o.endAt === null || o.endAt === undefined ? null : num(o.endAt, 0) || null,
      remainingMs: Math.max(0, num(o.remainingMs, DURATION_MS.work)),
      plannedMs: typeof o.plannedMs === "number" && o.plannedMs > 0 ? o.plannedMs : undefined,
      startedAt: typeof o.startedAt === "string" ? o.startedAt : null,
      blocks: Math.max(0, Math.floor(num(o.blocks, 0))),
      lock: o.lock === true,
    };
  } catch {
    return null;
  }
}

export type Recovery = { kind: "running"; remainingMs: number } | { kind: "expired" } | { kind: "paused"; remainingMs: number };
export function recover(s: PersistedFocus, now: number): Recovery {
  if (s.endAt === null) return { kind: "paused", remainingMs: s.remainingMs };
  return s.endAt > now ? { kind: "running", remainingMs: s.endAt - now } : { kind: "expired" };
}
