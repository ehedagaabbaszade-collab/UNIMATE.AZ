import { describe, expect, it } from "vitest";
import { pomodoroXp } from "./pomodoro";

describe("pomodoroXp", () => {
  it("awards nothing below the minimum", () => {
    expect(pomodoroXp(299)).toBe(0);
    expect(pomodoroXp(NaN)).toBe(0);
  });
  it("awards one XP per full minute", () => {
    expect(pomodoroXp(25 * 60)).toBe(25);
    expect(pomodoroXp(25 * 60 + 59)).toBe(25);
  });
  it("caps per session and per day", () => {
    expect(pomodoroXp(180 * 60)).toBe(60);
    expect(pomodoroXp(25 * 60, 290)).toBe(10);
    expect(pomodoroXp(25 * 60, 400)).toBe(0);
  });
});
