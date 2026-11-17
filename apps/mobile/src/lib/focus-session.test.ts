import { describe, expect, it } from "vitest";
import { durationMs, parsePersisted, planFor, recover, type PersistedFocus } from "./focus-session";

const base: PersistedFocus = { v: 1, preset: "deep", custom: { workMin: 30, shortMin: 7, longMin: 20 }, mode: "work", endAt: 10_000, remainingMs: 0, startedAt: null, blocks: 1, lock: true };

describe("focus-session", () => {
  it("presets and custom plan", () => {
    expect(planFor("sprint", base.custom)).toEqual({ workMin: 15, shortMin: 3, longMin: 10 });
    expect(planFor("custom", { workMin: 999, shortMin: 0, longMin: 5 })).toEqual({ workMin: 180, shortMin: 1, longMin: 5 });
    expect(durationMs("work", { workMin: 45, shortMin: 10, longMin: 30 })).toBe(45 * 60_000);
    expect(durationMs("longBreak", { workMin: 25, shortMin: 5, longMin: 20 })).toBe(20 * 60_000);
  });
  it("parses and rejects bad data", () => {
    expect(parsePersisted(JSON.stringify(base))).toEqual(base);
    expect(parsePersisted("{")).toBeNull();
    expect(parsePersisted(null)).toBeNull();
    expect(parsePersisted(JSON.stringify({ ...base, mode: "x" }))).toBeNull();
    expect(parsePersisted(JSON.stringify({ ...base, preset: "zz" }))?.preset).toBe("classic");
    expect(parsePersisted(JSON.stringify({ ...base, custom: { workMin: 20, breakMin: 8 } }))?.custom).toEqual({ workMin: 20, shortMin: 8, longMin: 15 });
  });
  it("recovers running, expired and paused sessions from the wall clock", () => {
    expect(recover(base, 4_000)).toEqual({ kind: "running", remainingMs: 6_000 });
    expect(recover(base, 10_000)).toEqual({ kind: "expired" });
    expect(recover({ ...base, endAt: null, remainingMs: 5 }, 99)).toEqual({ kind: "paused", remainingMs: 5 });
  });
});
