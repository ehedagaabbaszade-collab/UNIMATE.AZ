import { describe, expect, it } from "vitest";
import { DURATION_MS, focusedSeconds, formatClock, nextMode, remainingMs } from "./timer";

describe("timer helpers", () => {
  it("formats mm:ss rounding up so 00:00 only shows at completion", () => {
    expect(formatClock(25 * 60_000)).toBe("25:00");
    expect(formatClock(59_001)).toBe("01:00");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(-5)).toBe("00:00");
  });
  it("remaining is wall-clock based and never negative", () => {
    expect(remainingMs(10_000, 4_000)).toBe(6_000);
    expect(remainingMs(10_000, 20_000)).toBe(0);
  });
  it("focused seconds is bounded by the planned duration", () => {
    expect(focusedSeconds(DURATION_MS.work, DURATION_MS.work - 600_000)).toBe(600);
    expect(focusedSeconds(DURATION_MS.work, 0)).toBe(1500);
    expect(focusedSeconds(DURATION_MS.work, DURATION_MS.work + 999)).toBe(0);
  });
  it("long break after every 4th focus block", () => {
    expect(nextMode("work", 1)).toBe("shortBreak");
    expect(nextMode("work", 4)).toBe("longBreak");
    expect(nextMode("shortBreak", 1)).toBe("work");
  });
});
