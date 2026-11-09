import { describe, expect, it } from "vitest";
import { ARCHIVE_LIMITS, checkZipEntries, validateUpload } from "./upload";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const v = (name: string, size = 10, mimeType = "application/pdf") => validateUpload({ name, size, mimeType, headBytes: PDF });

describe("validateUpload security regressions", () => {
  it("rejects prototype-key names cleanly", () => {
    for (const n of ["constructor", "a.constructor", "a.__proto__", "__proto__", "a.tostring", "a.hasownproperty"]) {
      expect(v(n)).toMatchObject({ ok: false, error: "unsupported_extension" });
    }
    // Inherited keys as inner parts are harmless names, not double extensions.
    expect(v("a.__proto__.pdf")).toMatchObject({ ok: true, kind: "pdf" });
  });
  it("rejects dangerous characters in names", () => {
    for (const n of ["a:b.pdf", "a.pdf:x", "a\u202Efdp.exe", "a\u2066b.pdf", "a\x7F.pdf", "a<b>.pdf", 'a"b.pdf', "a|b.pdf", "a?.pdf", "a*.pdf", ".pdf", " .pdf"]) {
      expect(v(n)).toMatchObject({ ok: false, error: "bad_name" });
    }
  });
  it("distinguishes invalid size from empty file", () => {
    expect(v("a.pdf", 0)).toMatchObject({ error: "empty_file" });
    for (const s of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "5" as unknown as number]) {
      expect(v("a.pdf", s)).toMatchObject({ error: "invalid_size" });
    }
  });
  it("rejects extended dangerous inner extensions", () => {
    for (const e of ["php5", "phtml", "phar", "asp", "aspx", "jsp", "shtml", "hta", "wsf", "xlsm", "dotm", "ppsm"]) {
      expect(v(`a.${e}.pdf`)).toMatchObject({ error: "double_extension" });
      expect(v(`a.${e}`)).toMatchObject({ error: "unsupported_extension" });
    }
  });
});

const e = (name: string, c = 100, u = 200) => ({ name, compressedSize: c, uncompressedSize: u });

describe("checkZipEntries", () => {
  it("accepts a normal archive", () => {
    expect(checkZipEntries([e("[Content_Types].xml"), e("word/document.xml")])).toEqual({ ok: true });
  });
  it("rejects traversal and absolute paths", () => {
    for (const n of ["../x", "a/../../x", "a\\..\\x", "/etc/passwd", "\\abs", "C:/x", "c:\\x", ""]) {
      expect(checkZipEntries([e(n)])).toMatchObject({ ok: false, error: "bad_entry_path" });
    }
  });
  it("rejects vbaProject entries", () => {
    expect(checkZipEntries([e("word/vbaProject.bin")])).toMatchObject({ ok: false, error: "macro_content" });
    expect(checkZipEntries([e("xl/VBAPROJECT.bin")])).toMatchObject({ ok: false, error: "macro_content" });
  });
  it("rejects too many entries", () => {
    const many = Array.from({ length: ARCHIVE_LIMITS.maxEntries + 1 }, (_, i) => e(`f${i}`));
    expect(checkZipEntries(many)).toMatchObject({ ok: false, error: "too_many_entries" });
  });
  it("rejects excessive ratio and size", () => {
    expect(checkZipEntries([e("a", 1, ARCHIVE_LIMITS.maxCompressionRatio + 1)])).toMatchObject({ error: "ratio_exceeded" });
    expect(checkZipEntries([e("a", 0, 5)])).toMatchObject({ error: "ratio_exceeded" });
    const big = ARCHIVE_LIMITS.maxUncompressedBytes;
    expect(checkZipEntries([e("a", big, big + 1)])).toMatchObject({ error: "entry_too_large" });
    expect(checkZipEntries([e("a", big / 2, big / 2 + 1), e("b", big / 2, big / 2)])).toMatchObject({ error: "entry_too_large" });
  });
  it("rejects invalid sizes and shapes", () => {
    expect(checkZipEntries([e("a", -1, 1)])).toMatchObject({ error: "invalid_entries" });
    expect(checkZipEntries([e("a", 1, NaN)])).toMatchObject({ error: "invalid_entries" });
    expect(checkZipEntries(null as never)).toMatchObject({ error: "invalid_entries" });
  });
});
