import { describe, expect, it } from "vitest";
import { validateUpload } from "./upload";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

describe("validateUpload", () => {
  it("accepts valid files", () => {
    expect(validateUpload({ name: "Notes.PDF", size: 1000, mimeType: "application/pdf", headBytes: PDF })).toMatchObject({ ok: true, kind: "pdf" });
    expect(validateUpload({ name: "a.docx", size: 1000, mimeType: DOCX_MIME, headBytes: ZIP })).toMatchObject({ ok: true, kind: "docx" });
    expect(validateUpload({ name: "a.pptx", size: 1000, mimeType: PPTX_MIME, headBytes: ZIP })).toMatchObject({ ok: true, kind: "pptx" });
    expect(validateUpload({ name: "a.png", size: 10, mimeType: "image/png", headBytes: PNG })).toMatchObject({ ok: true, kind: "png" });
    expect(validateUpload({ name: "a.jpeg", size: 10, mimeType: "image/jpeg", headBytes: JPG })).toMatchObject({ ok: true, kind: "jpg" });
    expect(validateUpload({ name: "lecture notes ə.pdf", size: 10, mimeType: "application/pdf; charset=binary", headBytes: PDF })).toMatchObject({ ok: true });
  });
  it("rejects empty and too large", () => {
    expect(validateUpload({ name: "a.pdf", size: 0, mimeType: "application/pdf", headBytes: PDF })).toMatchObject({ error: "empty_file" });
    expect(validateUpload({ name: "a.png", size: 11 * 1024 * 1024, mimeType: "image/png", headBytes: PNG })).toMatchObject({ error: "too_large" });
  });
  it("rejects double extensions", () => {
    expect(validateUpload({ name: "invoice.pdf.exe", size: 10, mimeType: "application/pdf", headBytes: PDF })).toMatchObject({ ok: false });
    expect(validateUpload({ name: "invoice.exe.pdf", size: 10, mimeType: "application/pdf", headBytes: PDF })).toMatchObject({ error: "double_extension" });
    expect(validateUpload({ name: "a.pdf.pdf", size: 10, mimeType: "application/pdf", headBytes: PDF })).toMatchObject({ error: "double_extension" });
  });
  it("rejects unsupported / missing extensions and bad names", () => {
    expect(validateUpload({ name: "a.txt", size: 10, mimeType: "text/plain", headBytes: PDF })).toMatchObject({ error: "unsupported_extension" });
    expect(validateUpload({ name: "noext", size: 10, mimeType: "application/pdf", headBytes: PDF })).toMatchObject({ error: "unsupported_extension" });
    expect(validateUpload({ name: "../a.pdf", size: 10, mimeType: "application/pdf", headBytes: PDF })).toMatchObject({ error: "bad_name" });
  });
  it("rejects MIME mismatch", () => {
    expect(validateUpload({ name: "a.pdf", size: 10, mimeType: "image/png", headBytes: PDF })).toMatchObject({ error: "mime_mismatch" });
  });
  it("rejects magic-byte mismatch (spoofed content)", () => {
    expect(validateUpload({ name: "a.pdf", size: 10, mimeType: "application/pdf", headBytes: PNG })).toMatchObject({ error: "magic_mismatch" });
    expect(validateUpload({ name: "a.docx", size: 10, mimeType: DOCX_MIME, headBytes: PDF })).toMatchObject({ error: "magic_mismatch" });
    expect(validateUpload({ name: "a.png", size: 10, mimeType: "image/png", headBytes: ZIP })).toMatchObject({ error: "magic_mismatch" });
    expect(validateUpload({ name: "a.pdf", size: 10, mimeType: "application/pdf", headBytes: new Uint8Array([1, 2, 3]) })).toMatchObject({ error: "unknown_content" });
  });
});
