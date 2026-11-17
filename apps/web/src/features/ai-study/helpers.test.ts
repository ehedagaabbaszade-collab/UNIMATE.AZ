import { describe, expect, it } from "vitest";
import { pageLabels } from "./helpers";

const t = (k: string, v: Record<string, number>) => (k === "chat.pageSingle" ? `p. ${v.n}` : `p. ${v.a}-${v.b}`);

describe("pageLabels", () => {
  it("dedupes, formats ranges and skips pageless citations", () => {
    expect(pageLabels([{ page_start: 3, page_end: 3 }, { page_start: 3, page_end: null }, { page_start: 5, page_end: 7 }, { page_start: null, page_end: null }], t)).toBe("p. 3, p. 5-7");
    expect(pageLabels([{ page_start: null, page_end: null }], t)).toBe("");
  });
});
