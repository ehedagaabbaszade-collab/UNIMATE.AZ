export type FileKind = "pdf" | "docx" | "pptx" | "png" | "jpg";

export const MAX_BYTES: Record<FileKind, number> = {
  pdf: 50 * 1024 * 1024,
  docx: 25 * 1024 * 1024,
  pptx: 50 * 1024 * 1024,
  png: 10 * 1024 * 1024,
  jpg: 10 * 1024 * 1024,
};

const MIME: Record<FileKind, string[]> = {
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
};
const EXT: Record<string, FileKind> = { pdf: "pdf", docx: "docx", pptx: "pptx", png: "png", jpg: "jpg", jpeg: "jpg" };
const DANGEROUS_EXT = new Set([
  "exe", "bat", "cmd", "com", "scr", "js", "mjs", "vbs", "ps1", "sh", "php", "html", "htm", "svg",
  "jar", "dll", "msi", "lnk", "py", "docm", "pptm",
  "php5", "phtml", "phar", "asp", "aspx", "jsp", "shtml", "hta", "wsf", "xlsm", "dotm", "ppsm",
]);

// Control chars, DEL, path separators, ':' (ADS / drive), <>"|?*, and bidi controls (RLO spoofing).
// eslint-disable-next-line no-control-regex
const BAD_NAME_CHARS = /[\u0000-\u001F\u007F/\\:<>"|?*‪-‮⁦-⁩]/;

export type UploadError =
  | "empty_file"
  | "invalid_size"
  | "too_large"
  | "bad_name"
  | "double_extension"
  | "unsupported_extension"
  | "mime_mismatch"
  | "magic_mismatch"
  | "unknown_content";

export type UploadResult =
  | { ok: true; kind: FileKind; extension: string; mimeType: string }
  | { ok: false; error: UploadError; message: string };

export interface UploadInput {
  name: string;
  size: number;
  mimeType: string;
  headBytes: Uint8Array;
}

const startsWith = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);

/** Sniff by magic bytes. docx/pptx are ZIP containers and are indistinguishable by head bytes: returns "zip". */
export function sniff(head: Uint8Array): FileKind | "zip" | null {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  return null;
}

const fail = (error: UploadError, message: string): UploadResult => ({ ok: false, error, message });

export function validateUpload(input: UploadInput): UploadResult {
  const { name, size, mimeType, headBytes } = input;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return fail("invalid_size", "Invalid file size");
  if (size === 0) return fail("empty_file", "File is empty");
  if (typeof name !== "string" || !name || name.length > 255 || BAD_NAME_CHARS.test(name))
    return fail("bad_name", "Invalid file name");

  const parts = name.trim().toLowerCase().split(".");
  if (!parts[0]) return fail("bad_name", "Invalid file name");
  const ext = parts.length >= 2 ? parts[parts.length - 1]! : "";
  if (!ext) return fail("unsupported_extension", "File has no extension");
  const inner = parts.slice(1, -1).filter(Boolean);
  if (inner.some((p) => Object.hasOwn(EXT, p) || DANGEROUS_EXT.has(p))) return fail("double_extension", "Double extensions are not allowed");
  if (DANGEROUS_EXT.has(ext)) return fail("unsupported_extension", "File type not allowed");
  const kind = Object.hasOwn(EXT, ext) ? EXT[ext] : undefined;
  if (!kind) return fail("unsupported_extension", `Unsupported file type .${ext}`);

  if (size > MAX_BYTES[kind]) return fail("too_large", `File exceeds ${MAX_BYTES[kind]} byte limit for ${kind}`);

  const mime = (String(mimeType).split(";")[0] ?? "").trim().toLowerCase();
  if (!MIME[kind].includes(mime)) return fail("mime_mismatch", "Declared MIME type does not match extension");

  const sniffed = sniff(headBytes);
  if (!sniffed) return fail("unknown_content", "File content not recognised");
  const okMagic = kind === "docx" || kind === "pptx" ? sniffed === "zip" : sniffed === kind;
  if (!okMagic) return fail("magic_mismatch", "File content does not match its declared type");

  return { ok: true, kind, extension: ext, mimeType: mime };
}

/**
 * Limits for future archive (docx/pptx ZIP) extraction. Enforce with checkZipEntries on the central
 * directory BEFORE inflating anything.
 */
export const ARCHIVE_LIMITS = {
  /** Max total uncompressed bytes across all entries. */
  maxUncompressedBytes: 200 * 1024 * 1024,
  /** Max number of entries in the archive. */
  maxEntries: 2000,
  /** Max uncompressed/compressed ratio, per entry and overall (zip-bomb guard). */
  maxCompressionRatio: 100,
} as const;

export interface ZipEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}
export type ArchiveError =
  | "invalid_entries"
  | "too_many_entries"
  | "bad_entry_path"
  | "macro_content"
  | "entry_too_large"
  | "ratio_exceeded";
export type ArchiveResult = { ok: true } | { ok: false; error: ArchiveError; message: string; entry?: string };

/** Pure check of ZIP central-directory metadata against ARCHIVE_LIMITS. Does not read any content. */
export function checkZipEntries(entries: readonly ZipEntryInfo[]): ArchiveResult {
  const bad = (error: ArchiveError, message: string, entry?: string): ArchiveResult =>
    entry === undefined ? { ok: false, error, message } : { ok: false, error, message, entry };
  if (!Array.isArray(entries)) return bad("invalid_entries", "Entries must be an array");
  if (entries.length > ARCHIVE_LIMITS.maxEntries) return bad("too_many_entries", "Archive has too many entries");
  let total = 0;
  let totalCompressed = 0;
  for (const e of entries) {
    if (!e || typeof e.name !== "string") return bad("invalid_entries", "Invalid entry");
    const { name, compressedSize: c, uncompressedSize: u } = e;
    if (!Number.isSafeInteger(c) || c < 0 || !Number.isSafeInteger(u) || u < 0)
      return bad("invalid_entries", "Invalid entry size", name);
    // eslint-disable-next-line no-control-regex
    if (!name || /[\x00-\x1F\x7F]/.test(name)) return bad("bad_entry_path", "Invalid entry path", name);
    const segs = name.split(/[\\/]/);
    if (name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name) || segs.includes(".."))
      return bad("bad_entry_path", "Entry path escapes the extraction root", name);
    if ((segs[segs.length - 1] ?? "").toLowerCase().startsWith("vbaproject"))
      return bad("macro_content", "Macro (VBA) content is not allowed", name);
    if (u > ARCHIVE_LIMITS.maxUncompressedBytes) return bad("entry_too_large", "Entry is too large", name);
    if (u > 0 && u > c * ARCHIVE_LIMITS.maxCompressionRatio) return bad("ratio_exceeded", "Entry compression ratio too high", name);
    total += u;
    totalCompressed += c;
    if (total > ARCHIVE_LIMITS.maxUncompressedBytes) return bad("entry_too_large", "Archive is too large when uncompressed");
  }
  if (total > 0 && total > totalCompressed * ARCHIVE_LIMITS.maxCompressionRatio)
    return bad("ratio_exceeded", "Archive compression ratio too high");
  return { ok: true };
}
