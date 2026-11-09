import { describe, expect, it } from "vitest";
import { isUngroundedAnswer, pageLabel, segmentAnswer } from "./citations";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const FAKE = "99999999-9999-4999-8999-999999999999";
const cit = (id: string, p = 1) => ({ chunk_id: id, page_start: p, page_end: p });

describe("segmentAnswer", () => {
  it("turns only validated markers into citation parts, numbered by position", () => {
    const parts = segmentAnswer(`Mitosis has phases [${A}]. Meiosis halves chromosomes [${B}].`, [cit(A), cit(B, 4)]);
    expect(parts.filter((p) => p.type === "cite")).toEqual([
      { type: "cite", chunkId: A, index: 1 },
      { type: "cite", chunkId: B, index: 2 },
    ]);
    expect(parts.map((p) => (p.type === "text" ? p.text : "")).join("")).toBe("Mitosis has phases . Meiosis halves chromosomes .");
  });
  it("drops markers that are not in the structured citations (cannot fabricate a source)", () => {
    const parts = segmentAnswer(`Claim [${FAKE}] and [${A}].`, [cit(A)]);
    expect(parts.filter((p) => p.type === "cite")).toHaveLength(1);
    expect(JSON.stringify(parts)).not.toContain(FAKE);
  });
  it("matches ids case-insensitively but never creates chips when citations is empty", () => {
    expect(segmentAnswer(`x [${A.toUpperCase()}]`, [cit(A)]).some((p) => p.type === "cite")).toBe(true);
    expect(segmentAnswer(`x [${A}]`, []).some((p) => p.type === "cite")).toBe(false);
  });
  it("strips the not-grounded prefix and reports it", () => {
    expect(isUngroundedAnswer("[Not source-grounded] hi")).toBe(true);
    expect(segmentAnswer("[Not source-grounded] hi", [])).toEqual([{ type: "text", text: "hi" }]);
  });
  it("leaves non-uuid brackets as plain text", () => {
    expect(segmentAnswer("see [1] and [note]", [])).toEqual([{ type: "text", text: "see [1] and [note]" }]);
  });
});

describe("pageLabel", () => {
  it("formats none/single/range", () => {
    expect(pageLabel({ page_start: null, page_end: null })).toEqual({ kind: "none" });
    expect(pageLabel({ page_start: 3, page_end: 3 })).toEqual({ kind: "single", n: 3 });
    expect(pageLabel({ page_start: 3, page_end: null })).toEqual({ kind: "single", n: 3 });
    expect(pageLabel({ page_start: 3, page_end: 5 })).toEqual({ kind: "range", a: 3, b: 5 });
  });
});
