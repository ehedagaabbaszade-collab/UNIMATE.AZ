import { z } from "zod";

/** Kinds of university written work the writing assistant drafts. */
export const WRITING_KINDS = ["independent_work", "report", "essay", "presentation"] as const;
export type WritingKind = (typeof WRITING_KINDS)[number];
const WritingLanguage = z.enum(["az", "tr", "en", "ru"]);

export const WritingRequestSchema = z.object({
  kind: z.enum(WRITING_KINDS),
  topic: z.string().trim().min(3).max(300),
  subject: z.string().trim().max(120).optional(),
  /** Pages for text work (2-12), slides for a presentation (5-15). */
  length: z.number().int().min(2).max(15).optional(),
  requirements: z.string().trim().max(1000).optional(),
  outputLanguage: WritingLanguage.optional(),
});
export type WritingRequest = z.infer<typeof WritingRequestSchema>;

const para = z.string().trim().min(1).max(4000);
export const DocumentDraftSchema = z.object({
  title: z.string().trim().min(1).max(300),
  introduction: z.array(para).min(1).max(5),
  sections: z.array(z.object({ heading: z.string().trim().min(1).max(200), paragraphs: z.array(para).min(1).max(8) })).min(2).max(10),
  conclusion: z.array(para).min(1).max(4),
  keyTerms: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  searchKeywords: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
});
export const SlidesDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(200).default(""),
  slides: z.array(z.object({ title: z.string().trim().min(1).max(160), bullets: z.array(z.string().trim().min(1).max(300)).min(1).max(6), notes: z.string().trim().max(1500).default("") })).min(3).max(16),
  searchKeywords: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
});
export type DocumentDraft = z.infer<typeof DocumentDraftSchema>;
export type SlidesDraft = z.infer<typeof SlidesDraftSchema>;

/** Title-page details the student fills once (kept on the device). Every field is optional. */
export interface TitlePage {
  ministry?: string;
  university?: string;
  faculty?: string;
  department?: string;
  subject?: string;
  student?: string;
  group?: string;
  teacher?: string;
  city?: string;
  year?: string;
}
export interface WritingLabels {
  kind: string;
  topic: string;
  subject: string;
  student: string;
  group: string;
  teacher: string;
  contents: string;
  introduction: string;
  conclusion: string;
  keyTerms: string;
  references: string;
  referencesNote: string;
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]!);
const row = (label: string, value?: string) => (value ? `<p class="tp-row"><span>${esc(label)}:</span> ${esc(value)}</p>` : "");

/**
 * A4 document in the common Azerbaijani university layout: Times New Roman 14pt, 1.5 line spacing, margins
 * 2/1.5/2/3 cm (top/right/bottom/left), justified text, title page, contents, chapters on new pages.
 * The references page is left for the student: drafts never contain invented sources.
 */
export function renderDocumentHtml(d: DocumentDraft, tp: TitlePage, l: WritingLabels): string {
  const chapters = [{ h: l.introduction, ps: d.introduction }, ...d.sections.map((s) => ({ h: s.heading, ps: s.paragraphs })), { h: l.conclusion, ps: d.conclusion }];
  const body = chapters.map((c) => `<section><h2>${esc(c.h)}</h2>${c.ps.map((p) => `<p>${esc(p)}</p>`).join("")}</section>`).join("");
  const terms = d.keyTerms.length ? `<p class="terms"><b>${esc(l.keyTerms)}:</b> ${d.keyTerms.map(esc).join(", ")}</p>` : "";
  const place = [tp.city, tp.year].filter(Boolean).join(" – ");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 2cm 1.5cm 2cm 3cm; }
body { font-family: "Times New Roman", Times, serif; font-size: 14pt; line-height: 1.5; color: #000; }
p { text-align: justify; text-indent: 1.25cm; margin: 0 0 6pt; }
h2 { font-size: 14pt; text-align: center; text-transform: uppercase; margin: 0 0 12pt; }
section { page-break-before: always; }
.tp { height: 25cm; display: flex; flex-direction: column; text-align: center; }
.tp p { text-indent: 0; text-align: center; margin: 0; }
.tp .head { font-weight: bold; }
.tp .kind { font-size: 22pt; font-weight: bold; margin-top: 4cm; letter-spacing: 2pt; }
.tp .topic { margin-top: 0.6cm; }
.tp .who { margin-top: auto; margin-left: 8cm; }
.tp .who p { text-align: left; }
.tp .foot { margin-top: 1.5cm; }
.toc p, .refs p, .terms { text-indent: 0; }
</style></head><body>
<div class="tp">
${tp.ministry ? `<p class="head">${esc(tp.ministry)}</p>` : ""}${tp.university ? `<p class="head">${esc(tp.university)}</p>` : ""}${tp.faculty ? `<p>${esc(tp.faculty)}</p>` : ""}${tp.department ? `<p>${esc(tp.department)}</p>` : ""}
<p class="kind">${esc(l.kind)}</p>
${tp.subject ? `<p class="topic"><b>${esc(l.subject)}:</b> ${esc(tp.subject)}</p>` : ""}
<p class="topic"><b>${esc(l.topic)}:</b> ${esc(d.title)}</p>
<div class="who">${row(l.student, tp.student)}${row(l.group, tp.group)}${row(l.teacher, tp.teacher)}</div>
${place ? `<p class="foot">${esc(place)}</p>` : ""}
</div>
<section class="toc"><h2>${esc(l.contents)}</h2>${chapters.map((c) => `<p>${esc(c.h)}</p>`).join("")}<p>${esc(l.references)}</p></section>
${body}
<section class="refs"><h2>${esc(l.references)}</h2><p><i>${esc(l.referencesNote)}</i></p>${terms}</section>
</body></html>`;
}

/** 16:9 deck, one slide per page: minimal white slides with an indigo accent; the cover uses the brand gradient. */
export function renderSlidesHtml(d: SlidesDraft, tp: TitlePage): string {
  const who = [tp.student, tp.group, tp.university].filter((s): s is string => !!s).map(esc).join(" · ");
  const slides = d.slides
    .map((s, i) => `<div class="slide"><div class="bar"></div><h2>${esc(s.title)}</h2><ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul><div class="num">${i + 2}</div></div>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 1280px 720px; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #10182B; }
.slide { width: 1280px; height: 720px; padding: 72px 96px; position: relative; page-break-after: always; overflow: hidden; background: #fff; }
.bar { width: 72px; height: 8px; border-radius: 4px; background: #4F46E5; margin-bottom: 28px; }
h1 { font-size: 64px; line-height: 1.1; margin: 0 0 24px; letter-spacing: -1px; }
h2 { font-size: 44px; line-height: 1.15; margin: 0 0 32px; letter-spacing: -0.5px; }
ul { margin: 0; padding-left: 36px; }
li { font-size: 28px; line-height: 1.45; margin-bottom: 14px; color: #232B42; }
.num { position: absolute; right: 64px; bottom: 40px; font-size: 18px; color: #8A93AB; }
.cover { background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 55%, #3B82F6 100%); color: #fff; display: flex; flex-direction: column; justify-content: center; }
.cover p { font-size: 28px; opacity: 0.9; margin: 0; }
.cover .who { position: absolute; bottom: 56px; left: 96px; font-size: 20px; opacity: 0.85; }
</style></head><body>
<div class="slide cover"><h1>${esc(d.title)}</h1>${d.subtitle ? `<p>${esc(d.subtitle)}</p>` : ""}${who ? `<div class="who">${who}</div>` : ""}</div>
${slides}
</body></html>`;
}

/** Plain text of a draft, for pasting into Word / Google Docs where the student edits it. */
export function draftToText(d: DocumentDraft | SlidesDraft, l: Pick<WritingLabels, "introduction" | "conclusion">): string {
  if ("slides" in d) {
    return [d.title, d.subtitle, "", ...d.slides.flatMap((s, i) => [`${i + 1}. ${s.title}`, ...s.bullets.map((b) => `• ${b}`), ...(s.notes ? [`(${s.notes})`] : []), ""])].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  return [d.title, "", l.introduction, ...d.introduction, "", ...d.sections.flatMap((s) => [s.heading, ...s.paragraphs, ""]), l.conclusion, ...d.conclusion].join("\n").trim();
}
