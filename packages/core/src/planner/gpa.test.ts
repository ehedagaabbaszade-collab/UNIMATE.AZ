import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AZ_100_SCALE, letterToPoints, scoreToBand, weightedGpa } from "./gpa";

describe("scoreToBand", () => {
  it("maps boundaries on the az 100-point default", () => {
    expect(scoreToBand(100).letter).toBe("A");
    expect(scoreToBand(91).letter).toBe("A");
    expect(scoreToBand(90.9).letter).toBe("B");
    expect(scoreToBand(51).letter).toBe("E");
    expect(scoreToBand(50).letter).toBe("F");
    expect(scoreToBand(0).letter).toBe("F");
  });
  it("labels the default as an assumption", () => {
    expect(AZ_100_SCALE.label).toMatch(/ASSUMED/);
  });
  it("rejects invalid scores", () => {
    expect(() => scoreToBand(-1)).toThrow(RangeError);
    expect(() => scoreToBand(NaN)).toThrow(RangeError);
  });
});

describe("letterToPoints", () => {
  it("4.0 scale", () => {
    expect(letterToPoints("a")).toBe(4);
    expect(letterToPoints("B+")).toBe(3.3);
    expect(() => letterToPoints("Z")).toThrow(RangeError);
  });
});

describe("weightedGpa", () => {
  it("weights by credits", () => {
    const r = weightedGpa([
      { credits: 3, score: 95 }, // 4.0
      { credits: 1, score: 85 }, // 3.0
    ]);
    expect(r).toEqual({ gpa: 3.75, totalCredits: 4, courseCount: 2 });
  });
  it("supports letter grades", () => {
    expect(weightedGpa([{ credits: 2, letter: "A" }, { credits: 2, letter: "C" }]).gpa).toBe(3);
  });
  it("empty and zero-credit give null gpa", () => {
    expect(weightedGpa([])).toEqual({ gpa: null, totalCredits: 0, courseCount: 0 });
    expect(weightedGpa([{ credits: 0, score: 90 }]).gpa).toBeNull();
  });
  it("zero-credit courses do not affect result", () => {
    expect(weightedGpa([{ credits: 0, score: 10 }, { credits: 2, score: 95 }]).gpa).toBe(4);
  });
  it("accepts a custom scale", () => {
    const scale = { id: "x", label: "x", bands: [{ min: 50, letter: "P", points: 4 }, { min: 0, letter: "F", points: 0 }] };
    expect(weightedGpa([{ credits: 1, score: 60 }], scale).gpa).toBe(4);
  });
  it("validates input with zod", () => {
    expect(() => weightedGpa([{ credits: -1, score: 90 }])).toThrow(ZodError);
    expect(() => weightedGpa("nope")).toThrow(ZodError);
    expect(() => weightedGpa([{ credits: 1, score: 90 }], { id: "x", label: "x", bands: [] })).toThrow(ZodError);
    expect(() => weightedGpa([{ credits: 1 }])).toThrow(RangeError);
  });
});
