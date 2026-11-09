import { describe, expect, it } from "vitest";
import { MAX_ANSWER_CHARS, validateCitations } from "./citations";

const retrieved = [{ id: "c_aaa111" }, { id: "c_bbb222" }];

describe("validateCitations security regressions", () => {
  it("strips and reports fake ids sharing a bracket with prose", () => {
    const r = validateCitations("Fact [c_fake9, page 5].", retrieved);
    expect(r.cleanedAnswer).toBe("Fact.");
    expect(r.rejectedIds).toEqual(["c_fake9"]);
    expect(r.segments[0]!.kind).toBe("external");
  });
  it("decides per part in mixed brackets", () => {
    const r = validateCitations("Claim [c_aaa111, c_fake9, page 5].", retrieved);
    expect(r.cleanedAnswer).toBe("Claim [c_aaa111].");
    expect(r.rejectedIds).toEqual(["c_fake9"]);
    expect(r.segments[0]!.citations).toEqual(["c_aaa111"]);
  });
  it("rejects Cyrillic look-alike ids", () => {
    const r = validateCitations("Fact [с_aaa111].", retrieved); // Cyrillic es
    expect(r.validIds).toEqual([]);
    expect(r.rejectedIds).toHaveLength(1);
    expect(r.segments[0]!.kind).toBe("external");
    expect(r.cleanedAnswer).toBe("Fact.");
  });
  it("ignores zero-width chars and normalises fullwidth brackets", () => {
    const zw = validateCitations("Fact [c_aa​a111].", retrieved);
    expect(zw.segments[0]).toMatchObject({ kind: "grounded", citations: ["c_aaa111"] });
    const fw = validateCitations("Fact ［c_aaa111］. Other ［c_zzz9］.", retrieved);
    expect(fw.segments[0]!.citations).toEqual(["c_aaa111"]);
    expect(fw.rejectedIds).toEqual(["c_zzz9"]);
    expect(fw.cleanedAnswer).not.toContain("zzz9");
  });
  it("rejects ids without underscore/digit style", () => {
    const r = validateCitations("A [chunk-a]. B [c9].", retrieved);
    expect(r.rejectedIds).toEqual(["chunk-a", "c9"]);
    expect(r.cleanedAnswer).toBe("A. B.");
  });
  it("a stray '[' cannot make several sentences grounded", () => {
    const r = validateCitations("One [ is odd. Two is plain. Three [c_aaa111].", retrieved);
    const grounded = r.segments.filter((s) => s.kind === "grounded");
    expect(grounded).toHaveLength(1);
    expect(grounded[0]!.text).toContain("Three");
    expect(r.segments.find((s) => s.text.startsWith("Two"))!.kind).toBe("external");
  });
  it("caps input length", () => {
    const r = validateCitations("a".repeat(MAX_ANSWER_CHARS + 500), retrieved);
    expect(r.truncated).toBe(true);
    expect(r.cleanedAnswer.length).toBe(MAX_ANSWER_CHARS);
  });
  it("strips link targets following a citation marker", () => {
    const r = validateCitations("Fact [c_aaa111](https://evil.example/x.y). Next [c_fake9](http://e.com).", retrieved);
    expect(r.cleanedAnswer).not.toContain("evil");
    expect(r.cleanedAnswer).not.toContain("e.com");
    expect(r.segments[0]).toMatchObject({ kind: "grounded", citations: ["c_aaa111"] });
    expect(r.segments).toHaveLength(2);
  });
});
