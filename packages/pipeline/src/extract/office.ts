import { PipelineError } from "../errors";
import { SafeZip, type ZipDecodeLimits } from "./zip";

export interface ExtractedPage {
  page: number;
  text: string;
  /** Embedded raster images found on the page/slide (for OCR of image-only slides). Not populated yet. */
  hasText: boolean;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") {
      const cp = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? "";
  });

/** Text of <tag>...</tag> runs, joined per paragraph (</w:p> / </a:p>) with newlines. No XML parser: only text runs are read. */
function paragraphsText(xml: string, run: string, para: string): string {
  const paras = xml.split(new RegExp(`</${para}>`));
  const out: string[] = [];
  const runRe = new RegExp(`<${run}(?:\\s[^<>]*)?>([^<]*)</${run}>`, "g");
  for (const p of paras) {
    // tabs and line breaks inside a paragraph
    const normalised = p.replace(/<(?:w:tab|a:tab)\s*\/>/g, `<${run}>\t</${run}>`).replace(/<(?:w:br|a:br)\s*\/>/g, `<${run}>\n</${run}>`);
    let line = "";
    for (const m of normalised.matchAll(runRe)) line += decodeEntities(m[1] ?? "");
    out.push(line);
  }
  return out.join("\n");
}

export interface OfficeExtractOptions {
  limits?: ZipDecodeLimits;
  /** Called with the page/slide count BEFORE any slide is inflated; throw to reject (plan page cap). */
  checkPages?: (pages: number) => void;
}

/**
 * DOCX has no reliable page boundaries without layout, so the document is one logical page (page 1).
 * Page-accurate citations are therefore not possible for DOCX.
 */
export async function extractDocx(bytes: Uint8Array, opts: OfficeExtractOptions = {}): Promise<ExtractedPage[]> {
  const zip = SafeZip.open(bytes, opts.limits); // BEFORE inflating anything
  const text = paragraphsText(zip.text("word/document.xml"), "w:t", "w:p");
  return [{ page: 1, text, hasText: text.trim().length > 0 }];
}

/** One page per slide, in numeric slide order. */
export async function extractPptx(bytes: Uint8Array, opts: OfficeExtractOptions = {}): Promise<ExtractedPage[]> {
  const zip = SafeZip.open(bytes, opts.limits);
  const slides = zip.entries
    .map((e) => ({ name: e.name, m: /^ppt\/slides\/slide(\d+)\.xml$/.exec(e.name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null)
    .map((x) => ({ name: x.name, idx: Number(x.m[1]) }))
    .sort((a, b) => a.idx - b.idx);
  if (slides.length === 0) throw new PipelineError("corrupt_document", "No slides found", false);
  opts.checkPages?.(slides.length);
  const pages: ExtractedPage[] = [];
  let page = 1;
  for (const s of slides) {
    const text = paragraphsText(zip.text(s.name), "a:t", "a:p");
    pages.push({ page: page++, text, hasText: text.trim().length > 0 });
  }
  return pages;
}
