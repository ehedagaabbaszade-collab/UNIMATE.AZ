export type XpEvent =
  | { type: "quiz_answer"; correct: boolean }
  | { type: "review_completed" }
  | { type: "idle"; seconds: number };

export interface XpConfig {
  quizCorrect: number;
  quizIncorrect: number;
  reviewCompleted: number;
  streakBonusPerDay: number;
  streakBonusMaxDays: number;
  dailyCap: number;
  /** At/after this much XP in a day, awards are multiplied by diminishingFactor. */
  softCap: number;
  diminishingFactor: number;
}
export const DEFAULT_XP_CONFIG: XpConfig = {
  quizCorrect: 10,
  quizIncorrect: 1,
  reviewCompleted: 25,
  streakBonusPerDay: 2,
  streakBonusMaxDays: 10,
  dailyCap: 300,
  softCap: 150,
  diminishingFactor: 0.5,
};

/** Base XP for an event before streak/caps. Idle time always yields 0. */
export function baseXp(e: XpEvent, cfg: XpConfig = DEFAULT_XP_CONFIG): number {
  switch (e.type) {
    case "quiz_answer":
      return e.correct ? cfg.quizCorrect : cfg.quizIncorrect;
    case "review_completed":
      return cfg.reviewCompleted;
    case "idle":
      return 0;
  }
}

export function streakBonus(streakDays: number, cfg: XpConfig = DEFAULT_XP_CONFIG): number {
  return Math.min(Math.max(0, Math.floor(streakDays)), cfg.streakBonusMaxDays) * cfg.streakBonusPerDay;
}

/**
 * XP awarded for an event given XP already earned today. Streak bonus applies only to completed
 * reviews and correct answers. Beyond softCap awards are scaled down; total never exceeds dailyCap.
 */
export function awardXp(
  event: XpEvent,
  ctx: { earnedToday: number; streakDays: number },
  cfg: XpConfig = DEFAULT_XP_CONFIG,
): number {
  const base = baseXp(event, cfg);
  if (base <= 0) return 0;
  const earnsBonus = event.type === "review_completed" || (event.type === "quiz_answer" && event.correct);
  let raw = base + (earnsBonus ? streakBonus(ctx.streakDays, cfg) : 0);
  if (ctx.earnedToday >= cfg.softCap) raw *= cfg.diminishingFactor;
  const room = Math.max(0, cfg.dailyCap - ctx.earnedToday);
  return Math.min(Math.floor(raw), room);
}

export const BAKU_TZ = "Asia/Baku";

/** Calendar day (YYYY-MM-DD) of an instant in the given timezone. */
export function localDay(at: Date | number, tz: string = BAKU_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * Current streak: consecutive local days with activity ending today, or yesterday (the streak is
 * still alive until today ends). 0 if the latest activity day is older than yesterday.
 */
export function computeStreak(activity: Array<Date | number>, now: Date | number, tz: string = BAKU_TZ): number {
  const days = new Set(activity.map((a) => dayNumber(localDay(a, tz))));
  const today = dayNumber(localDay(now, tz));
  let cursor = days.has(today) ? today : today - 1;
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor--;
  }
  return streak;
}
