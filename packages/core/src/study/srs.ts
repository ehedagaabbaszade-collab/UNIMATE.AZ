/** Spaced-repetition scheduling (SM-2 variant). Pure: no clock, no I/O. Fields mirror public.flashcards. */
export type ReviewGrade = "again" | "hard" | "good" | "easy";

export interface CardSchedule {
  /** 1.30 - 5.00 (matches the flashcards.ease check). */
  ease: number;
  intervalDays: number;
  repetitions: number;
}
export interface ScheduledCard extends CardSchedule {
  dueAt: Date;
}

export const MIN_EASE = 1.3;
export const MAX_EASE = 5;
export const NEW_CARD: CardSchedule = { ease: 2.5, intervalDays: 0, repetitions: 0 };
const AGAIN_DELAY_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const clampEase = (e: number) => Math.round(Math.min(MAX_EASE, Math.max(MIN_EASE, e)) * 100) / 100;

export function scheduleReview(card: CardSchedule, grade: ReviewGrade, now: Date): ScheduledCard {
  const ease0 = Number.isFinite(card.ease) ? card.ease : NEW_CARD.ease;
  const interval0 = Math.max(0, Math.floor(card.intervalDays) || 0);
  const reps0 = Math.max(0, Math.floor(card.repetitions) || 0);

  if (grade === "again") {
    return { ease: clampEase(ease0 - 0.2), intervalDays: 0, repetitions: 0, dueAt: new Date(now.getTime() + AGAIN_DELAY_MS) };
  }

  let interval: number;
  let ease = ease0;
  if (grade === "hard") {
    interval = reps0 === 0 ? 1 : Math.max(1, Math.round(interval0 * 1.2));
    ease -= 0.15;
  } else if (grade === "good") {
    interval = reps0 === 0 ? 1 : reps0 === 1 ? 3 : Math.max(interval0 + 1, Math.round(interval0 * ease0));
  } else {
    interval = reps0 === 0 ? 3 : reps0 === 1 ? 6 : Math.max(interval0 + 1, Math.round(interval0 * ease0 * 1.3));
    ease += 0.15;
  }
  return { ease: clampEase(ease), intervalDays: interval, repetitions: reps0 + 1, dueAt: new Date(now.getTime() + interval * DAY_MS) };
}

export const isDue = (dueAt: Date | string | number, now: Date): boolean => new Date(dueAt).getTime() <= now.getTime();
