/**
 * XP for a completed focus (Pomodoro) session. Kept separate from awardXp/XpEvent so the pipeline's use of
 * XpEvent is not widened. Idle/abandoned time earns nothing; a session must reach `minSeconds`.
 */
export interface PomodoroXpConfig {
  minSeconds: number;
  /** XP per full focused minute. */
  perMinute: number;
  /** Max XP from a single session. */
  perSessionCap: number;
  dailyCap: number;
}
export const DEFAULT_POMODORO_XP: PomodoroXpConfig = { minSeconds: 5 * 60, perMinute: 1, perSessionCap: 60, dailyCap: 300 };

export function pomodoroXp(focusSeconds: number, earnedToday = 0, cfg: PomodoroXpConfig = DEFAULT_POMODORO_XP): number {
  if (!Number.isFinite(focusSeconds) || focusSeconds < cfg.minSeconds) return 0;
  const raw = Math.min(Math.floor(focusSeconds / 60) * cfg.perMinute, cfg.perSessionCap);
  const room = Math.max(0, cfg.dailyCap - Math.max(0, earnedToday));
  return Math.min(raw, room);
}
