import { describe, expect, it } from "vitest";
import { precheckFile, storagePathFor } from "./upload";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

describe("precheckFile", () => {
  it("accepts a real PDF and derives a title", () => {
    expect(precheckFile({ name: "Lecture 3.pdf", size: 1000, mimeType: "application/pdf", head: PDF })).toEqual({ ok: true, extension: "pdf", mimeType: "application/pdf", title: "Lecture 3" });
  });
  it("accepts docx as a zip container", () => {
    const r = precheckFile({ name: "n.docx", size: 10, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", head: ZIP });
    expect(r.ok).toBe(true);
  });
  it("rejects spoofed content, double extensions and empty files via core validateUpload", () => {
    expect(precheckFile({ name: "a.pdf", size: 5, mimeType: "application/pdf", head: PNG })).toEqual({ ok: false, error: "magic_mismatch" });
    expect(precheckFile({ name: "a.pdf.exe", size: 5, mimeType: "application/pdf", head: PDF })).toMatchObject({ ok: false });
    expect(precheckFile({ name: "a.pdf", size: 0, mimeType: "application/pdf", head: PDF })).toEqual({ ok: false, error: "empty_file" });
    expect(precheckFile({ name: "a.pdf", size: 60 * 1024 * 1024, mimeType: "application/pdf", head: PDF })).toEqual({ ok: false, error: "too_large" });
  });
  it("rejects images that core accepts but the storage bucket does not", () => {
    expect(precheckFile({ name: "scan.png", size: 100, mimeType: "image/png", head: PNG })).toEqual({ ok: false, error: "image_unsupported" });
  });
});

describe("storagePathFor", () => {
  it("is under the owner uid folder (storage policy + documents check constraint)", () => {
    expect(storagePathFor("u1", "o1", "pdf")).toBe("u1/o1.pdf");
  });
});
