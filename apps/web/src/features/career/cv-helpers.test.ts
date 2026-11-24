import { emptyCv, type CvDesignSection } from "@unimate/core";
import { describe, expect, it } from "vitest";
import { saveCvGuarded } from "./cv-autosave";
import { normalizeHex } from "./cv-colors";
import { HISTORY_LIMIT, initHistory, pushHistory, redo, undo } from "./cv-history";
import { mergeProfileImport } from "./cv-import";
import { dropSection, moveItem, moveSectionBy, patchDesign, toggleHidden } from "./cv-sections";

describe("history", () => {
  it("undoes and redoes, and a new edit clears redo", () => {
    let h = initHistory(1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = redo(h);
    expect(h.present).toBe(3);
    h = undo(undo(h));
    h = pushHistory(h, 9);
    expect(h.present).toBe(9);
    expect(redo(h)).toBe(h);
  });
  it("coalesces fast edits but always records the first", () => {
    let h = pushHistory(initHistory("a"), "ab", true);
    expect(h.past).toEqual(["a"]);
    h = pushHistory(h, "abc", true);
    expect(h.past).toEqual(["a"]);
    expect(undo(h).present).toBe("a");
  });
  it("keeps at most 100 snapshots and ignores identical pushes", () => {
    let h = initHistory(0);
    for (let i = 1; i <= 150; i++) h = pushHistory(h, i);
    expect(h.past.length).toBe(HISTORY_LIMIT);
    expect(pushHistory(h, 150)).toBe(h);
    expect(undo(initHistory(0)).present).toBe(0);
  });
});

describe("sections", () => {
  const order: CvDesignSection[] = ["summary", "experience", "education"];
  it("moves items and clamps", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 5, 0)).toEqual([1, 2, 3]);
  });
  it("completes a partial order and moves a section by one", () => {
    const next = moveSectionBy(order, "education", -1);
    expect(next.slice(0, 3)).toEqual(["summary", "education", "experience"]);
    expect(new Set(next).size).toBe(next.length);
    expect(next.length).toBeGreaterThan(3);
  });
  it("drops a section onto another", () => {
    expect(dropSection(order, "education", "summary").slice(0, 3)).toEqual(["education", "summary", "experience"]);
  });
  it("toggles hidden and patches design without undefined keys", () => {
    expect(toggleHidden([], "skills")).toEqual(["skills"]);
    expect(toggleHidden(["skills"], "skills")).toEqual([]);
    expect(patchDesign({ font: "inter", primary: "#111111" }, { primary: undefined, mode: "ats" })).toEqual({ font: "inter", mode: "ats" });
  });
  it("normalises hex colours", () => {
    expect(normalizeHex("4f46e5")).toBe("#4F46E5");
    expect(normalizeHex("#12")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
  });
});

describe("profile import merge", () => {
  const src = { fullName: "Aysel M", email: "a@b.az", university: "ADA University", major: "Computer Science" };
  const all = { name: true, email: true, education: true, overwrite: false };
  it("fills only empty fields and adds an education entry", () => {
    const cv = emptyCv();
    cv.personal.fullName = "Already Set";
    const r = mergeProfileImport(cv, src, all);
    expect(r.data.personal.fullName).toBe("Already Set");
    expect(r.data.personal.email).toBe("a@b.az");
    expect(r.data.education).toHaveLength(1);
    expect(r.changed).toBe(2);
    expect(cv.personal.email).toBe("");
  });
  it("overwrites only when asked, and reuses a matching institution", () => {
    const cv = emptyCv();
    cv.personal.fullName = "Old";
    cv.education = [{ ...mergeProfileImport(emptyCv(), src, all).data.education[0]!, field: "Law" }];
    expect(mergeProfileImport(cv, src, all).data.education[0]!.field).toBe("Law");
    const r = mergeProfileImport(cv, src, { ...all, overwrite: true });
    expect(r.data.personal.fullName).toBe("Aysel M");
    expect(r.data.education).toHaveLength(1);
    expect(r.data.education[0]!.field).toBe("Computer Science");
  });
  it("reports no change and returns the same object", () => {
    const cv = emptyCv();
    expect(mergeProfileImport(cv, src, { name: false, email: false, education: false, overwrite: true })).toEqual({ data: cv, changed: 0 });
  });
});

type Rows = { data: unknown; error: { message: string; code?: string } | null } | "throw";
const fakeSb = (result: Rows) => {
  const calls: Array<[string, unknown]> = [];
  const q: Record<string, unknown> = {
    update: (v: unknown) => (calls.push(["update", v]), q),
    eq: (c: string, v: unknown) => (calls.push([c, v]), q),
    select: () => (result === "throw" ? Promise.reject(new Error("x")) : Promise.resolve(result)),
  };
  return { sb: { from: () => q } as never, calls };
};
const input = () => ({ title: "T", language: "en" as const, template: "corporate" as const, data: emptyCv(), design: { font: "inter" as const } });

describe("saveCvGuarded", () => {
  it("saves and returns the new updated_at, matching on the loaded updated_at", async () => {
    const { sb, calls } = fakeSb({ data: [{ updated_at: "2026-01-02T00:00:00.5+00:00" }], error: null });
    expect(await saveCvGuarded(sb, "id1", input(), "2026-01-01T00:00:00+00:00")).toEqual({ kind: "saved", updatedAt: "2026-01-02T00:00:00.5+00:00" });
    expect(calls).toContainEqual(["updated_at", "2026-01-01T00:00:00+00:00"]);
  });
  it("reports a conflict when no row matched", async () => {
    expect(await saveCvGuarded(fakeSb({ data: [], error: null }).sb, "id1", input(), "x")).toEqual({ kind: "conflict" });
  });
  it("reports offline for network failures and error for server errors", async () => {
    expect(await saveCvGuarded(fakeSb("throw").sb, "id1", input(), "x")).toEqual({ kind: "offline" });
    expect(await saveCvGuarded(fakeSb({ data: null, error: { message: "TypeError: Failed to fetch" } }).sb, "id1", input(), "x")).toEqual({ kind: "offline" });
    expect(await saveCvGuarded(fakeSb({ data: null, error: { message: "boom", code: "42501" } }).sb, "id1", input(), "x")).toEqual({ kind: "error" });
  });
  it("refuses an invalid design before any request", async () => {
    const { sb, calls } = fakeSb({ data: [], error: null });
    expect(await saveCvGuarded(sb, "id1", { ...input(), design: { primary: "red" } as never }, "x")).toEqual({ kind: "invalid" });
    expect(calls).toHaveLength(0);
  });
});
