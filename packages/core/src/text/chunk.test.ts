import { describe, expect, it } from "vitest";
import { chunkId, chunkPages, cleanText } from "./chunk";

describe("cleanText", () => {
  it("strips control chars and collapses whitespace", () => {
    expect(cleanText("a\u0000b\u0007  c\t\td​")).toBe("ab c d");
    expect(cleanText("x\r\n\r\n\r\n\r\ny")).toBe("x\n\ny");
  });
  it("de-hyphenates line breaks", () => {
    expect(cleanText("infor-\nmation retrieval")).toBe("information retrieval");
    expect(cleanText("təhsil-\nməktəb")).toBe("təhsilməktəb");
    expect(cleanText("well-\nKnown")).toBe("well-\nKnown");
    expect(cleanText("a - b")).toBe("a - b");
  });
});

describe("chunkPages", () => {
  const pages = [
    { page: 1, text: "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu." },
    { page: 2, text: "" },
    { page: 3, text: "Ə ğ ı ö ü ç ş ".repeat(20) },
  ];
  const opts = { maxChars: 30, overlap: 5, docId: "doc1" };

  it("is deterministic / idempotent", () => {
    expect(chunkPages(pages, opts)).toEqual(chunkPages(pages, opts));
  });
  it("respects maxChars, keeps page numbers, skips empty pages", () => {
    const chunks = chunkPages(pages, opts);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(30);
      expect(c.page).toBe(c.pageEnd);
      expect([1, 3]).toContain(c.page);
    }
    expect(chunks.some((c) => c.page === 1)).toBe(true);
    expect(chunks.some((c) => c.page === 3)).toBe(true);
  });
  it("ids are unique and depend on docId", () => {
    const a = chunkPages(pages, opts);
    expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
    const b = chunkPages(pages, { ...opts, docId: "doc2" });
    expect(b[0]!.id).not.toBe(a[0]!.id);
    expect(chunkId("d", 1, 0)).toBe(chunkId("d", 1, 0));
    expect(chunkId("d", 1, 0)).not.toBe(chunkId("d", 2, 0));
  });
  it("covers all words (no text lost)", () => {
    const chunks = chunkPages([pages[0]!], opts);
    const joined = chunks.map((c) => c.text).join(" ");
    for (const w of ["Alpha", "kappa", "mu."]) expect(joined).toContain(w);
  });
  it("overlap repeats trailing context", () => {
    const chunks = chunkPages([{ page: 1, text: "abcdefghijklmnopqrstuvwxyz" }], { maxChars: 10, overlap: 3, docId: "d" });
    expect(chunks[0]!.text).toBe("abcdefghij");
    expect(chunks[1]!.text.startsWith("hij")).toBe(true);
  });
  it("rejects bad options", () => {
    expect(() => chunkPages(pages, { maxChars: 0, overlap: 0 })).toThrow(RangeError);
    expect(() => chunkPages(pages, { maxChars: 10, overlap: 10 })).toThrow(RangeError);
  });
});
