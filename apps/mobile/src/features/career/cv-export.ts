import { CV_PRINT_LABEL_KEYS, cvMissingRequired, renderCvHtml, type CvData, type CvDesign, type CvLanguage, type CvPrintLabels } from "@unimate/core";
import { t as translate, type MessageKey } from "@unimate/i18n";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Asset } from "expo-asset";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { CV_FONT_DATA } from "./cv-fonts.generated";
import { pdfFileName } from "./cv-helpers";
import { SAMPLE_CV } from "./cv-sample";

export interface ExportableCv {
  title: string;
  language: CvLanguage;
  template: string;
  design: CvDesign;
  data: CvData;
}
const SIGNED_URL_TTL_S = 600;

const photoCache = new Map<string, string>();
let logoCache: string | undefined;
/** The bundled official full logo as a data URI (the print HTML accepts only https or data:image). */
async function logoDataUri(): Promise<string | undefined> {
  if (logoCache) return logoCache;
  try {
    const a = await Asset.fromModule(require("../../../assets/full-logo.png") as number).downloadAsync();
    if (!a.localUri) return undefined;
    return (logoCache = `data:image/png;base64,${await new File(a.localUri).base64()}`);
  } catch {
    return undefined;
  }
}
/** Photo as a data URI for the PDF renderer; falls back to the https URL when the download fails. */
async function photoSrc(url: string): Promise<string> {
  const tmp = new File(Paths.cache, `cvphoto-${Crypto.randomUUID()}.jpg`);
  try {
    const f = await File.downloadFileAsync(url, tmp);
    return `data:image/jpeg;base64,${await f.base64()}`;
  } catch {
    return url;
  } finally {
    try {
      if (tmp.exists) tmp.delete();
    } catch {
      /* temp file; harmless */
    }
  }
}

/** Full print HTML: shared renderer + design + embedded fonts + language. mode overrides the stored design's mode (Designed / ATS export). */
export async function buildCvHtml(sb: SupabaseClient, cv: ExportableCv, mode?: "designed" | "ats"): Promise<string> {
  const labels = Object.fromEntries(CV_PRINT_LABEL_KEYS.map((k) => [k, translate(cv.language, `career.cv.sectionPrint.${k}` as MessageKey)])) as CvPrintLabels;
  const signed = cv.data.personal.photoPath ? (await sb.storage.from("cv-photos").createSignedUrl(cv.data.personal.photoPath, SIGNED_URL_TTL_S)).data?.signedUrl : undefined;
  const photoLink = signed ?? cv.data.personal.photoUrl;
  const path = cv.data.personal.photoPath;
  const cached = path ? photoCache.get(path) : undefined; // live preview re-renders often: download each photo once
  const [logo, photo] = await Promise.all([logoDataUri(), cached ?? (photoLink ? photoSrc(photoLink) : Promise.resolve(undefined))]);
  if (path && photo && !cached) photoCache.set(path, photo);
  return renderCvHtml(cv.data, {
    template: cv.template,
    language: cv.language,
    title: cv.title,
    design: mode ? { ...cv.design, mode } : cv.design,
    fonts: (f) => CV_FONT_DATA[f],
    labels,
    assets: { logoSrc: logo, photoSrc: photo },
  });
}

export type ExportResult = { kind: "shared" } | { kind: "unavailable" } | { kind: "missing"; fields: string[] };
/** Renders a PDF (named after the CV title) and opens the share sheet. */
export async function exportCvPdf(sb: SupabaseClient, cv: ExportableCv, mode?: "designed" | "ats"): Promise<ExportResult> {
  const missing = cvMissingRequired(cv.data);
  if (missing.length) return { kind: "missing", fields: missing };
  const file = await Print.printToFileAsync({ html: await buildCvHtml(sb, cv, mode) });
  if (!(await Sharing.isAvailableAsync())) return { kind: "unavailable" };
  let uri = file.uri;
  try {
    const named = new File(Paths.cache, pdfFileName(cv.title));
    if (named.exists) named.delete();
    new File(file.uri).copy(named);
    uri = named.uri;
  } catch {
    /* keep the generated name */
  }
  await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
  return { kind: "shared" };
}
/** Preview: the system print preview of the live render (Expo Go has no WebView). */
export async function previewCv(sb: SupabaseClient, cv: ExportableCv): Promise<void> {
  await Print.printAsync({ html: await buildCvHtml(sb, cv) });
}

const labelsFor = (language: CvLanguage): CvPrintLabels => Object.fromEntries(CV_PRINT_LABEL_KEYS.map((k) => [k, translate(language, `career.cv.sectionPrint.${k}` as MessageKey)])) as CvPrintLabels;
/** Gallery preview: the real renderer on sample data (never saved). */
export const buildSampleHtml = (template: string, language: CvLanguage): string =>
  renderCvHtml(SAMPLE_CV, { template, language, title: "CV", fonts: (f) => CV_FONT_DATA[f], labels: labelsFor(language) });
