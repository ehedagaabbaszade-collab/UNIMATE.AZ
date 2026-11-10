import { describe, expect, it } from "vitest";
import { buildScale, computeGpa, type BandInput, type GpaRow } from "./gpa";

const row = (id: string, credits: string, score = "", letter = ""): GpaRow => ({ id, name: id, credits, score, letter });
const bands: BandInput[] = [
  { id: "1", min: "90", letter: "A", points: "4" },
  { id: "2", min: "0", letter: "F", points: "0" },
];

describe("computeGpa", () => {
  it("uses core weightedGpa with the default 100-point scale", () => {
    const r = computeGpa("az", [], [row("a", "6", "95"), row("b", "3", "75")]);
    expect(r).toMatchObject({ ok: true, totalCredits: 9 });
    expect(r.ok && r.gpa).toBeCloseTo((4 * 6 + 2 * 3) / 9, 3);
  });
  it("supports the 4.0 letter scale", () => {
    const r = computeGpa("letter", [], [row("a", "3", "", "A"), row("b", "3", "", "B")]);
    expect(r.ok && r.gpa).toBe(3.5);
  });
  it("supports a custom scale", () => {
    expect(buildScale("custom", bands)).not.toBeNull();
    const r = computeGpa("custom", bands, [row("a", "2", "92"), row("b", "2", "10")]);
    expect(r.ok && r.gpa).toBe(2);
  });
  it("rejects a custom scale that cannot score 0", () => {
    const bad: BandInput[] = [{ id: "1", min: "50", letter: "P", points: "1" }];
    expect(buildScale("custom", bad)).toBeNull();
    expect(computeGpa("custom", bad, [row("a", "3", "60")])).toMatchObject({ ok: false, reason: "scale" });
  });
  it("flags invalid rows by id and ignores blank rows", () => {
    const r = computeGpa("az", [], [row("a", "3", "150"), row("b", "-1", "50"), row("c", "", "")]);
    expect(r).toMatchObject({ ok: false, reason: "rows", rowErrors: { a: "validation.score", b: "validation.credits" } });
    expect(computeGpa("az", [], [row("c", "", "")])).toMatchObject({ ok: true, gpa: null });
  });
  it("accepts a decimal comma", () => {
    const r = computeGpa("az", [], [row("a", "1,5", "95")]);
    expect(r).toMatchObject({ ok: true, totalCredits: 1.5 });
  });
});
