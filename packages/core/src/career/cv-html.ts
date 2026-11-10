import { escapeHtml } from "../text/template";
import { safeExternalUrl, type CvData, type CvLanguage, type CvSectionKey, type CvTemplate } from "./career";

// Pure CV -> HTML for PDF export (mobile: expo-print; web: the print page). Every user-supplied string is escaped here, so the
// result is safe to inject (dangerouslySetInnerHTML) or to hand to a print engine. Links render only when they are https.

export type CvPrintLabels = Record<CvSectionKey | "present", string>;


const CSS: Record<CvTemplate, string> = {
  classic:
    ".cv{font-family:Georgia,'Times New Roman',serif;color:#111;line-height:1.4;font-size:11pt}.cv h1{font-size:22pt;margin:0}.cv .head{font-size:11pt;color:#444;margin:2pt 0 0}.cv h2{font-size:12pt;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #111;margin:14pt 0 5pt;padding-bottom:2pt}.cv .row{display:flex;justify-content:space-between;gap:8pt}.cv .meta{color:#555}",
  modern:
    ".cv{font-family:Arial,Helvetica,sans-serif;color:#10182B;line-height:1.4;font-size:10.5pt}.cv h1{font-size:24pt;margin:0;color:#4F46E5}.cv .head{font-size:11pt;color:#555;margin:2pt 0 0}.cv h2{font-size:11pt;color:#4F46E5;margin:14pt 0 5pt;padding-left:6pt;border-left:3pt solid #7C3AED}.cv .row{display:flex;justify-content:space-between;gap:8pt}.cv .meta{color:#666}",
  compact:
    ".cv{font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.25;font-size:9.5pt}.cv h1{font-size:18pt;margin:0}.cv .head{font-size:9.5pt;color:#444;margin:1pt 0 0}.cv h2{font-size:10pt;margin:8pt 0 3pt;border-bottom:1px solid #999}.cv .row{display:flex;justify-content:space-between;gap:6pt}.cv .meta{color:#555}",
};

const has = (s: string) => s.trim().length > 0;
const e = escapeHtml;
const link = (url: string): string => {
  const u = safeExternalUrl(url);
  return u ? `<a href="${e(u)}">${e(url.replace(/^https:\/\//i, ""))}</a>` : "";
};
const dates = (start: string, end: string, current: boolean, present: string): string => [start, current ? present : end].filter(has).map(e).join(" – ");

/** Body only: a <style> plus <article class="cv">. */
export function renderCvBodyHtml(cv: CvData, o: { template: CvTemplate; labels: CvPrintLabels }): string {
  const L = o.labels;
  const p = cv.personal;
  const out: string[] = [`<style>${CSS[o.template]}.cv ul{margin:3pt 0 0 14pt;padding:0}.cv p{margin:2pt 0}.cv .item{margin-bottom:6pt}.cv a{color:inherit}</style>`, `<article class="cv cv-${o.template}">`];
  const contact = [p.email, p.phone, p.city].filter(has).map(e);
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
  out.push(section("languages", cv.languages.filter((l) => has(l.name)).length ? `<p>${cv.languages.filter((l) => has(l.name)).map((l) => e(l.name) + (has(l.level) ? ` (${e(l.level)})` : "")).join(" · ")}</p>` : ""));
  out.push(
    section(
      "certificates",
      cv.certificates
        .filter((c) => has(c.name))
        .map((c) => `<div class="item"><div class="row"><strong>${e(c.name)}</strong><span class="meta">${e([c.issuer, c.year].filter(has).join(", "))}</span></div></div>`)
        .join(""),
    ),
  );
  out.push("</article>");
  return out.filter(Boolean).join("");
}

/** A complete document for a print engine (expo-print). */
export function renderCvHtml(cv: CvData, o: { template: CvTemplate; language: CvLanguage; title: string; labels: CvPrintLabels }): string {
  return `<!doctype html><html lang="${o.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(o.title)}</title><style>@page{margin:16mm}body{margin:0}</style></head><body>${renderCvBodyHtml(cv, o)}</body></html>`;
}
