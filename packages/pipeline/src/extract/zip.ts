import { ARCHIVE_LIMITS, checkZipEntries, type ZipEntryInfo } from "@unimate/core";
import { Inflate } from "fflate";
import { PipelineError } from "../errors";

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const ZIP64_MARK = 0xffffffff;

export interface ZipEntry extends ZipEntryInfo {
  /** 0 = stored, 8 = deflate. */
  method: number;
  localOffset: number;
  /** Start of the entry's data (after the local header); validated at parse time. */
  dataStart: number;
  /** CRC-32 declared by the central directory; verified after decoding. */
  crc: number;
}
interface ParsedZip {
  entries: ZipEntry[];
  cdOffset: number;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
/** CRC-32 (IEEE). fflate 0.8 does not export a standalone crc32, so it is computed here. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

const corrupt = (why: string) => new PipelineError("corrupt_archive", `Invalid or truncated ZIP archive (${why})`, false);

function parseZip(bytes: Uint8Array): ParsedZip {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw corrupt("too short");

  // EOCD is within the last 22 + 65535 bytes. It must END the file (comment length consistent), so a fake EOCD
  // hidden in the comment or in appended data cannot be chosen by one parser and not by another.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === EOCD_SIG && i + 22 + dv.getUint16(i + 20, true) === bytes.length) {
      if (eocd >= 0) throw corrupt("ambiguous end-of-central-directory record"); // two parsers could pick different ones
      eocd = i;
    }
  }
  if (eocd < 0) throw corrupt("no end-of-central-directory record");
  const diskNo = dv.getUint16(eocd + 4, true);
  const cdDisk = dv.getUint16(eocd + 6, true);
  const onDisk = dv.getUint16(eocd + 8, true);
  const total = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (total === 0xffff || cdSize === ZIP64_MARK || cdOffset === ZIP64_MARK) throw corrupt("ZIP64 not supported");
  if (diskNo !== 0 || cdDisk !== 0 || onDisk !== total) throw corrupt("multi-disk archives are not supported");
  // The central directory must end exactly where the EOCD starts: no gap or extra records another parser might read.
  if (cdOffset + cdSize !== eocd) throw corrupt("central directory does not end at the end record");

  // Cheap guard before allocating: entry count is capped by checkZipEntries, but we parse first.
  if (total > ARCHIVE_LIMITS.maxEntries) throw new PipelineError("archive_rejected", "Archive has too many entries", false);

  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let p = cdOffset;
  const dec = new TextDecoder("utf-8", { fatal: true });
  for (let n = 0; n < total; n++) {
    if (p + 46 > eocd || dv.getUint32(p, true) !== CEN_SIG) throw corrupt("bad central directory entry");
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const uncompressedSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    if (p + 46 + nameLen + extraLen + commentLen > eocd) throw corrupt("entry out of range");
    if (compressedSize === ZIP64_MARK || uncompressedSize === ZIP64_MARK || localOffset === ZIP64_MARK) throw corrupt("ZIP64 not supported");
    const rawName = bytes.subarray(p + 46, p + 46 + nameLen);
    let name: string;
    try {
      name = dec.decode(rawName);
    } catch {
      throw corrupt("entry name is not valid UTF-8");
    }
    const key = name.toLowerCase(); // case-insensitive: extractors on case-folding file systems would collide
    if (seen.has(key)) throw new PipelineError("archive_rejected", "Archive has duplicate entry names", false);
    seen.add(key);
    if (flags & 0x1) throw new PipelineError("archive_rejected", "Encrypted archives are not supported", false);

    // The local header must agree with the central directory (name bytes, method, encryption flag).
    const o = localOffset;
    if (o + 30 > cdOffset || dv.getUint32(o, true) !== LOC_SIG) throw corrupt("bad local header");
    if (dv.getUint16(o + 6, true) & 0x1) throw new PipelineError("archive_rejected", "Encrypted archives are not supported", false);
    if (dv.getUint16(o + 8, true) !== method) throw corrupt("local header compression method does not match central directory");
    const lNameLen = dv.getUint16(o + 26, true);
    const lExtraLen = dv.getUint16(o + 28, true);
    if (!sameBytes(bytes.subarray(o + 30, o + 30 + lNameLen), rawName)) throw corrupt("local header does not match central directory");
    const dataStart = o + 30 + lNameLen + lExtraLen;
    if (dataStart + compressedSize > cdOffset) throw corrupt("entry data out of range");
    entries.push({ name, compressedSize, uncompressedSize, method, localOffset, dataStart, crc });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p !== cdOffset + cdSize) throw corrupt("central directory has trailing data");

  // Entries must not overlap (a shared byte range lets two names alias the same data).
  const byOffset = [...entries].sort((x, y) => x.localOffset - y.localOffset);
  for (let i = 1; i < byOffset.length; i++) {
    const prev = byOffset[i - 1]!;
    if (prev.dataStart + prev.compressedSize > byOffset[i]!.localOffset) throw corrupt("overlapping entries");
  }
  return { entries, cdOffset };
}

/**
 * Reads the ZIP central directory (names and sizes) WITHOUT inflating anything, so the entry list can be
 * checked with checkZipEntries first.
 * Throws a non-retryable PipelineError("corrupt_archive") for truncated/invalid/ambiguous archives. ZIP64 is rejected.
 */
export function readCentralDirectory(bytes: Uint8Array): ZipEntryInfo[] {
  return parseZip(bytes).entries.map(({ name, compressedSize, uncompressedSize }) => ({ name, compressedSize, uncompressedSize }));
}

/** Decode limits. Edge isolates have little memory, so these are well below ARCHIVE_LIMITS. */
export interface ZipDecodeLimits {
  maxPartBytes: number;
  maxTotalBytes: number;
}
export const EDGE_ZIP_LIMITS: ZipDecodeLimits = {
  maxPartBytes: 20 * 1024 * 1024,
  maxTotalBytes: Math.min(ARCHIVE_LIMITS.maxUncompressedBytes, 48 * 1024 * 1024),
};

const SLICE = 4096; // deflate can expand ~1000x: feed small slices so the byte counter runs before memory does

/**
 * A checked ZIP. Entries are located ONLY through our own central-directory parse (no second parser decides which
 * record "word/document.xml" is). Content is inflated with a streaming inflater and a hard byte counter; declared
 * sizes are never trusted (a mismatch with the real size is itself an error).
 */
export class SafeZip {
  readonly entries: readonly ZipEntry[];
  private readonly cdOffset: number;
  private decoded = 0;
  private constructor(
    private readonly bytes: Uint8Array,
    parsed: ParsedZip,
    private readonly limits: ZipDecodeLimits,
  ) {
    this.entries = parsed.entries;
    this.cdOffset = parsed.cdOffset;
  }

  /** Parses and runs checkZipEntries BEFORE anything is inflated. */
  static open(bytes: Uint8Array, limits: ZipDecodeLimits = EDGE_ZIP_LIMITS): SafeZip {
    const parsed = parseZip(bytes);
    const r = checkZipEntries(parsed.entries);
    if (!r.ok) throw new PipelineError("archive_rejected", `${r.error}: ${r.message}`, false);
    return new SafeZip(bytes, parsed, limits);
  }

  has(name: string): boolean {
    return this.entries.some((e) => e.name === name);
  }

  text(name: string): string {
    const e = this.entries.find((x) => x.name === name);
    if (!e) throw new PipelineError("corrupt_document", `Missing ${name}`, false);
    return new TextDecoder("utf-8").decode(this.read(e));
  }

  read(e: ZipEntry): Uint8Array {
    const tooBig = () => new PipelineError("archive_rejected", "entry_too_large: Entry is too large when decoded", false);
    const start = e.dataStart; // header consistency (name, method, encryption) was verified at parse time
    const end = start + e.compressedSize;
    if (end > this.cdOffset) throw corrupt("entry data out of range");
    const data = this.bytes.subarray(start, end);

    const hardCap = Math.min(this.limits.maxPartBytes, this.limits.maxTotalBytes - this.decoded);
    // Never decode more than the entry declares: a lying (larger) real size is rejected as soon as it is seen.
    const cap = Math.min(hardCap, e.uncompressedSize);
    const over = () => (e.uncompressedSize > hardCap ? tooBig() : corrupt("declared size does not match content"));
    let out: Uint8Array;
    if (e.method === 0) {
      if (data.length > cap) throw over();
      out = data;
    } else if (e.method === 8) {
      const chunks: Uint8Array[] = [];
      let n = 0;
      try {
        const inf = new Inflate((chunk) => {
          n += chunk.length;
          if (n > cap) throw over();
          chunks.push(chunk);
        });
        if (data.length === 0) inf.push(data, true);
        for (let i = 0; i < data.length; i += SLICE) inf.push(data.subarray(i, i + SLICE), i + SLICE >= data.length);
      } catch (err) {
        if (err instanceof PipelineError) throw err;
        throw corrupt("bad deflate stream");
      }
      out = new Uint8Array(n);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
    } else throw corrupt(`unsupported compression method ${e.method}`);
    if (out.length !== e.uncompressedSize) throw corrupt("declared size does not match content");
    if (crc32(out) !== e.crc) throw corrupt("CRC-32 mismatch");
    this.decoded += out.length;
    return out;
  }
}

/** Central directory parse + core's checkZipEntries. Throws PipelineError("archive_rejected") on violations. */
export function assertSafeArchive(bytes: Uint8Array): ZipEntryInfo[] {
  SafeZip.open(bytes);
  return readCentralDirectory(bytes);
}
