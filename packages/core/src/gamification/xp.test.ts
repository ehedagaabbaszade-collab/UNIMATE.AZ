import { describe, expect, it } from "vitest";
import { DEFAULT_XP_CONFIG as C, awardXp, baseXp, computeStreak, localDay, streakBonus } from "./xp";

describe("xp rules", () => {
  it("rewards correct over incorrect", () => {
    expect(awardXp({ type: "quiz_answer", correct: true }, { earnedToday: 0, streakDays: 0 })).toBe(C.quizCorrect);
    expect(awardXp({ type: "quiz_answer", correct: false }, { earnedToday: 0, streakDays: 5 })).toBe(C.quizIncorrect);
  });
  it("review completion rewarded", () => {
    expect(awardXp({ type: "review_completed" }, { earnedToday: 0, streakDays: 0 })).toBe(C.reviewCompleted);
  });
  it("idle time yields no XP regardless of streak", () => {
    expect(baseXp({ type: "idle", seconds: 99999 })).toBe(0);
    expect(awardXp({ type: "idle", seconds: 99999 }, { earnedToday: 0, streakDays: 30 })).toBe(0);
  });
  it("streak bonus is capped", () => {
    expect(streakBonus(3)).toBe(6);
    expect(streakBonus(1000)).toBe(C.streakBonusMaxDays * C.streakBonusPerDay);
    expect(streakBonus(-4)).toBe(0);
  });
  it("diminishing returns after soft cap", () => {
    const full = awardXp({ type: "review_completed" }, { earnedToday: 0, streakDays: 0 });
    const dim = awardXp({ type: "review_completed" }, { earnedToday: C.softCap, streakDays: 0 });
    expect(dim).toBe(Math.floor(full * C.diminishingFactor));
  });
  it("daily cap is hard", () => {
    expect(awardXp({ type: "review_completed" }, { earnedToday: C.dailyCap - 3, streakDays: 0 })).toBe(3);
    expect(awardXp({ type: "review_completed" }, { earnedToday: C.dailyCap, streakDays: 0 })).toBe(0);
  });
  it("cannot exceed dailyCap in a long session", () => {
    let earned = 0;
    for (let i = 0; i < 1000; i++) earned += awardXp({ type: "quiz_answer", correct: true }, { earnedToday: earned, streakDays: 10 });
    expect(earned).toBeLessThanOrEqual(C.dailyCap);
  });
});

describe("streak (Asia/Baku)", () => {
  it("uses Baku local day (UTC+4), not UTC", () => {
    // 2025-03-10T20:30Z is 2025-03-11 00:30 in Baku
    expect(localDay(new Date("2025-03-10T20:30:00Z"))).toBe("2025-03-11");
    expect(localDay(new Date("2025-03-10T19:30:00Z"))).toBe("2025-03-10");
  });
  it("counts consecutive days", () => {
    const now = new Date("2025-03-10T10:00:00Z");
    const act = ["2025-03-10T08:00:00Z", "2025-03-09T08:00:00Z", "2025-03-08T08:00:00Z"].map((s) => new Date(s));
    expect(computeStreak(act, now)).toBe(3);
  });
  it("streak stays alive until end of today if yesterday was active", () => {
    const now = new Date("2025-03-10T10:00:00Z");
    expect(computeStreak([new Date("2025-03-09T08:00:00Z"), new Date("2025-03-08T08:00:00Z")], now)).toBe(2);
  });
  it("gap breaks the streak", () => {
    const now = new Date("2025-03-10T10:00:00Z");
    expect(computeStreak([new Date("2025-03-07T08:00:00Z")], now)).toBe(0);
    expect(computeStreak([new Date("2025-03-10T08:00:00Z"), new Date("2025-03-08T08:00:00Z")], now)).toBe(1);
  });
  it("two activities in one Baku day count once; midnight boundary respected", () => {
    const now = new Date("2025-03-11T10:00:00Z");
    // 19:30Z Mar 10 = Mar 10 Baku; 20:30Z Mar 10 = Mar 11 Baku (different days)
    const act = [new Date("2025-03-10T19:30:00Z"), new Date("2025-03-10T20:30:00Z"), new Date("2025-03-11T05:00:00Z")];
    expect(computeStreak(act, now)).toBe(2);
  });
  it("empty activity", () => {
    expect(computeStreak([], new Date())).toBe(0);
  });
});
