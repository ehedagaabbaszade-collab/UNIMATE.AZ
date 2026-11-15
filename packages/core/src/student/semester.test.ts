import { describe, expect, it } from "vitest";
import { AZ_DEFAULT_RULES, absenceStatus, examTargets, finalResult } from "./semester";

describe("absenceStatus", () => {
  it("allows up to 25% of hours and warns near the limit", () => {
    expect(absenceStatus(60, 0)).toMatchObject({ allowedHours: 15, remainingHours: 15, level: "ok", attendancePoints: 10 });
    expect(absenceStatus(60, 12)).toMatchObject({ remainingHours: 3, level: "warn", attendancePoints: 8 });
    expect(absenceStatus(60, 15).level).toBe("warn");
    expect(absenceStatus(60, 16)).toMatchObject({ level: "over", remainingHours: -1 });
  });
  it("never warns with zero absences, even when few hours are allowed", () => {
    expect(absenceStatus(8, 0).level).toBe("ok");
    expect(absenceStatus(8, 1).level).toBe("warn");
  });
  it("follows a custom limit and rejects bad input", () => {
    expect(absenceStatus(30, 7, { ...AZ_DEFAULT_RULES, absenceLimitPct: 20 }).level).toBe("over");
    expect(() => absenceStatus(0, 1)).toThrow();
    expect(() => absenceStatus(10, -1)).toThrow();
  });
});

describe("examTargets", () => {
  it("never asks for less than the exam minimum", () => {
    const t = examTargets(45);
    expect(t[0]).toEqual({ letter: "E", min: 51, needed: 17 });
    expect(t.at(-1)).toEqual({ letter: "A", min: 91, needed: 46 });
  });
  it("marks bands out of reach", () => {
    const t = examTargets(20);
    expect(t.find((x) => x.letter === "E")?.needed).toBe(31);
    expect(t.find((x) => x.letter === "A")?.needed).toBeNull();
  });
});

describe("finalResult", () => {
  it("ignores an exam below the minimum", () => {
    expect(finalResult(45, 16)).toMatchObject({ examCounts: false, passed: false, letter: "F", total: 45 });
    expect(finalResult(45, 17)).toMatchObject({ passed: true, total: 62, letter: "D" });
  });
});
