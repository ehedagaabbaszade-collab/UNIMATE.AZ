import { describe, expect, it } from "vitest";
import { canStudyWithAi, mapSearchRow, noteStatusView, parseTags, precheckNoteFile, validateNoteForm } from "./notes";

const pdfHead = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const pngHead = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("precheckNoteFile", () => {
  it("accepts pdf and (unlike documents) images; rejects mismatches", () => {
    expect(precheckNoteFile({ name: "Lecture 1.pdf", size: 10, mimeType: "application/pdf", head: pdfHead })).toMatchObject({ ok: true, extension: "pdf", suggestedTitle: "Lecture 1" });
    expect(precheckNoteFile({ name: "scan.png", size: 10, mimeType: "image/png", head: pngHead })).toMatchObject({ ok: true, fileKind: "png" });
    expect(precheckNoteFile({ name: "x.pdf", size: 10, mimeType: "application/pdf", head: pngHead })).toEqual({ ok: false, error: "magic_mismatch" });
    expect(precheckNoteFile({ name: "x.exe", size: 10, mimeType: "application/pdf", head: pdfHead })).toMatchObject({ ok: false });
    expect(precheckNoteFile({ name: "x.pdf", size: 0, mimeType: "application/pdf", head: pdfHead })).toEqual({ ok: false, error: "empty_file" });
    expect(precheckNoteFile({ name: "x.png", size: 11 * 1024 * 1024, mimeType: "image/png", head: pngHead })).toEqual({ ok: false, error: "too_large" });
  });
});

describe("canStudyWithAi", () => {
  it("documents yes, images and unknown no", () => {
    expect(canStudyWithAi("application/pdf")).toBe(true);
    expect(canStudyWithAi("image/png")).toBe(false);
    expect(canStudyWithAi(null)).toBe(false);
    expect(canStudyWithAi("text/html")).toBe(false);
  });
});

describe("parseTags", () => {
  it("normalises, dedupes, truncates and flags overflow", () => {
    expect(parseTags(" Final, final ;  Riyaziyyat\nİMTAHAN ").tags.slice(0, 2)).toEqual(["final", "riyaziyyat"]);
    expect(parseTags(" Final, final ;  Riyaziyyat\nİMTAHAN ").tags).toHaveLength(3);
    expect(parseTags("a".repeat(50)).tags[0]).toHaveLength(30);
    expect(parseTags("1,2,3,4,5,6,7,8,9")).toMatchObject({ tooMany: true });
    expect(parseTags("1,2,3,4,5,6,7,8").tooMany).toBe(false);
    expect(parseTags(" , ;; ").tags).toEqual([]);
  });
});

describe("validateNoteForm", () => {
  const ok = { title: " Calculus ", description: " ", kind: "note", courseId: "", visibility: "university", tagsText: "x", hasFile: true };
  it("normalises valid input", () => {
    expect(validateNoteForm(ok)).toEqual({ ok: true, value: { title: "Calculus", description: null, kind: "note", courseId: null, visibility: "university", tags: ["x"] } });
  });
  it("reports every problem", () => {
    const r = validateNoteForm({ ...ok, title: " ", hasFile: false, kind: "zzz", visibility: "all", tagsText: "1,2,3,4,5,6,7,8,9", description: "d".repeat(2001) });
    expect(r).toEqual({ ok: false, errors: { title: "title_required", file: "file_required", kind: "kind_invalid", visibility: "visibility_invalid", tags: "too_many_tags", description: "description_too_long" } });
    expect(validateNoteForm({ ...ok, title: "t".repeat(201) })).toMatchObject({ ok: false, errors: { title: "title_too_long" } });
  });
});

describe("mapSearchRow / noteStatusView", () => {
  it("coerces PostgREST numerics and bad enums defensively", () => {
    const r = mapSearchRow({ id: "1", title: "T", kind: "weird", tags: ["a", 3], avg_rating: "4.50", rating_count: 2, save_count: "1", size_bytes: "2048", created_at: "2026-01-01", uploader_id: "u", saved: true });
    expect(r).toMatchObject({ kind: "other", tags: ["a"], avgRating: 4.5, ratingCount: 2, saveCount: 1, sizeBytes: 2048, saved: true, uploaderName: null });
  });
  it("shows under_review for a held pending resource", () => {
    expect(noteStatusView("pending", true)).toBe("under_review");
    expect(noteStatusView("pending", false)).toBe("pending");
    expect(noteStatusView("published", true)).toBe("published");
  });
});
