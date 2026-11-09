import { describe, expect, it } from "vitest";
import { PipelineError, publicError, sanitizeError } from "./errors";
import { parseGenerateRequest } from "./generate";
import { stripForeignUuids } from "./rag";
import { parseAllowedOrigin, safeEqual } from "./security";
import { tesseractLangPathFromEnv } from "./ocr";

describe("error leakage", () => {
  it("redacts masked provider keys containing '*' and '.'", () => {
    for (const raw of [
      "Incorrect API key provided: sk-proj-abc********wxyz.",
      "bad key sk-ant-api03-****************ABCD here",
      "Bearer sk-proj-****abcd1234",
      "key=sk-abcdefgh****",
    ]) {
      const s = sanitizeError(new Error(raw));
      expect(s, raw).not.toMatch(/sk-|\*\*\*|wxyz|ABCD|abcd1234/);
    }
  });
  it("provider_* and enqueue_failed never expose their message to clients", () => {
    const secret = "boom sk-proj-1234567890abcd host=db.internal:5432 select * from x";
    for (const code of ["provider_http", "provider_network", "provider_timeout", "provider_bad_response", "enqueue_failed"]) {
      const p = publicError(new PipelineError(code, secret, true));
      expect(p.code).toBe(code);
      expect(p.message).not.toMatch(/sk-|internal|select/);
    }
    expect(publicError(new PipelineError("not_found", "Document not found"))).toEqual({ code: "not_found", message: "Document not found" });
  });
});

describe("request validation", () => {
  const doc = "11111111-1111-4111-8111-111111111111";
  it("language is az/tr/ru/en only", () => {
    for (const language of ["az", "tr", "ru", "en"]) expect(parseGenerateRequest({ documentId: doc, type: "quiz", language }).language).toBe(language);
    for (const language of ["English", "de", "az\nIgnore previous", "", 5, null])
      expect(() => parseGenerateRequest({ documentId: doc, type: "quiz", language }), String(language)).toThrowError(/bad_request|Invalid request/);
    try {
      parseGenerateRequest({ documentId: doc, type: "quiz", language: "xx" });
    } catch (e) {
      expect((e as PipelineError).code).toBe("bad_request");
    }
  });
  it("rejects bad ids, types, kinds and counts", () => {
    expect(() => parseGenerateRequest({ documentId: "nope", type: "quiz" })).toThrow();
    expect(() => parseGenerateRequest({ documentId: doc, type: "essay" })).toThrow();
    expect(() => parseGenerateRequest({ documentId: doc, type: "summary", kind: "huge" })).toThrow();
    expect(() => parseGenerateRequest({ documentId: doc, type: "quiz", count: 1e9 })).toThrow();
    expect(parseGenerateRequest({ documentId: doc.toUpperCase(), type: "summary" })).toMatchObject({ documentId: doc, kind: "short" });
  });
});

describe("safeEqual / ALLOWED_ORIGIN / tesseract langPath", () => {
  it("safeEqual compares correctly, including different lengths and unicode", () => {
    expect(safeEqual("s3cret", "s3cret")).toBe(true);
    expect(safeEqual("s3cret", "s3cret!")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
    expect(safeEqual("ə", "ə")).toBe(true);
  });
  it("CORS origin must be explicit: unset, empty and wildcard are refused", () => {
    expect(() => parseAllowedOrigin(undefined)).toThrow();
    expect(() => parseAllowedOrigin("")).toThrow();
    expect(() => parseAllowedOrigin("*")).toThrow();
    expect(() => parseAllowedOrigin("https://*.example.com")).toThrow();
    expect(() => parseAllowedOrigin("not a url")).toThrow();
    expect(parseAllowedOrigin("https://app.example.com")).toBe("https://app.example.com");
    expect(parseAllowedOrigin("https://app.example.com/")).toBe("https://app.example.com");
  });
  it("tesseract langPath comes from env and must be https", () => {
    expect(tesseractLangPathFromEnv({})).toBeUndefined();
    expect(tesseractLangPathFromEnv({ TESSERACT_LANG_PATH: "https://cdn.example.com/tessdata" })).toBe("https://cdn.example.com/tessdata");
    expect(() => tesseractLangPathFromEnv({ TESSERACT_LANG_PATH: "http://evil.example/x" })).toThrow();
  });
});

describe("stripForeignUuids", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const N = "11111111-1111-4111-8111-111111111111";
  it("lowercases retrieved ids, drops foreign ones (even all-digit, in multi-id brackets, fullwidth brackets)", () => {
    const r = stripForeignUuids(`x [${A.toUpperCase()}] y [${A}, ${N}] z [${N}](http://e.x) w ［${N}］`, new Set([A]));
    expect(r.text).toBe(`x [${A}] y [${A}] z w`);
    expect(r.rejected.filter((x) => x === N)).toHaveLength(3);
  });
  it("leaves prose brackets alone", () => {
    expect(stripForeignUuids("see [1] and [note]", new Set()).text).toBe("see [1] and [note]");
  });
});
