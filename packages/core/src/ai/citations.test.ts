import { describe, expect, it } from "vitest";
import { validateCitations } from "./citations";

const retrieved = [{ id: "c_aaa111" }, { id: "c_bbb222" }];

describe("validateCitations", () => {
  it("keeps valid citations and marks segments grounded", () => {
    const r = validateCitations("Mitosis has four phases [c_aaa111]. It is cool.", retrieved);
    expect(r.hadInvalid).toBe(false);
    expect(r.validIds).toEqual(["c_aaa111"]);
    expect(r.segments[0]).toMatchObject({ kind: "grounded", citations: ["c_aaa111"] });
    expect(r.segments[1]).toMatchObject({ kind: "external", citations: [] });
  });
  it("strips hallucinated ids and never fabricates", () => {
    const r = validateCitations("Fact one [c_zzz999]. Fact two [c_bbb222].", retrieved);
    expect(r.rejectedIds).toEqual(["c_zzz999"]);
    expect(r.hadInvalid).toBe(true);
    expect(r.cleanedAnswer).not.toContain("c_zzz999");
    expect(r.cleanedAnswer).toContain("[c_bbb222]");
    expect(r.segments[0]!.kind).toBe("external");
    expect(r.segments[1]!.kind).toBe("grounded");
    expect(r.validIds).not.toContain("c_zzz999");
  });
  it("handles mixed multi-id markers", () => {
    const r = validateCitations("Claim [c_aaa111, c_fake1].", retrieved);
    expect(r.cleanedAnswer).toBe("Claim [c_aaa111].");
    expect(r.rejectedIds).toEqual(["c_fake1"]);
    expect(r.segments[0]!.kind).toBe("grounded");
  });
  it("answer with only hallucinated citations is wholly external", () => {
    const r = validateCitations("Everything [c_x1] is [c_y2] made up.", retrieved);
    expect(r.validIds).toEqual([]);
    expect(r.segments.every((s) => s.kind === "external")).toBe(true);
  });
  it("rejects invalid structured citations", () => {
    const r = validateCitations("No markers here.", retrieved, ["c_aaa111", "c_nope9"]);
    expect(r.validIds).toEqual(["c_aaa111"]);
    expect(r.rejectedIds).toEqual(["c_nope9"]);
  });
  it("leaves ordinary bracket text alone", () => {
    const r = validateCitations("See [note] and [1] for details.", retrieved);
    expect(r.cleanedAnswer).toBe("See [note] and [1] for details.");
    expect(r.hadInvalid).toBe(false);
  });
  it("empty retrieved set rejects every citation", () => {
    const r = validateCitations("A [c_aaa111].", []);
    expect(r.validIds).toEqual([]);
    expect(r.rejectedIds).toEqual(["c_aaa111"]);
  });
  it("handles empty answer", () => {
    expect(validateCitations("", retrieved).segments).toEqual([]);
  });
});
