import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildDocx, buildPdf, buildPptx } from "./fixtures";
import { extractDocx, extractPptx } from "./extract/office";
import { extractPdf } from "./extract/pdf";
import { assertSafeArchive, readCentralDirectory } from "./extract/zip";
import { TESSERACT_LANG, tesseractLangString } from "./ocr";
import { PipelineError } from "./errors";

const AZ = "Əhməd Çingiz ğüşöı İstanbul — Azərbaycan dili: ə ğ ı ö ü ç ş İ";

describe("PDF", () => {
  it("extracts text per page (generated fixture), blank page has hasText=false", async () => {
    const pages = await extractPdf(await buildPdf(["Hello page one", null, "Third page text"]));
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(pages[0]!.text).toContain("Hello page one");
    expect(pages[1]!.hasText).toBe(false);
    expect(pages[2]!.text).toContain("Third page text");
  });
  it("corrupted PDF -> non-retryable corrupt_pdf", async () => {
    const bad = new TextEncoder().encode("%PDF-1.4\n1 0 obj <<garbage>> \u0000\u0001");
    await expect(extractPdf(bad)).rejects.toMatchObject({ code: "corrupt_pdf", retryable: false });
  });
  it("truncated PDF -> corrupt_pdf or empty pages, never a crash", async () => {
    const good = await buildPdf(["Hello"]);
    const r = await extractPdf(good.slice(0, Math.floor(good.length / 2))).catch((e) => e);
    if (r instanceof Error) expect(r).toBeInstanceOf(PipelineError);
  });
});

describe("DOCX / PPTX", () => {
  it("DOCX keeps Azerbaijani letters and XML entities", async () => {
    const pages = await extractDocx(await buildDocx([AZ, "a < b & c"]));
    expect(pages).toHaveLength(1);
    expect(pages[0]!.text.trim()).toBe(`${AZ}
a < b & c`);
  });
  it("PPTX: one page per slide in numeric order, Azerbaijani preserved", async () => {
    const slides = Array.from({ length: 11 }, (_, i) => [`Slayd ${i + 1}`, i === 0 ? AZ : "x"]);
    const pages = await extractPptx(await buildPptx(slides));
    expect(pages).toHaveLength(11);
    expect(pages[1]!.text).toContain("Slayd 2");
    expect(pages[9]!.text).toContain("Slayd 10"); // slide10 sorts after slide2 numerically
    expect(pages[0]!.text).toContain(AZ);
  });
  it("PPTX without slides is rejected", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "x");
    await expect(extractPptx(await zip.generateAsync({ type: "uint8array" }))).rejects.toMatchObject({ code: "corrupt_document" });
  });
});

describe("archive safety (checked from the central directory BEFORE inflating)", () => {
  it("truncated zip -> corrupt_archive", async () => {
    const z = await buildDocx(["hello"]);
    await expect(extractDocx(z.slice(0, z.length - 30))).rejects.toMatchObject({ code: "corrupt_archive", retryable: false });
    await expect(extractDocx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).rejects.toMatchObject({ code: "corrupt_archive" });
  });

  it("real compression bomb (3 MB of zeros in ~3 KB) -> ratio_exceeded without inflating", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", new Uint8Array(3 * 1024 * 1024));
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
    expect(bytes.length).toBeLessThan(10_000);
    expect(() => assertSafeArchive(bytes)).toThrowError(/ratio_exceeded/);
    await expect(extractDocx(bytes)).rejects.toMatchObject({ code: "archive_rejected", retryable: false });
  });

  it("forged central directory claiming a 500 MB entry -> entry_too_large", async () => {
    const bytes = await buildDocx(["hello"]);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < bytes.length - 4; i++)
      if (dv.getUint32(i, true) === 0x02014b50) {
        dv.setUint32(i + 24, 500 * 1024 * 1024, true);
        break;
      }
    expect(readCentralDirectory(bytes)[0]!.uncompressedSize).toBe(500 * 1024 * 1024);
    await expect(extractDocx(bytes)).rejects.toMatchObject({ code: "archive_rejected" });
  });

  it("macro content (vbaProject.bin) is rejected", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document/>");
    zip.file("word/vbaProject.bin", "x".repeat(10));
    await expect(extractDocx(await zip.generateAsync({ type: "uint8array" }))).rejects.toMatchObject({ code: "archive_rejected" });
  });
});

describe("OCR language mapping", () => {
  it("maps az/tr/ru/en to tesseract codes (aze is a tesseract.js 7 language constant)", () => {
    expect(TESSERACT_LANG).toEqual({ az: "aze", tr: "tur", ru: "rus", en: "eng" });
    expect(tesseractLangString(["az", "tr", "ru", "en"])).toBe("aze+tur+rus+eng");
    expect(() => tesseractLangString(["xx"])).toThrow(RangeError);
  });
});

describe("zip parser-differential and decode-bomb hardening", () => {
  const u32 = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
  const eocdAt = (b: Uint8Array) => {
    for (let i = b.length - 22; i >= 0; i--) if (u32(b).getUint32(i, true) === 0x06054b50) return i;
    throw new Error("no eocd");
  };
  const cat = (...p: Uint8Array[]) => {
    const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
    let at = 0;
    for (const x of p) {
      out.set(x, at);
      at += x.length;
    }
    return out;
  };
  /** Rebuilds the archive with `extraCd` appended to the central directory and/or `gap` bytes before the EOCD. */
  const tamper = (b: Uint8Array, o: { extraCd?: Uint8Array; gap?: number; bumpTotal?: boolean }) => {
    const e = eocdAt(b);
    const cdOffset = u32(b).getUint32(e + 16, true);
    const cdSize = u32(b).getUint32(e + 12, true);
    const eocd = b.slice(e);
    const extra = o.extraCd ?? new Uint8Array(0);
    const gap = new Uint8Array(o.gap ?? 0);
    const dv = u32(eocd);
    if (o.extraCd) dv.setUint32(12, cdSize + extra.length, true);
    if (o.bumpTotal) {
      dv.setUint16(8, dv.getUint16(8, true) + 1, true);
      dv.setUint16(10, dv.getUint16(10, true) + 1, true);
    }
    return cat(b.slice(0, cdOffset + cdSize), extra, gap, eocd);
  };
  const firstCdRecord = (b: Uint8Array) => {
    const cdOffset = u32(b).getUint32(eocdAt(b) + 16, true);
    const d = u32(b);
    const len = 46 + d.getUint16(cdOffset + 28, true) + d.getUint16(cdOffset + 30, true) + d.getUint16(cdOffset + 32, true);
    return b.slice(cdOffset, cdOffset + len);
  };

  it("lying declared size (central AND local header) cannot defeat the streaming byte cap", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", new Uint8Array(3 * 1024 * 1024));
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
    const d = u32(bytes);
    const claim = 200 * 1024; // ratio < 100, so checkZipEntries passes
    for (let i = 0; i < bytes.length - 30; i++) {
      if (d.getUint32(i, true) === 0x02014b50 && d.getUint32(i + 20, true) > 0) d.setUint32(i + 24, claim, true);
      if (d.getUint32(i, true) === 0x04034b50 && d.getUint32(i + 18, true) > 0) d.setUint32(i + 22, claim, true);
    }
    expect(bytes.length).toBeGreaterThan(claim / 100);
    expect(() => assertSafeArchive(bytes)).not.toThrow();
    // decoding is capped at min(limit, declared size): rejected as soon as the real size exceeds the claim
    await expect(extractDocx(bytes, { limits: { maxPartBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 } })).rejects.toBeInstanceOf(PipelineError);
    // even with a generous cap, the real size must equal the declared size
    await expect(extractDocx(bytes)).rejects.toMatchObject({ code: "corrupt_archive" });
  });

  it("total decoded cap is enforced across parts (small-per-part, large-in-sum)", async () => {
    const bytes = await buildPptx(Array.from({ length: 6 }, () => ["x".repeat(600)]));
    await expect(extractPptx(bytes, { limits: { maxPartBytes: 10_000, maxTotalBytes: 2_000 } })).rejects.toMatchObject({ code: "archive_rejected" });
  });

  it("extra central-directory record shadowing word/document.xml (cdSize bumped, total not) -> rejected", async () => {
    const good = await buildDocx(["real text"]);
    // a second record named word/document.xml pointing at the first entry's data
    const rec = firstCdRecord(good);
    const t = tamper(good, { extraCd: rec });
    await expect(extractDocx(t)).rejects.toMatchObject({ code: "corrupt_archive", retryable: false });
  });

  it("duplicate entry names (cdSize and total both bumped) -> rejected", async () => {
    const good = await buildDocx(["real text"]);
    const t = tamper(good, { extraCd: firstCdRecord(good), bumpTotal: true });
    await expect(extractDocx(t)).rejects.toMatchObject({ code: "archive_rejected", message: expect.stringMatching(/duplicate/) });
  });

  it("gap between the central directory and the EOCD -> rejected", async () => {
    const good = await buildDocx(["real text"]);
    await expect(extractDocx(tamper(good, { gap: 12 }))).rejects.toMatchObject({ code: "corrupt_archive" });
  });

  it("local header name differing from the central directory -> rejected", async () => {
    const good = await buildDocx(["real text"]);
    const t = good.slice();
    const d = u32(t);
    for (let i = 0; i < t.length - 40; i++)
      if (d.getUint32(i, true) === 0x04034b50 && new TextDecoder().decode(t.subarray(i + 30, i + 30 + 17)) === "word/document.xml") {
        t[i + 30] = "W".charCodeAt(0);
        break;
      }
    await expect(extractDocx(t)).rejects.toMatchObject({ code: "corrupt_archive" });
  });

  it("page cap is checked from the entry list before any slide is inflated", async () => {
    const bytes = await buildPptx(Array.from({ length: 5 }, (_, i) => [`s${i}`]));
    const seen: number[] = [];
    await expect(
      extractPptx(bytes, {
        limits: { maxPartBytes: 1, maxTotalBytes: 1 }, // would fail on the first inflate
        checkPages: (n) => {
          seen.push(n);
          throw new PipelineError("quota_exceeded", "too many pages", false);
        },
      }),
    ).rejects.toMatchObject({ code: "quota_exceeded" });
    expect(seen).toEqual([5]);
  });

  it("PDF page cap is checked before text extraction", async () => {
    const pdf = await buildPdf(["a", "b", "c"]);
    await expect(
      extractPdf(pdf, {
        checkPages: (n) => {
          if (n > 2) throw new PipelineError("quota_exceeded", "too many pages", false);
        },
      }),
    ).rejects.toMatchObject({ code: "quota_exceeded" });
  });
});

describe("assertStoragePath", () => {
  const U = "aaaaaaaa-2222-4333-8444-555555555555";
  it("accepts <owner>/<flat safe name> only", async () => {
    const { assertStoragePath } = await import("./storage-path");
    expect(() => assertStoragePath(`${U}/My notes_v2-final.1.pdf`, U)).not.toThrow();
    for (const bad of [`${U}/a/b.pdf`, `${U}/../x.pdf`, `${U}/a..b`, `${U}/`, `${U}/x\n.pdf`, `${U.toUpperCase()}/x.pdf`, `/${U}/x.pdf`, `other/x.pdf`, `${U}/ə.pdf`, ""])
      expect(() => assertStoragePath(bad, U), bad).toThrowError(/Invalid storage path/);
    expect(() => assertStoragePath(`${U}/x.pdf`, "99999999-2222-4333-8444-555555555555")).toThrow(); // wrong owner
  });
});
