import { escapeHtml } from "../text/template";
import { CV_SECTIONS, safeExternalUrl, type CvData, type CvLanguage } from "./career";
import { renderCvBuilderBody, safeSrc, type CvRenderOptions } from "./cv-render";

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
  "github",
  "portfolio",
  "coreCompetencies",
  "skillsTechnical",
  "skillsSoft",
  "achievements",
  "expires",
  "credential",
  "referencesOnRequest",
  "empFullTime",
  "empPartTime",
  "empContract",
  "empInternship",
  "empFreelance",
  "empVolunteer",
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


const has = (s: string) => s.trim().length > 0;
const e = escapeHtml;
const link = (url: string): string => {
  const u = safeExternalUrl(url);
  return u ? `<a href="${e(u)}">${e(url.replace(/^https:\/\//i, ""))}</a>` : "";
};
const socialValue = (v: string): string => (safeExternalUrl(v) ? link(v) : e(v));

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
  const skills = cv.skills.map((x) => x.name).filter(has);
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
  out.push(sec(L.volunteer, cv.volunteer.filter((x) => has(x.role) || has(x.organization)).map((x) => item(`${meta(rawDates(x.start, x.end, x.current, L.present), x.location)}<p class="eu-title"><b class="eu-up">${[x.role, x.organization].filter(has).map(e).join(" – ")}</b></p>${desc(x.description)}`)).join("")));
  out.push(sec(L.courses, cv.courses.filter((x) => has(x.name)).map((x) => item(`${meta(x.provider, x.date)}<p class="eu-title"><b class="eu-up">${e(x.name)}</b></p>${desc(x.description)}`)).join("")));
  out.push(sec(L.publications, cv.publications.filter((x) => has(x.title)).map((x) => item(`${meta(x.publisher, x.date)}<p class="eu-title"><b>${e(x.title)}</b></p>${has(x.link) ? `<p>${link(x.link)}</p>` : ""}${desc(x.description)}`)).join("")));
  out.push(
    sec(
      L.references,
      cv.references
        .filter((r) => has(r.name) || r.onRequest)
        .map((r) => item(`${has(r.name) ? `<p class="eu-title"><b>${e(r.name)}</b>${has(r.position) || has(r.company) ? ` <span class="eu-g">– ${[r.position, r.company].filter(has).map(e).join(", ")}</span>` : ""}</p>` : ""}${r.onRequest ? `<p>${e(L.referencesOnRequest)}</p>` : pairsLine("eu-pairs", [pair(L.email, t(r.email)), pair(L.phone, t(r.phone))]) + desc(r.note)}`))
        .join(""),
    ),
  );
  out.push("</article>");
  return out.filter(Boolean).join("");
}
/** Body only: a <style> plus <article class="cv">. Legacy "europass" keeps its own renderer; every other id goes to the builder renderer. */
export function renderCvBodyHtml(cv: CvData, o: CvRenderOptions): string {
  if (o.template === "europass") return renderEuropass(cv, o.labels, o.assets ?? {});
  return renderCvBuilderBody(cv, o);
}

/** A complete document for a print engine (expo-print, headless Chrome). */
export function renderCvHtml(cv: CvData, o: CvRenderOptions & { language: CvLanguage; title: string }): string {
  return `<!doctype html><html lang="${o.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(o.title)}</title><style>html,body{margin:0;color:#111}html{background:#fff}</style></head><body>${renderCvBodyHtml(cv, o)}</body></html>`;
}
