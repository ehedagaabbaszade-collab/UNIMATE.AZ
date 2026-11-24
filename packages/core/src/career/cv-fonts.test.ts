/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CV_FONT_FACES } from "./cv-fonts.manifest";
import { CV_FONTS } from "./cv-design";

// Real coverage check: reads the cmap of every shipped woff2 (apps/web/public/cv-fonts, the same bytes the mobile data URIs
// are built from) instead of trusting subset names. A letter counts only if a face whose unicode-range selects it has a glyph.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const AZ = "əƏğĞşŞçÇöÖüÜıİ";
const CYR = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя";
const PUNCT = "•–—“”«»№";

const u128 = (b: Buffer, o: { p: number }): number => {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const x = b[o.p++]!;
    v = v * 128 + (x & 0x7f);
    if (!(x & 0x80)) return v;
  }
  throw new Error("bad UIntBase128");
};
/** Raw cmap table bytes from a WOFF2 file (cmap is never transformed; tables are concatenated unpadded after Brotli). */
function woff2Cmap(buf: Buffer): Buffer {
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error("not woff2");
  const numTables = buf.readUInt16BE(12);
  const compressed = buf.readUInt32BE(20);
  const o = { p: 48 };
  const dir: Array<{ tag: number; len: number }> = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[o.p++]!;
    const tag = flags & 0x3f;
    if (tag === 63) o.p += 4;
    const version = flags >> 6;
    const orig = u128(buf, o);
    const transformed = tag === 10 || tag === 11 ? version === 0 : version !== 0; // glyf/loca: version 0 = transformed
    dir.push({ tag, len: transformed ? u128(buf, o) : orig });
  }
  const data = brotliDecompressSync(buf.subarray(o.p, o.p + compressed));
  let off = 0;
  for (const t of dir) {
    if (t.tag === 0) return data.subarray(off, off + t.len);
    off += t.len;
  }
  throw new Error("no cmap");
}
function hasGlyph(cmap: Buffer, c: number): boolean {
  const n = cmap.readUInt16BE(2);
  for (let i = 0; i < n; i++) {
    const sub = cmap.subarray(cmap.readUInt32BE(4 + i * 8 + 4));
    const format = sub.readUInt16BE(0);
    if (format === 12) {
      for (let g = 0, groups = sub.readUInt32BE(12); g < groups; g++) {
        const s = sub.readUInt32BE(16 + g * 12);
        const e = sub.readUInt32BE(20 + g * 12);
        if (c >= s && c <= e && sub.readUInt32BE(24 + g * 12) + (c - s) !== 0) return true;
      }
    } else if (format === 4 && c <= 0xffff) {
      const seg = sub.readUInt16BE(6) / 2;
      for (let k = 0; k < seg; k++) {
        const end = sub.readUInt16BE(14 + k * 2);
        const start = sub.readUInt16BE(16 + seg * 2 + k * 2);
        if (c < start || c > end) continue;
        const delta = sub.readInt16BE(16 + seg * 4 + k * 2);
        const roAt = 16 + seg * 6 + k * 2;
        const ro = sub.readUInt16BE(roAt);
        const gid = ro === 0 ? (c + delta) & 0xffff : sub.readUInt16BE(roAt + ro + 2 * (c - start));
        if (gid !== 0) return true;
      }
    }
  }
  return false;
}
const inRange = (range: string, c: number) =>
  range.split(",").some((r) => {
    const [a, b] = r.trim().replace(/^U\+/i, "").split("-").map((h) => parseInt(h, 16));
    return c >= a! && c <= (b ?? a!);
  });

describe("CV fonts", () => {
  const cmaps = new Map(CV_FONT_FACES.map((f) => [f.file, woff2Cmap(readFileSync(path.join(root, "apps/web/public/cv-fonts", f.file)))]));
  for (const family of CV_FONTS) {
    for (const weight of [400, 700]) {
      it(`${family} ${weight} has real glyphs for Azerbaijani, Turkish, Russian`, () => {
        const faces = CV_FONT_FACES.filter((f) => f.family === family && f.weight === weight);
        expect(faces.length).toBe(3);
        const missing = [...(AZ + CYR + PUNCT + "AZaz09")].filter((ch) => {
          const c = ch.codePointAt(0)!;
          return !faces.some((f) => inRange(f.unicodeRange, c) && hasGlyph(cmaps.get(f.file)!, c));
        });
        expect(missing).toEqual([]);
      });
    }
  }
  it("negative control: the cmap reader reports a glyph Inter latin does not have", () => {
    expect(hasGlyph(cmaps.get("inter-latin-400-normal.woff2")!, 0x0259)).toBe(false); // ə lives in latin-ext
    expect(hasGlyph(cmaps.get("inter-latin-ext-400-normal.woff2")!, 0x0259)).toBe(true);
  });
  it("mobile data URIs cover every face", () => {
    const gen = readFileSync(path.join(root, "apps/mobile/src/features/career/cv-fonts.generated.ts"), "utf8");
    for (const f of CV_FONT_FACES) expect(gen).toContain(`"${f.file}": "data:font/woff2;base64,`);
    expect(gen.length).toBeLessThan(1_500_000);
  });
});
