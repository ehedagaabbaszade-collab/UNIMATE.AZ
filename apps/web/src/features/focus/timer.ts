export type TimerMode = "work" | "shortBreak" | "longBreak";
export const DURATION_MS: Record<TimerMode, number> = { work: 25 * 60_000, shortBreak: 5 * 60_000, longBreak: 15 * 60_000 };

/** Wall-clock based so background-tab throttling cannot make the timer drift. */
export const remainingMs = (endAt: number, now: number): number => Math.max(0, endAt - now);

export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Whole focused seconds actually elapsed (never negative, never beyond the planned duration). */
export const focusedSeconds = (plannedMs: number, remaining: number): number => Math.max(0, Math.min(plannedMs, plannedMs - remaining)) / 1000 | 0;

/** Next mode after one finishes: every 4th completed focus block earns the long break. */
export function nextMode(finished: TimerMode, completedFocusBlocks: number): TimerMode {
  if (finished !== "work") return "work";
  return completedFocusBlocks > 0 && completedFocusBlocks % 4 === 0 ? "longBreak" : "shortBreak";
}
