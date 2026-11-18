import { escapeHtml } from "../text/template";
import { CV_SECTIONS, safeExternalUrl, type CvData, type CvLanguage, type CvSectionKey, type CvTemplate } from "./career";

// Pure CV -> HTML for PDF export (mobile: expo-print; web: the print page). Every user-supplied string is escaped here, so the
// result is safe to inject (dangerouslySetInnerHTML) or to hand to a print engine. Links render only when they are https.

/** Every label the print renderer needs. Callers map this list over i18n key `career.cv.sectionPrint.<key>`. */
export const CV_PRINT_LABEL_KEYS = [
  ...CV_SECTIONS,
  "present",
  "idNumber",
  "birthDate",
  "nationality",
  "gender",
  "phone",
  "email",
  "address",
  "website",
  "linkedin",
  "motherTongue",
  "otherLanguages",
  "understanding",
  "speaking",
  "writing",
  "listening",
  "reading",
  "spokenProduction",
  "spokenInteraction",
  "cefrLegend",
  "fieldOfStudy",
  "eqfLevel",
  "gpa",
  "modeOfLearning",
] as const;
export type CvPrintLabelKey = (typeof CV_PRINT_LABEL_KEYS)[number];
export type CvPrintLabels = Record<CvPrintLabelKey, string>;
/** Optional images. photoSrc overrides personal.photoUrl (e.g. a data: URI on mobile). */
export interface CvAssets {
  logoSrc?: string | undefined;
  photoSrc?: string | undefined;
}

const EU_CSS =
  "@page{size:A4;margin:12mm}.cv-europass{background:#fff;font-family:'Open Sans',Arial,Helvetica,sans-serif;color:#3c3c3c;line-height:1.4;font-size:9.5pt;max-width:100%;overflow-wrap:break-word;word-wrap:break-word;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
  ".cv-europass *{box-sizing:border-box;max-width:100%}.cv-europass .eu-head{background:#f0f0f0;padding:10pt 14pt 12pt}.cv-europass .eu-logo-row{text-align:right;height:40pt;margin-bottom:4pt}.cv-europass .eu-logo{height:40pt;width:auto;max-width:100%;object-fit:contain}" +
  ".cv-europass .eu-id{display:flex;gap:14pt;align-items:center}.cv-europass .eu-photo{flex:none;width:95pt;height:95pt;border-radius:50%;border:3px solid #dcdcdc;object-fit:cover}.cv-europass .eu-who{flex:1;min-width:0}" +
  ".cv-europass h1{font-size:20pt;font-weight:700;margin:0 0 6pt;padding-bottom:4pt;border-bottom:1px solid #999}.cv-europass .eu-line{margin:2pt 0;font-size:9pt}.cv-europass .eu-pair{display:inline-block;padding:0 7pt;border-left:1px solid #aaa}.cv-europass .eu-pair:first-child{padding-left:0;border-left:0}" +
  ".cv-europass .eu-sec{margin:14pt 0 0 14pt}.cv-europass h2{position:relative;font-size:12pt;font-weight:700;text-transform:uppercase;margin:0 0 6pt;padding-bottom:3pt;border-bottom:1px solid #bbb}.cv-europass h2::before{content:'';position:absolute;left:-10pt;top:4pt;width:5pt;height:5pt;border-radius:50%;background:#999}" +
  ".cv-europass .item{margin-bottom:8pt;break-inside:avoid;page-break-inside:avoid}.cv-europass .eu-meta{font-size:8pt;color:#777;margin:0 0 1pt}.cv-europass .eu-title{margin:0 0 2pt;font-size:10pt}.cv-europass .eu-up{text-transform:uppercase}.cv-europass .eu-g{color:#777}.cv-europass .eu-pairs{margin:2pt 0;font-size:9pt}.cv-europass ul{margin:3pt 0 0 14pt;padding:0}.cv-europass p{margin:2pt 0}.cv-europass a{color:inherit}" +
  ".cv-europass table{width:100%;border-collapse:collapse;margin:4pt 0;font-size:9pt;table-layout:fixed}.cv-europass th,.cv-europass td{padding:3pt 4pt;text-align:center}.cv-europass th{font-size:8pt;text-transform:uppercase;font-weight:700;border-bottom:1px solid #bbb}.cv-europass td:first-child,.cv-europass th:first-child{text-align:left;width:22%}.cv-europass tbody tr:nth-child(odd){background:#f3f3f3}.cv-europass tr{break-inside:avoid;page-break-inside:avoid}.cv-europass .eu-legend{font-size:8pt;font-style:italic;color:#777;margin-top:3pt}";



const CSS: Record<Exclude<CvTemplate, LayoutTemplate>, string> = {
  europass: EU_CSS,
  classic:
    ".cv{font-family:Georgia,'Times New Roman',serif;color:#111;line-height:1.4;font-size:11pt}.cv h1{font-size:22pt;margin:0}.cv .head{font-size:11pt;color:#444;margin:2pt 0 0}.cv h2{font-size:12pt;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #111;margin:14pt 0 5pt;padding-bottom:2pt}.cv .row{display:flex;justify-content:space-between;gap:8pt}.cv .meta{color:#555}",
  modern:
    ".cv{font-family:Arial,Helvetica,sans-serif;color:#10182B;line-height:1.4;font-size:10.5pt}.cv h1{font-size:24pt;margin:0;color:#4F46E5}.cv .head{font-size:11pt;color:#555;margin:2pt 0 0}.cv h2{font-size:11pt;color:#4F46E5;margin:14pt 0 5pt;padding-left:6pt;border-left:3pt solid #7C3AED}.cv .row{display:flex;justify-content:space-between;gap:8pt}.cv .meta{color:#666}",
  compact:
    ".cv{font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.25;font-size:9.5pt}.cv h1{font-size:18pt;margin:0}.cv .head{font-size:9.5pt;color:#444;margin:1pt 0 0}.cv h2{font-size:10pt;margin:8pt 0 3pt;border-bottom:1px solid #999}.cv .row{display:flex;justify-content:space-between;gap:6pt}.cv .meta{color:#555}",
  minimal:
    ".cv{font-family:'Helvetica Neue',Arial,sans-serif;color:#222;line-height:1.5;font-size:10.5pt}.cv h1{font-size:20pt;font-weight:300;letter-spacing:.04em;margin:0}.cv .head{font-size:10.5pt;color:#666;margin:2pt 0 0}.cv h2{font-size:9.5pt;font-weight:600;text-transform:uppercase;letter-spacing:.16em;color:#888;margin:16pt 0 5pt}.cv .row{display:flex;justify-content:space-between;gap:8pt}.cv .meta{color:#777}",
  executive:
    ".cv{font-family:Georgia,'Times New Roman',serif;color:#14213D;line-height:1.4;font-size:11pt}.cv h1{font-size:24pt;margin:0;border-bottom:3px double #14213D;padding-bottom:4pt}.cv .head{font-size:11pt;color:#4a5568;margin:4pt 0 0;font-style:italic}.cv h2{font-size:11.5pt;text-transform:uppercase;letter-spacing:.1em;color:#14213D;border-bottom:1px solid #14213D;margin:14pt 0 5pt;padding-bottom:2pt}.cv .row{display:flex;justify-content:space-between;gap:8pt}.cv .meta{color:#555}",
  corporate:
    ".cv{font-family:Calibri,Arial,sans-serif;color:#1a202c;line-height:1.4;font-size:10.5pt}.cv h1{font-size:22pt;margin:0;color:#1F3A93}.cv .head{font-size:11pt;color:#4a5568;margin:2pt 0 0}.cv h2{font-size:11pt;text-transform:uppercase;letter-spacing:.05em;color:#fff;background:#1F3A93;padding:2pt 6pt;margin:12pt 0 5pt}.cv .row{display:flex;justify-content:space-between;gap:8pt}.cv .meta{color:#555}",
  creative:
    ".cv{font-family:'Trebuchet MS',Arial,sans-serif;color:#1b1b2f;line-height:1.4;font-size:10.5pt}.cv h1{font-size:26pt;margin:0;color:#7C3AED}.cv .head{font-size:11pt;color:#06B6DA;margin:2pt 0 0;font-weight:600}.cv h2{font-size:12pt;color:#4F46E5;border-left:5px solid #7C3AED;padding-left:6pt;margin:14pt 0 5pt}.cv .row{display:flex;justify-content:space-between;gap:8pt}.cv .meta{color:#666}",
  ats:
    ".cv{font-family:Arial,Helvetica,sans-serif;color:#000;line-height:1.35;font-size:10.5pt}.cv h1{font-size:18pt;margin:0}.cv .head{font-size:10.5pt;color:#000;margin:2pt 0 0}.cv h2{font-size:11pt;text-transform:uppercase;border-bottom:1px solid #000;margin:12pt 0 4pt;padding-bottom:1pt}.cv .row{display:block}.cv .meta{color:#000}",
};

const has = (s: string) => s.trim().length > 0;
const e = escapeHtml;
const link = (url: string): string => {
  const u = safeExternalUrl(url);
  return u ? `<a href="${e(u)}">${e(url.replace(/^https:\/\//i, ""))}</a>` : "";
};
/** Only https, root-relative paths and base64 png/jpeg/webp data URIs may be emitted as an image source. */
const safeSrc = (v: string | undefined): string => {
  const s = (v ?? "").trim();
  return /^https:\/\/[^\s"'<>\\]+$/i.test(s) || /^\/(?!\/)[^\s"'<>\\]*$/.test(s) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : "";
};
const socialValue = (v: string): string => (safeExternalUrl(v) ? link(v) : e(v));
const dates = (start: string, end: string, current: boolean, present: string): string => [start, current ? present : end].filter(has).map(e).join(" – ");

const pair = (label: string, valueHtml: string): string => (valueHtml ? `<span class="eu-pair"><b>${e(label)}:</b> ${valueHtml}</span>` : "");
const pairsLine = (cls: string, pairs: string[]): string => (pairs.filter(Boolean).length ? `<p class="${cls}">${pairs.filter(Boolean).join("")}</p>` : "");
const rawDates = (start: string, end: string, current: boolean, present: string): string => [start, current ? present : end].filter(has).join(" – ");

function renderEuropass(cv: CvData, L: CvPrintLabels, assets: CvAssets): string {
  const p = cv.personal;
  const logo = safeSrc(assets.logoSrc);
  const photo = safeSrc(assets.photoSrc) || (/^https:\/\//i.test(p.photoUrl) ? safeSrc(p.photoUrl) : ""); // stored URL: https only
  const t = (s: string) => (has(s) ? e(s) : "");
  const lines = [
    pairsLine("eu-line", [pair(L.idNumber, t(p.idNumber)), pair(L.birthDate, t(p.birthDate)), pair(L.nationality, t(p.nationality)), pair(L.gender, t(p.gender))]),
    pairsLine("eu-line", [
      pair(L.phone, t(p.phone)),
      pair(L.email, t(p.email)),
      pair(L.linkedin, has(p.linkedin) ? link(p.linkedin) : ""),
      pair(L.website, has(p.website) ? link(p.website) : ""),
      ...p.socials.filter((x) => has(x.platform) && has(x.value)).map((x) => pair(x.platform, socialValue(x.value))),
    ]),
    pairsLine("eu-line", [pair(L.address, t([p.address, p.city].filter(has).join(", ")))]),
  ].join("");
  const out: string[] = [`<style>${EU_CSS}</style>`, '<article class="cv cv-europass">'];
  out.push(
    `<header class="eu-head">${logo ? `<div class="eu-logo-row"><img class="eu-logo" src="${e(logo)}" alt="UNIMATE"></div>` : ""}<div class="eu-id">${photo ? `<img class="eu-photo" src="${e(photo)}" alt="">` : ""}<div class="eu-who">${has(p.fullName) ? `<h1>${e(p.fullName)}</h1>` : ""}${has(p.headline) ? `<p class="eu-line">${e(p.headline)}</p>` : ""}${lines}</div></div></header>`,
  );
  const sec = (title: string, body: string) => (body ? `<section class="eu-sec"><h2>${e(title)}</h2>${body}</section>` : "");
  const item = (inner: string) => `<div class="item">${inner}</div>`;
  const meta = (...parts: string[]) => (parts.some(has) ? `<p class="eu-meta">${parts.filter(has).map(e).join("&nbsp;&nbsp;")}</p>` : "");
  const desc = (s: string) => (has(s) ? `<p>${e(s)}</p>` : "");
  out.push(sec(L.summary, has(cv.summary) ? `<p>${e(cv.summary.trim())}</p>` : ""));
  // Work experience: "ROLE – COMPANY – DATES – LOCATION" (role and company bold, the rest grey), then bullets.
  out.push(
    sec(
      L.experience,
      cv.experience
        .filter((x) => has(x.role) || has(x.company))
        .map((x) => {
          const rest = [rawDates(x.start, x.end, x.current, L.present), x.location].filter(has).map(e);
          const bullets = x.bullets.filter(has);
          return item(
            `<p class="eu-title eu-up"><b>${[x.role, x.company].filter(has).map(e).join(" – ")}</b>${rest.length ? ` <span class="eu-g">– ${rest.join(" – ")}</span>` : ""}</p>${bullets.length ? `<ul>${bullets.map((b) => `<li>${e(b)}</li>`).join("")}</ul>` : ""}`,
          );
        })
        .join(""),
    ),
  );
  out.push(
    sec(
      L.education,
      cv.education
        .filter((x) => has(x.institution) || has(x.degree))
        .map((x) =>
          item(
            `${meta(rawDates(x.start, x.end, false, L.present), x.city)}<p class="eu-title"><b class="eu-up">${e(x.degree)}</b>${has(x.degree) && has(x.institution) ? " " : ""}${e(x.institution)}</p>${pairsLine("eu-pairs", [pair(L.website, has(x.website) ? link(x.website) : ""), pair(L.fieldOfStudy, t(x.field)), pair(L.eqfLevel, t(x.eqfLevel)), pair(L.gpa, t(x.gpa))])}${desc(x.description)}`,
          ),
        )
        .join(""),
    ),
  );
  const skills = cv.skills.filter(has);
  out.push(sec(L.skills, skills.length ? `<p>${skills.map(e).join(" | ")}</p>` : ""));
  const langs = cv.languages.filter((l) => has(l.name));
  const natives = langs.filter((l) => l.native);
  const others = langs.filter((l) => !l.native);
  const cells = (l: CvData["languages"][number]) => [l.listening, l.reading, l.spokenProduction, l.spokenInteraction, l.writing];
  const rowOf = (l: CvData["languages"][number]) =>
    `<tr><td><b class="eu-up">${e(l.name)}</b></td>${cells(l).some(has) ? cells(l).map((c) => `<td>${e(c)}</td>`).join("") : `<td colspan="5">${e(l.level)}</td>`}</tr>`;
  const table = `<p>${e(L.otherLanguages)}:</p><table><thead><tr><th rowspan="2"></th><th colspan="2">${e(L.understanding)}</th><th colspan="2">${e(L.speaking)}</th><th rowspan="2">${e(L.writing)}</th></tr><tr><th>${e(L.listening)}</th><th>${e(L.reading)}</th><th>${e(L.spokenProduction)}</th><th>${e(L.spokenInteraction)}</th></tr></thead><tbody>${others.map(rowOf).join("")}</tbody></table>${others.some((l) => cells(l).some(has)) ? `<p class="eu-legend">${e(L.cefrLegend)}</p>` : ""}`;
  out.push(sec(L.languages, (natives.length ? `<p>${e(L.motherTongue)}: ${natives.map((l) => `<b class="eu-up">${e(l.name)}</b>`).join(", ")}</p>` : "") + (others.length ? table : "")));
  out.push(
    sec(
      L.projects,
      cv.projects
        .filter((x) => has(x.name))
        .map((x) => item(`<p class="eu-title"><b class="eu-up">${e(x.name)}</b></p>${pairsLine("eu-pairs", [pair(L.website, has(x.link) ? link(x.link) : "")])}${desc(x.description)}${x.tech.filter(has).length ? `<p class="eu-meta">${x.tech.filter(has).map(e).join(", ")}</p>` : ""}`))
        .join(""),
    ),
  );
  // Certification: issuer (and date) on a small grey line above the bold title, then description, then mode of learning.
  out.push(
    sec(
      L.certificates,
      cv.certificates
        .filter((c) => has(c.name))
        .map((c) => item(`${meta(c.issuer, c.date || c.year)}<p class="eu-title"><b class="eu-up">${e(c.name)}</b></p>${desc(c.description)}${pairsLine("eu-pairs", [pair(L.website, has(c.link) ? link(c.link) : ""), pair(L.modeOfLearning, t(c.mode))])}`))
        .join(""),
    ),
  );
  out.push(sec(L.honours, cv.honours.filter((x) => has(x.title)).map((x) => item(`${meta(x.date, x.issuer)}<p class="eu-title"><b class="eu-up">${e(x.title)}</b></p>${desc(x.description)}`)).join("")));
  out.push(sec(L.hobbies, cv.hobbies.filter((x) => has(x.title)).map((x) => item(`<p class="eu-title"><b class="eu-up">${e(x.title)}</b></p>${desc(x.description)}`)).join("")));
  out.push(sec(L.activities, cv.activities.filter((x) => has(x.title)).map((x) => item(`${meta(x.date, x.place)}<p class="eu-title"><b class="eu-up">${e(x.title)}</b></p>${desc(x.description)}`)).join("")));
  out.push("</article>");
  return out.filter(Boolean).join("");
}

// ---- Layout templates (sidebar, headline, timeline, elegant, photocard, split): one shared block builder, one layout per id. ----
type LayoutTemplate = "sidebar" | "headline" | "timeline" | "elegant" | "photocard" | "split";
const LAYOUTS: readonly string[] = ["sidebar", "headline", "timeline", "elegant", "photocard", "split"];
const NT_BASE =
  "@page{size:A4;margin:12mm}.cv{max-width:100%;overflow-wrap:break-word;word-wrap:break-word;-webkit-print-color-adjust:exact;print-color-adjust:exact;line-height:1.4;font-size:10pt;background:#fff;color:#1f2937}" +
  ".cv *{box-sizing:border-box;max-width:100%}.cv h1{margin:0;overflow-wrap:break-word}.cv h2{margin:0 0 5pt;font-size:10.5pt;text-transform:uppercase;letter-spacing:.08em}.cv p{margin:2pt 0}.cv ul{margin:3pt 0 0 14pt;padding:0}.cv a{color:inherit}" +
  ".cv .item{margin-bottom:7pt;break-inside:avoid;page-break-inside:avoid}.cv .nt-sec{margin:0 0 12pt}.cv .nt-d{font-size:8.5pt;color:#6b7280;margin:0}.cv .nt-photo{display:block;object-fit:cover;flex:none}" +
  ".cv .nt-grid h2,.cv.cv-split h2{letter-spacing:.04em;overflow-wrap:normal;word-break:keep-all}.cv .nt-grid{display:grid;gap:16pt;align-items:start}.cv .nt-col{min-width:0}.cv .nt-who{flex:1;min-width:0}.cv-timeline .nt-hd,.cv-split .nt-hd{display:flex;gap:12pt;align-items:center}.cv-timeline .nt-photo,.cv-split .nt-photo{width:64pt;height:64pt;border-radius:50%}";
const NT_CSS: Record<LayoutTemplate, string> = {
  sidebar:
    ".cv-sidebar{font-family:Arial,Helvetica,sans-serif}.cv-sidebar .nt-grid{grid-template-columns:minmax(0,32%) minmax(0,1fr);gap:0}.cv-sidebar .nt-side{background:#1E1B4B;color:#fff;padding:16pt 12pt;min-height:250mm}.cv-sidebar .nt-main{padding:16pt 16pt 16pt 18pt}" +
    ".cv-sidebar .nt-side h2{color:#C7D2FE;border-bottom:1px solid #4F46E5;padding-bottom:2pt}.cv-sidebar .nt-side .nt-d{color:#C7D2FE}.cv-sidebar .nt-photo{width:90pt;height:90pt;border-radius:50%;margin:0 auto 12pt;border:3px solid #7C3AED}.cv-sidebar .nt-side p{font-size:9pt}" +
    ".cv-sidebar h1{font-size:26pt;color:#1E1B4B;line-height:1.1}.cv-sidebar .nt-head{font-size:12pt;color:#4F46E5;margin:3pt 0 12pt}.cv-sidebar .nt-main h2{color:#4F46E5;border-bottom:1px solid #C7D2FE;padding-bottom:2pt}@media (max-width:520px){.cv-sidebar .nt-grid{grid-template-columns:minmax(0,1fr)}.cv-sidebar .nt-side{min-height:0}}",
  headline:
    ".cv-headline{font-family:Arial,Helvetica,sans-serif}.cv-headline .nt-top{background:#4F46E5;color:#fff;padding:20pt 18pt}.cv-headline h1{font-size:30pt;font-weight:300;text-transform:uppercase;letter-spacing:.05em;line-height:1.1}.cv-headline .nt-head{font-size:12pt;margin:6pt 0 4pt}.cv-headline .nt-contact{font-size:9pt;color:#E0E7FF}" +
    ".cv-headline .nt-prow{padding:12pt 18pt 0}.cv-headline .nt-photo{width:84pt;height:84pt;border-radius:50%;border:3px solid #7C3AED}.cv-headline .nt-grid{grid-template-columns:minmax(0,32%) minmax(0,1fr);padding:14pt 18pt}.cv-headline h2{color:#4F46E5;border-bottom:2px solid #7C3AED;padding-bottom:2pt}@media (max-width:520px){.cv-headline .nt-grid{grid-template-columns:minmax(0,1fr)}}",
  timeline:
    ".cv-timeline{font-family:'Trebuchet MS',Arial,sans-serif;padding:8pt}.cv-timeline h1{font-size:24pt;color:#7C3AED}.cv-timeline .nt-head{font-size:11.5pt;color:#4b5563;margin:2pt 0}.cv-timeline .nt-contact{font-size:9pt;color:#6b7280;margin-bottom:10pt}.cv-timeline h2{color:#7C3AED;border-bottom:1px solid #DDD6FE;padding-bottom:2pt}" +
    ".cv-timeline .tl{border-left:2px solid #C4B5FD;margin-left:4pt;padding-left:14pt}.cv-timeline .tl .item{position:relative}.cv-timeline .tl .item::before{content:'';position:absolute;left:-21pt;top:3pt;width:8pt;height:8pt;border-radius:50%;background:#7C3AED;border:2px solid #fff}.cv-timeline .tl .nt-d{color:#7C3AED;font-weight:700}",
  elegant:
    "html:has(.cv-elegant),body:has(.cv-elegant){background:#F7F4EE;-webkit-print-color-adjust:exact;print-color-adjust:exact}.cv-elegant{background:#F7F4EE;font-family:Georgia,'Times New Roman',serif;color:#2b2b2b;padding:16pt}.cv-elegant .nt-hd{display:flex;gap:14pt;align-items:center;border-bottom:1px solid #8b7e66;padding-bottom:10pt;margin-bottom:12pt}.cv-elegant .nt-photo{width:80pt;height:80pt;border-radius:10pt;border:1px solid #8b7e66}" +
    ".cv-elegant h1{font-size:26pt;font-weight:400;letter-spacing:.12em}.cv-elegant .nt-head{font-style:italic;color:#555;margin:3pt 0}.cv-elegant .nt-contact{font-size:9pt;color:#555}.cv-elegant .nt-grid{grid-template-columns:minmax(0,32%) minmax(0,1fr)}.cv-elegant h2{font-weight:400;letter-spacing:.14em;border-bottom:1px solid #b8ad98;padding-bottom:2pt;color:#3b3322}@media (max-width:520px){.cv-elegant .nt-grid{grid-template-columns:minmax(0,1fr)}}",
  photocard:
    ".cv-photocard{font-family:Arial,Helvetica,sans-serif}.cv-photocard .nt-hd{display:flex;gap:14pt;align-items:center;background:#EEF2FF;padding:16pt 18pt;border-bottom:3px solid #4F46E5}.cv-photocard .nt-photo{width:92pt;height:92pt;border-radius:12pt}.cv-photocard h1{font-size:24pt;color:#1E1B4B}.cv-photocard .nt-head{font-size:11.5pt;color:#4F46E5;margin:2pt 0}.cv-photocard .nt-contact{font-size:9pt;color:#4b5563}" +
    ".cv-photocard .nt-body{padding:14pt 18pt}.cv-photocard h2{color:#4F46E5}.cv-photocard .nt-bar{height:6pt;background:#4F46E5;margin-top:10pt}",
  split:
    ".cv-split{font-family:'Helvetica Neue',Arial,sans-serif;padding:8pt}.cv-split h1{font-size:24pt;font-weight:300;letter-spacing:.03em;color:#1E1B4B}.cv-split .nt-head{color:#6b7280;margin:2pt 0}.cv-split .nt-contact{font-size:9pt;color:#6b7280;margin-bottom:10pt}" +
    ".cv-split .nt-sec{display:grid;grid-template-columns:minmax(0,25%) minmax(0,1fr);gap:12pt;border-top:1px solid #d1d5db;padding:9pt 0;margin:0}.cv-split h2{font-size:8.5pt;letter-spacing:.14em;color:#4F46E5;margin:0}@media (max-width:520px){.cv-split .nt-sec{grid-template-columns:minmax(0,1fr);gap:4pt}}",
};

function renderLayout(cv: CvData, L: CvPrintLabels, assets: CvAssets, tpl: LayoutTemplate): string {
  const p = cv.personal;
  const photoSrc = safeSrc(assets.photoSrc) || (/^https:\/\//i.test(p.photoUrl) ? safeSrc(p.photoUrl) : "");
  const photo = photoSrc ? `<img class="nt-photo" src="${e(photoSrc)}" alt="">` : "";
  const contacts = (
    [
      [L.phone, has(p.phone) ? e(p.phone) : ""],
      [L.email, has(p.email) ? e(p.email) : ""],
      [L.address, e([p.address, p.city].filter(has).join(", "))],
      [L.linkedin, has(p.linkedin) ? link(p.linkedin) : ""],
      [L.website, has(p.website) ? link(p.website) : ""],
      ...p.socials.filter((x) => has(x.platform) && has(x.value)).map((x): [string, string] => ["", `${e(x.platform)}: ${socialValue(x.value)}`]),
    ] as Array<[string, string]>
  ).filter((c) => c[1]);
  const contactLine = contacts.length ? `<p class="nt-contact">${contacts.map((c) => c[1]).join(" · ")}</p>` : "";
  const contactList = contacts.map((c) => `<p>${c[0] ? `<b>${e(c[0])}:</b> ` : ""}${c[1]}</p>`).join("");
  const name = has(p.fullName) ? `<h1>${e(p.fullName)}</h1>` : "";
  const headline = has(p.headline) ? `<p class="nt-head">${e(p.headline)}</p>` : "";
  const d = (s: string) => (s ? `<p class="nt-d">${s}</p>` : "");
  const desc = (s: string) => (has(s) ? `<p>${e(s)}</p>` : "");
  const item = (inner: string) => `<div class="item">${inner}</div>`;
  const tl = (html: string) => (tpl === "timeline" && html ? `<div class="tl">${html}</div>` : html);
  const langs = cv.languages.filter((l) => has(l.name));
  const cefr = (l: CvData["languages"][number]) => [l.listening, l.reading, l.spokenProduction, l.spokenInteraction, l.writing].filter(has).map(e).join("/");
  const B: Record<string, string> = {
    summary: has(cv.summary) ? `<p>${e(cv.summary.trim())}</p>` : "",
    experience: tl(
      cv.experience
        .filter((x) => has(x.role) || has(x.company))
        .map((x) => item(`${d(dates(x.start, x.end, x.current, L.present))}<p><strong>${e([x.role, x.company].filter(has).join(", "))}</strong>${has(x.location) ? ` · ${e(x.location)}` : ""}</p>${x.bullets.filter(has).length ? `<ul>${x.bullets.filter(has).map((b) => `<li>${e(b)}</li>`).join("")}</ul>` : ""}`))
        .join(""),
    ),
    education: tl(
      cv.education
        .filter((x) => has(x.institution) || has(x.degree))
        .map((x) => item(`${d(dates(x.start, x.end, false, L.present))}<p><strong>${e([x.degree, x.field].filter(has).join(", "))}</strong>${has(x.institution) ? `${has(x.degree) || has(x.field) ? " · " : ""}${e(x.institution)}` : ""}</p>${has(x.gpa) ? `<p class="nt-d">${e(L.gpa)}: ${e(x.gpa)}</p>` : ""}${desc(x.description)}`))
        .join(""),
    ),
    projects: cv.projects
      .filter((x) => has(x.name))
      .map((x) => item(`<p><strong>${e(x.name)}</strong></p>${has(x.link) ? `<p class="nt-d">${link(x.link)}</p>` : ""}${desc(x.description)}${x.tech.filter(has).length ? `<p class="nt-d">${x.tech.filter(has).map(e).join(", ")}</p>` : ""}`))
      .join(""),
    skills: cv.skills.filter(has).length ? `<p>${cv.skills.filter(has).map(e).join(" · ")}</p>` : "",
    languages: langs.map((l) => `<p><strong>${e(l.name)}</strong>${l.native ? ` — ${e(L.motherTongue)}` : has(l.level) ? ` — ${e(l.level)}` : cefr(l) ? ` — ${cefr(l)}` : ""}</p>`).join(""),
    certificates: cv.certificates
      .filter((c) => has(c.name))
      .map((c) => item(`<p><strong>${e(c.name)}</strong></p>${d([c.issuer, c.date || c.year].filter(has).map(e).join(", "))}${desc(c.description)}`))
      .join(""),
    honours: cv.honours.filter((x) => has(x.title)).map((x) => item(`<p><strong>${e(x.title)}</strong></p>${d([x.issuer, x.date].filter(has).map(e).join(", "))}${desc(x.description)}`)).join(""),
    activities: cv.activities.filter((x) => has(x.title)).map((x) => item(`<p><strong>${e(x.title)}</strong></p>${d([x.place, x.date].filter(has).map(e).join(", "))}${desc(x.description)}`)).join(""),
    hobbies: cv.hobbies.filter((x) => has(x.title)).map((x) => item(`<p><strong>${e(x.title)}</strong></p>${desc(x.description)}`)).join(""),
  };
  // one body div per section: the split layout puts the title and the body in two grid cells
  const S = (keys: string[]) => keys.map((k) => (B[k] ? `<section class="nt-sec"><h2>${e(L[k as CvSectionKey])}</h2><div class="nt-sb">${B[k]}</div></section>` : "")).join("");
  const all = ["summary", "experience", "education", "projects", "skills", "languages", "certificates", "honours", "activities", "hobbies"];
  const col = (cls: string, html: string) => `<div class="${cls}">${html}</div>`;
  let body: string;
  if (tpl === "sidebar") {
    body = `<div class="nt-grid">${col("nt-col nt-side", photo + contactList + S(["skills", "languages", "certificates"]))}${col("nt-col nt-main", `<header>${name}${headline}</header>` + S(["summary", "experience", "education", "projects", "honours", "activities", "hobbies"]))}</div>`;
  } else if (tpl === "headline") {
    body = `<header class="nt-top">${name}${headline}${contactLine}</header>${photo ? `<div class="nt-prow">${photo}</div>` : ""}<div class="nt-grid">${col("nt-col", S(["education", "skills", "languages", "projects"]))}${col("nt-col", S(["summary", "experience", "honours", "activities", "hobbies", "certificates"]))}</div>`;
  } else if (tpl === "elegant") {
    body = `<header class="nt-hd">${photo}<div class="nt-who">${name}${headline}${contactLine}</div></header><div class="nt-grid">${col("nt-col", S(["skills", "languages", "certificates", "honours"]))}${col("nt-col", S(["summary", "experience", "education", "projects", "activities", "hobbies"]))}</div>`;
  } else if (tpl === "photocard") {
    body = `<header class="nt-hd">${photo}<div class="nt-who">${name}${headline}${contactLine}</div></header><div class="nt-body">${S(all)}</div><div class="nt-bar"></div>`;
  } else {
    body = `<header class="nt-hd">${photo}<div class="nt-who">${name}${headline}${contactLine}</div></header>${S(all)}`;
  }
  return `<style>${NT_BASE}${NT_CSS[tpl]}</style><article class="cv cv-${tpl}">${body}</article>`;
}

/** Body only: a <style> plus <article class="cv">. */
export function renderCvBodyHtml(cv: CvData, o: { template: CvTemplate; labels: CvPrintLabels; assets?: CvAssets | undefined }): string {
  const L = o.labels;
  if (o.template === "europass") return renderEuropass(cv, L, o.assets ?? {});
  if (LAYOUTS.includes(o.template)) return renderLayout(cv, L, o.assets ?? {}, o.template as LayoutTemplate);
  const p = cv.personal;
  const out: string[] = [`<style>${CSS[o.template as keyof typeof CSS]}.cv ul{margin:3pt 0 0 14pt;padding:0}.cv p{margin:2pt 0}.cv .item{margin-bottom:6pt}.cv a{color:inherit}</style>`, `<article class="cv cv-${o.template}">`];
  const contact = [p.email, p.phone, p.city, ...p.socials.filter((x) => has(x.platform) && has(x.value)).map((x) => `${x.platform}: ${x.value}`)].filter(has).map(e);
  const links = [p.linkedin, p.website].filter(has).map(link).filter(Boolean);
  out.push(`<header>${has(p.fullName) ? `<h1>${e(p.fullName)}</h1>` : ""}${has(p.headline) ? `<p class="head">${e(p.headline)}</p>` : ""}${contact.length || links.length ? `<p class="meta">${[...contact, ...links].join(" · ")}</p>` : ""}</header>`);
  const section = (key: CvSectionKey, body: string) => (body ? `<section><h2>${e(L[key])}</h2>${body}</section>` : "");
  if (has(cv.summary)) out.push(section("summary", `<p>${e(cv.summary.trim())}</p>`));
  out.push(
    section(
      "experience",
      cv.experience
        .filter((x) => has(x.role) || has(x.company))
        .map(
          (x) =>
            `<div class="item"><div class="row"><strong>${e([x.role, x.company].filter(has).join(", "))}</strong><span class="meta">${dates(x.start, x.end, x.current, L.present)}</span></div>${has(x.location) ? `<p class="meta">${e(x.location)}</p>` : ""}${x.bullets.filter(has).length ? `<ul>${x.bullets.filter(has).map((b) => `<li>${e(b)}</li>`).join("")}</ul>` : ""}</div>`,
        )
        .join(""),
    ),
  );
  out.push(
    section(
      "education",
      cv.education
        .filter((x) => has(x.institution) || has(x.degree))
        .map(
          (x) =>
            `<div class="item"><div class="row"><strong>${e([x.degree, x.field].filter(has).join(", "))}${has(x.institution) ? (has(x.degree) || has(x.field) ? " · " : "") + e(x.institution) : ""}</strong><span class="meta">${dates(x.start, x.end, false, L.present)}</span></div>${has(x.gpa) ? `<p class="meta">GPA ${e(x.gpa)}</p>` : ""}${has(x.description) ? `<p>${e(x.description)}</p>` : ""}</div>`,
        )
        .join(""),
    ),
  );
  out.push(
    section(
      "projects",
      cv.projects
        .filter((x) => has(x.name))
        .map((x) => `<div class="item"><div class="row"><strong>${e(x.name)}</strong><span class="meta">${has(x.link) ? link(x.link) : ""}</span></div>${has(x.description) ? `<p>${e(x.description)}</p>` : ""}${x.tech.filter(has).length ? `<p class="meta">${x.tech.filter(has).map(e).join(", ")}</p>` : ""}</div>`)
        .join(""),
    ),
  );
  out.push(section("skills", cv.skills.filter(has).length ? `<p>${cv.skills.filter(has).map(e).join(" · ")}</p>` : ""));
  out.push(section("languages", cv.languages.filter((l) => has(l.name)).length ? `<p>${cv.languages.filter((l) => has(l.name)).map((l) => e(l.name) + (l.native ? ` (${e(L.motherTongue)})` : has(l.level) ? ` (${e(l.level)})` : [l.listening, l.reading, l.spokenProduction, l.spokenInteraction, l.writing].some(has) ? ` (${[l.listening, l.reading, l.spokenProduction, l.spokenInteraction, l.writing].filter(has).map(e).join("/")})` : "")).join(" · ")}</p>` : ""));
  out.push(
    section(
      "certificates",
      cv.certificates
        .filter((c) => has(c.name))
        .map((c) => `<div class="item"><div class="row"><strong>${e(c.name)}</strong><span class="meta">${e([c.issuer, c.year].filter(has).join(", "))}</span></div></div>`)
        .join(""),
    ),
  );
  const extra = (key: CvSectionKey, items: Array<{ title: string; sub: string; description: string }>) =>
    section(
      key,
      items
        .filter((x) => has(x.title))
        .map((x) => `<div class="item"><div class="row"><strong>${e(x.title)}</strong><span class="meta">${e(x.sub)}</span></div>${has(x.description) ? `<p>${e(x.description)}</p>` : ""}</div>`)
        .join(""),
    );
  out.push(extra("honours", cv.honours.map((x) => ({ title: x.title, sub: [x.issuer, x.date].filter(has).join(", "), description: x.description }))));
  out.push(extra("hobbies", cv.hobbies.map((x) => ({ title: x.title, sub: "", description: x.description }))));
  out.push(extra("activities", cv.activities.map((x) => ({ title: x.title, sub: [x.place, x.date].filter(has).join(", "), description: x.description }))));
  out.push("</article>");
  return out.filter(Boolean).join("");
}

/** A complete document for a print engine (expo-print). */
export function renderCvHtml(cv: CvData, o: { template: CvTemplate; language: CvLanguage; title: string; labels: CvPrintLabels; assets?: CvAssets | undefined }): string {
  return `<!doctype html><html lang="${o.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(o.title)}</title><style>@page{margin:16mm}body{margin:0;background:#fff;color:#111}</style></head><body>${renderCvBodyHtml(cv, o)}</body></html>`;
}
