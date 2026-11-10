import { describe, expect, it } from "vitest";
import { clampMinutes, durationMs, parsePersisted, planFor, recover, type PersistedFocus } from "./focus-session";

const base: PersistedFocus = { v: 1, preset: "45-10", custom: { workMin: 30, breakMin: 7 }, mode: "work", endAt: 10_000, remainingMs: 0, startedAt: null, blocks: 1, lock: true };

describe("focus-session", () => {
  it("presets and custom plan", () => {
    expect(planFor("90-15", base.custom)).toEqual({ workMin: 90, breakMin: 15 });
    expect(planFor("custom", { workMin: 999, breakMin: 0 })).toEqual({ workMin: 240, breakMin: 1 });
    expect(durationMs("work", { workMin: 45, breakMin: 10 })).toBe(45 * 60_000);
    expect(durationMs("longBreak", { workMin: 25, breakMin: 5 })).toBe(15 * 60_000);
    expect(clampMinutes(Number.NaN)).toBe(1);
  });
  it("parses and rejects bad data", () => {
    expect(parsePersisted(JSON.stringify(base))).toEqual(base);
    expect(parsePersisted("{")).toBeNull();
    expect(parsePersisted(null)).toBeNull();
    expect(parsePersisted(JSON.stringify({ ...base, mode: "x" }))).toBeNull();
    expect(parsePersisted(JSON.stringify({ ...base, preset: "zz" }))?.preset).toBe("25-5");
  });
  it("recovers running, expired and paused sessions from the wall clock", () => {
    expect(recover(base, 4_000)).toEqual({ kind: "running", remainingMs: 6_000 });
    expect(recover(base, 10_000)).toEqual({ kind: "expired" });
    expect(recover({ ...base, endAt: null, remainingMs: 5 }, 99)).toEqual({ kind: "paused", remainingMs: 5 });
  });
});
