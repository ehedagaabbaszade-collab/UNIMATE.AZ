export interface Page {
  page: number;
  text: string;
}
export interface Chunk {
  id: string;
  page: number;
  pageEnd: number;
  text: string;
}
export interface ChunkOptions {
  maxChars: number;
  overlap: number;
  docId?: string;
}

export function cleanText(input: string): string {
  return input
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex -- intentional: reject/strip control characters
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‍⁠﻿­]/g, "")
    // de-hyphenate "exam-\nple" -> "example" (only when continuation is lowercase)
    .replace(/(\p{L})-[ \t]*\n[ \t]*(\p{Ll})/gu, "$1$2")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Deterministic 53-bit string hash (cyrb53), hex. Not cryptographic. */
export function stableHash(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0");
}

export function chunkId(docId: string, page: number, index: number): string {
  return "c_" + stableHash(`${docId}\u0000${page}\u0000${index}`);
}

/**
 * Splits page text into chunks of <= maxChars. Chunks are built per page, so every chunk keeps
 * its exact page (pageEnd === page). `index` is global across the document, so ids are unique
 * and deterministic for the same (docId, pages, options).
 */
export function chunkPages(pages: Page[], opts: ChunkOptions): Chunk[] {
  const { maxChars, overlap, docId = "" } = opts;
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new RangeError("maxChars must be a positive integer");
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= maxChars)
    throw new RangeError("overlap must be an integer in [0, maxChars)");

  const chunks: Chunk[] = [];
  let index = 0;
  for (const p of pages) {
    const text = cleanText(p.text);
    if (!text) continue;
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + maxChars, text.length);
      if (end < text.length) {
        const win = text.slice(start, end);
        const brk = Math.max(win.lastIndexOf("\n"), win.lastIndexOf(" "));
        if (brk > maxChars / 2) end = start + brk;
      }
      const piece = text.slice(start, end).trim();
      if (piece) {
        chunks.push({ id: chunkId(docId, p.page, index), page: p.page, pageEnd: p.page, text: piece });
        index++;
      }
      if (end >= text.length) break;
      const next = end - overlap;
      start = next > start ? next : end; // guarantee progress
    }
  }
  return chunks;
}
