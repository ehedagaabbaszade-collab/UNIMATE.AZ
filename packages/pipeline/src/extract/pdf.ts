import { extractText, getDocumentProxy } from "unpdf";
import { PipelineError } from "../errors";
import type { ExtractedPage } from "./office";

export interface PdfExtractOptions {
  /** Called with numPages BEFORE any text is extracted; throw to reject (plan page cap). */
  checkPages?: (pages: number) => void;
  /** Let pdf.js take ownership of (detach) `bytes` instead of copying them. Only when the caller no longer needs them. */
  transfer?: boolean;
}

/** Text per page via pdf.js (unpdf). Pages with no text layer have hasText=false and are OCR candidates. */
export async function extractPdf(bytes: Uint8Array, opts: PdfExtractOptions = {}): Promise<ExtractedPage[]> {
  let pdf;
  try {
    // copy by default: pdf.js transfers/detaches the buffer it is given
    pdf = await getDocumentProxy(opts.transfer ? bytes : new Uint8Array(bytes));
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    if (name === "PasswordException") throw new PipelineError("encrypted_pdf", "Password-protected PDFs are not supported", false);
    throw new PipelineError("corrupt_pdf", "PDF is corrupted or unreadable", false);
  }
  try {
    opts.checkPages?.((pdf as { numPages: number }).numPages);
    const { text } = await extractText(pdf, { mergePages: false });
    return text.map((t, i) => ({ page: i + 1, text: t, hasText: t.trim().length > 0 }));
  } catch (e) {
    if (e instanceof PipelineError) throw e;
    throw new PipelineError("corrupt_pdf", "PDF text extraction failed", false);
  } finally {
    await (pdf as { destroy?: () => Promise<void> }).destroy?.().catch(() => {});
  }
}
