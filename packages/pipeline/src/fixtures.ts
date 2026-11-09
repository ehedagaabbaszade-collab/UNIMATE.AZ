import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { StorageReader } from "./process";
import { Dim1536FakeProvider, insertDoc, type TestEnv } from "./test-utils";
import { processDocument, type ProcessDeps } from "./process";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Real PDF. pdf-lib's standard fonts are WinAnsi: Latin text only (no ə ğ ı ş İ). null = blank page (no text layer). */
export async function buildPdf(pages: Array<string | null>): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  for (const t of pages) {
    const p = d.addPage();
    if (t !== null) p.drawText(t, { font, size: 12, x: 20, y: 700 });
  }
  return d.save();
}

const gen = (zip: JSZip) => zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

export async function buildDocx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
      .map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`,
  );
  return gen(zip);
}

export async function buildPptx(slides: string[][]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  slides.forEach((paras, i) =>
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${paras
        .map((t) => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`)
        .join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    ),
  );
  return gen(zip);
}

export class MemoryStorage implements StorageReader {
  readonly files = new Map<string, Uint8Array>();
  readonly sizeOverride = new Map<string, number>();
  reads = 0;
  async size(path: string) {
    return this.sizeOverride.get(path) ?? this.files.get(path)?.length ?? 0;
  }
  async readHead(path: string, n: number) {
    return (this.files.get(path) ?? new Uint8Array()).slice(0, n);
  }
  async read(path: string) {
    this.reads++;
    const f = this.files.get(path);
    if (!f) throw new Error("object not found");
    return f;
  }
}

export const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
} as const;

export async function putDoc(
  env: TestEnv,
  storage: MemoryStorage,
  userId: string,
  filename: string,
  mime: string,
  bytes: Uint8Array,
): Promise<string> {
  const id = await insertDoc(env.db, userId, { filename, mime });
  const { rows } = await env.db.query<{ storage_path: string }>("select storage_path from public.documents where id = $1", [id]);
  storage.files.set(rows[0]!.storage_path, bytes);
  return id;
}

export const baseDeps = (env: TestEnv, storage: MemoryStorage, extra: Partial<ProcessDeps> = {}): ProcessDeps => ({
  repo: env.repo,
  storage,
  provider: new Dim1536FakeProvider(),
  models: { small: "m-small", standard: "m-standard", premium: "m-premium", embed: "m-embed" },
  ...extra,
});

/** Upload + process a DOCX made of `paragraphs`; returns the ready document id. */
export async function readyDocFromText(env: TestEnv, userId: string, paragraphs: string[]): Promise<string> {
  const storage = new MemoryStorage();
  const id = await putDoc(env, storage, userId, "notes.docx", MIME.docx, await buildDocx(paragraphs));
  await processDocument(baseDeps(env, storage), id);
  return id;
}
