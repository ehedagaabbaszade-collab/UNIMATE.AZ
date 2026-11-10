import { describe, expect, it } from "vitest";
import { MAX_LEVEL, levelFromXp, xpForLevel } from "./level";

describe("levelFromXp", () => {
  it("matches the documented curve at thresholds", () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(49).level).toBe(1);
    expect(levelFromXp(50).level).toBe(2);
    expect(levelFromXp(149).level).toBe(2);
    expect(levelFromXp(150).level).toBe(3);
    expect(levelFromXp(1240).level).toBe(7);
    expect(levelFromXp(1400).level).toBe(8);
  });
  it("reports progress", () => {
    const l = levelFromXp(100);
    expect(l).toMatchObject({ level: 2, startXp: 50, nextXp: 150, xpIntoLevel: 50, xpToNext: 50, progress: 0.5 });
  });
  it("is monotonic and caps at the max level", () => {
    let prev = 1;
    for (let x = 0; x < 3000; x++) {
      const l = levelFromXp(x).level;
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
    expect(levelFromXp(xpForLevel(MAX_LEVEL))).toMatchObject({ level: MAX_LEVEL, nextXp: null, xpToNext: 0, progress: 1 });
    expect(levelFromXp(10 ** 9).level).toBe(MAX_LEVEL);
  });
  it("treats bad input as 0 XP", () => {
    expect(levelFromXp(-5).level).toBe(1);
    expect(levelFromXp(NaN).level).toBe(1);
  });
});
