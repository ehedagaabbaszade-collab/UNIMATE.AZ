import { emptyCv } from "@unimate/core";
import { describe, expect, it } from "vitest";
import { HISTORY_MAX, classifySave, historyInit, historyPush, historyRedo, historyUndo, isHex, mergeEducation, mergeImport, moveItem, orphanPaths, parseDraft, pdfFileName, serializeDraft } from "./cv-helpers";

describe("history", () => {
  it("undoes, redoes and drops the redo branch on a new edit", () => {
    let h = historyInit(0);
    h = historyPush(historyPush(h, 1), 2);
    h = historyUndo(h);
    expect(h.present).toBe(1);
    expect(historyRedo(h).present).toBe(2);
    h = historyPush(h, 9);
    expect(h.future).toEqual([]);
    expect(historyRedo(h)).toBe(h);
  });
  it("caps the undo stack at 100", () => {
    let h = historyInit(0);
    for (let i = 1; i <= 150; i++) h = historyPush(h, i);
    expect(h.past).toHaveLength(HISTORY_MAX);
    expect(h.past[0]).toBe(50);
  });
});
describe("moveItem", () => {
  it("swaps neighbours and ignores out-of-range moves", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});
describe("mergeImport", () => {
  const base = emptyCv();
  base.personal.fullName = "Existing";
  it("fills only empty fields by default", () => {
    const r = mergeImport(base, { fullName: "New", email: "a@b.az" }, ["fullName", "email", "phone"], false);
    expect(r.personal.fullName).toBe("Existing");
    expect(r.personal.email).toBe("a@b.az");
    expect(r.personal.phone).toBe("");
  });
  it("overwrites when ticked, never with blanks, never mutates the input", () => {
    const r = mergeImport(base, { fullName: "New", email: " " }, ["fullName", "email"], true);
    expect(r.personal.fullName).toBe("New");
    expect(r.personal.email).toBe("");
    expect(base.personal.fullName).toBe("Existing");
  });
});
describe("classifySave", () => {
  it("separates saved, conflict, offline and error", () => {
    expect(classifySave({ data: [{ updated_at: "t2" }], error: null })).toEqual({ kind: "saved", updatedAt: "t2" });
    expect(classifySave({ data: [], error: null })).toEqual({ kind: "conflict" });
    expect(classifySave({ data: null, error: { message: "Network request failed" } })).toEqual({ kind: "offline" });
    expect(classifySave({ data: null, error: { message: "check constraint" } })).toEqual({ kind: "error" });
  });
});
describe("misc", () => {
  it("validates hex colours", () => {
    expect(isHex("#1F3A5F")).toBe(true);
    expect(isHex("#12345")).toBe(false);
    expect(isHex("red")).toBe(false);
  });
  it("builds safe PDF names", () => {
    expect(pdfFileName("Əhməd / CV: 2026")).toBe("Əhməd-CV-2026.pdf");
    expect(pdfFileName("///")).toBe("CV.pdf");
  });
  it("keeps referenced photos, orphans the rest", () => {
    expect(orphanPaths(["a", "b", "b", "c"], ["a", undefined, "c"])).toEqual(["b"]);
  });
});

describe("local draft", () => {
  const doc = { title: "T", language: "az" as const, template: "corporate" as const, design: { primary: "#111111" as const }, data: emptyCv() };
  it("restores only for the matching server version", () => {
    const raw = serializeDraft("v1", doc);
    expect(parseDraft(raw, "v1")?.design).toEqual({ primary: "#111111" });
    expect(parseDraft(raw, "v2")).toBeNull();
    expect(parseDraft("{bad", "v1")).toBeNull();
    expect(parseDraft(null, "v1")).toBeNull();
  });
});

describe("mergeEducation", () => {
  it("adds once, never duplicates an institution, ignores blanks", () => {
    const a = mergeEducation(emptyCv(), { institution: "ADA University", field: "CS" });
    expect(a.education).toHaveLength(1);
    expect(mergeEducation(a, { institution: "ada university", field: "" })).toBe(a);
    expect(mergeEducation(a, { institution: " ", field: "" })).toBe(a);
  });
});
