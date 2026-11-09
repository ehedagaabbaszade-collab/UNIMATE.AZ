import type { Locale } from "@unimate/core";
import { Buffer } from "node:buffer";
import type { Worker } from "tesseract.js";

/** OCR over image bytes (PNG/JPEG). Implementations must not log or persist the image. */
export interface OcrEngine {
  recognize(image: Uint8Array, opts: { languages: Locale[] }): Promise<string>;
}

/** Renders one PDF page to a PNG so it can be OCR-ed. Optional: without it, scanned PDF pages stay empty. */
export type PdfPageRasterizer = (pdf: Uint8Array, pageNumber: number) => Promise<Uint8Array>;

export const OCR_LANGUAGES: Locale[] = ["az", "tr", "ru", "en"];

/**
 * ISO 639-1 -> Tesseract traineddata codes. tesseract.js 7.0.0 lists `aze` (and `aze_cyrl`) in its language
 * constants (src/constants/languages.js), so 'aze' is a supported code; whether the trained data is available
 * is resolved at runtime when the worker downloads it (CDN by default, or `langPath`). Not verified here.
 */
export const TESSERACT_LANG: Record<string, string> = { az: "aze", tr: "tur", ru: "rus", en: "eng" };

/**
 * Traineddata host. tesseract.js downloads language data from a CDN by default (an external, unpinned dependency at
 * runtime). TESSERACT_LANG_PATH pins it to a host you control; it must be https. Unset = library default.
 */
export function tesseractLangPathFromEnv(env: Record<string, string | undefined>): string | undefined {
  const v = env.TESSERACT_LANG_PATH?.trim();
  if (!v) return undefined;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error("TESSERACT_LANG_PATH must be an https URL");
  }
  if (u.protocol !== "https:") throw new Error("TESSERACT_LANG_PATH must be an https URL");
  return v.replace(/\/$/, "");
}

export function tesseractLangString(languages: Locale[]): string {
  const codes = languages.map((l) => TESSERACT_LANG[l.toLowerCase()]).filter((c): c is string => !!c);
  if (codes.length === 0) throw new RangeError("No supported OCR language requested");
  return [...new Set(codes)].join("+");
}

/**
 * tesseract.js adapter. NOT exercised against real OCR in the test suite: it downloads ~MBs of traineddata per
 * language and runs a WASM worker, which is too heavy/flaky for unit tests. Only the language mapping is tested.
 */
export class TesseractOcrEngine implements OcrEngine {
  private worker: Worker | undefined;
  private lang: string | undefined;
  constructor(private readonly opts: { langPath?: string } = {}) {}

  async recognize(image: Uint8Array, { languages }: { languages: Locale[] }): Promise<string> {
    const lang = tesseractLangString(languages);
    if (!this.worker || this.lang !== lang) {
      await this.worker?.terminate();
      const { createWorker } = await import("tesseract.js");
      this.worker = await createWorker(lang, 1, this.opts.langPath ? { langPath: this.opts.langPath } : {});
      this.lang = lang;
    }
    const worker = this.worker;
    const { data } = await worker.recognize(Buffer.from(image));
    return data.text;
  }

  async close(): Promise<void> {
    await this.worker?.terminate();
    this.worker = undefined;
  }
}
