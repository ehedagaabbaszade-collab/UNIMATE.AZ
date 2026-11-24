import { escapeHtml } from "../text/template";
import { safeExternalUrl, type CvData, type CvLanguage } from "./career";
import { CV_FONT_STACKS, cvTemplateMeta, resolveCvDesign, type CvDesignSection, type CvResolvedDesign } from "./cv-design";
import { CV_FONT_FACES } from "./cv-fonts.manifest";
import type { CvAssets, CvPrintLabels } from "./cv-html";

// The builder renderer: ONE HTML/CSS source for the live preview, the web print page (window.print) and mobile expo-print.
// Every user string goes through escapeHtml; links only when https; images only via safeSrc; colours only from the validated
// design (hex), fonts only from the allow-list, font URLs only via safeFontSrc. Templates are CSS on a shared structure,
// driven by CSS variables, so every design option works on every template.
// Paged media: A4, @page margins from design.margins, break-inside:avoid on entries, headings break-after:avoid. The
// "page / pages" footer uses @page margin boxes: Chromium 131+ (web print, Android WebView, headless Chrome); iOS WebKit
// (expo-print on iPhone) ignores them, so no page numbers there.

const e = escapeHtml;
const has = (s: string | undefined | null): s is string => typeof s === "string" && s.trim().length > 0;
export const cvLink = (url: string): string => {
  const u = safeExternalUrl(url.trim());
  return u ? `<a href="${e(u)}">${e(u.replace(/^https:\/\//i, ""))}</a>` : "";
};
/** Only https, root-relative paths and base64 png/jpeg/webp data URIs may be emitted as an image source. */
export const safeSrc = (v: string | undefined): string => {
  const s = (v ?? "").trim();
  return /^https:\/\/[^\s"'<>\\]+$/i.test(s) || /^\/(?!\/)[^\s"'<>\\]*$/.test(s) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : "";
};
/** Font sources end up inside CSS url("..."): no quotes, parens, backslashes, angle brackets or whitespace. */
export const safeFontSrc = (v: string | undefined): string => {
  const s = (v ?? "").trim();
  return /^(https:\/\/|\/(?!\/))[A-Za-z0-9._~/:%@-]+$/.test(s) || /^data:font\/woff2;base64,[A-Za-z0-9+/=]+$/.test(s) ? s : "";
};

export interface CvRenderOptions {
  /** Any stored template id (builder, legacy or unknown). */
  template: string;
  labels: CvPrintLabels;
  /** cv_documents.design (validated leniently here; invalid keys fall back to the template default). */
  design?: unknown;
  assets?: CvAssets | undefined;
  /** Font file (CV_FONT_FACES[].file) -> URL or data URI. Web: (f) => `/cv-fonts/${f}`; mobile: (f) => CV_FONT_DATA[f]. */
  fonts?: ((file: string) => string | undefined) | undefined;
  language?: CvLanguage | undefined;
}

const MARGIN_MM = { narrow: 10, normal: 15, wide: 25 } as const;
const FONT_PT = { sm: 9.5, md: 10.5, lg: 11.5 } as const;
const SPACING = { compact: 0.75, normal: 1, relaxed: 1.3 } as const;
const PHOTO_RADIUS = { circle: "50%", rounded: "4mm", square: "0" } as const;

/** Two-column templates: which sections go to the sidebar, which side, how wide, and whether the sidebar is a full-height band. */
const SIDEBAR: Record<string, { sections: CvDesignSection[]; side: "l" | "r"; width: number; band?: "p" | "tint" }> = {
  creative: { sections: ["skills", "languages", "courses", "hobbies"], side: "l", width: 33, band: "p" },
  "two-column": { sections: ["skills", "languages", "education", "certificates", "courses", "hobbies"], side: "r", width: 32, band: "tint" },
  "modern-european": { sections: ["languages", "skills", "hobbies"], side: "l", width: 30, band: "tint" },
};
const SIDEBAR_DEFAULT = { sections: ["skills", "languages", "certificates", "courses", "hobbies"] as CvDesignSection[], side: "r" as const, width: 32 };

const BASE_CSS =
  ".cvb{font-family:var(--ff);font-size:var(--fs);line-height:1.45;color:#1f2328;background:var(--bg);-webkit-print-color-adjust:exact;print-color-adjust:exact;overflow-wrap:break-word;word-wrap:break-word;--mu:#59626e;--tint:color-mix(in srgb,var(--p) 8%,#fff);--ln:color-mix(in srgb,var(--p) 28%,#fff)}" +
  ".cvb *{box-sizing:border-box}.cvb h1{margin:0;font-size:calc(var(--fs)*2.4);line-height:1.12;font-weight:700;color:var(--p)}.cvb .hl{font-size:calc(var(--fs)*1.15);margin:3pt 0 0;color:var(--mu)}" +
  ".cvb .ct{margin:5pt 0 0;color:var(--mu);font-size:.93em}.cvb .ct span+span::before{content:' · '}" +
  ".cvb .h2k{break-inside:avoid;page-break-inside:avoid}.cvb h2{font-size:calc(var(--fs)*1.13*var(--hs));margin:calc(13pt*var(--sp)) 0 calc(5pt*var(--sp));color:var(--p);line-height:1.2;break-after:avoid;page-break-after:avoid}" +
  ".cvb h3{font-size:1em;margin:0;font-weight:700}.cvb p{margin:1.5pt 0}.cvb ul,.cvb ol{margin:2pt 0 0;padding-left:13pt}.cvb li{margin:1pt 0}.cvb a{color:inherit;text-decoration:none}.cvb .ds{white-space:pre-line}" +
  ".cvb .en{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10pt;margin:0 0 calc(7pt*var(--sp));break-inside:avoid;page-break-inside:avoid}.cvb .en-b{grid-column:1;grid-row:1;min-width:0}" +
  ".cvb .en-d{grid-column:2;grid-row:1;text-align:right;white-space:nowrap;color:var(--mu);font-size:.92em;margin:0}.cvb .en-s{color:var(--mu)}.cvb .lb{font-weight:700;font-size:.92em;margin-top:3pt}" +
  ".cvb .sk{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:3pt 12pt}.cvb .sk li{margin:0;break-inside:avoid}.cvb .skg{margin:0 0 5pt;break-inside:avoid}" +
  ".cvb .lv{display:inline-block;vertical-align:middle;margin-left:5pt;width:26pt;height:3.5pt;border-radius:2pt;background:#e5e7eb}" +
  [1, 2, 3, 4, 5].map((n) => `.cvb .lv${n}{background:linear-gradient(90deg,var(--a) ${n * 20}%,#e5e7eb 0)}`).join("") +
  ".cvb .ph{display:block;flex:none;width:30mm;height:30mm;object-fit:cover;border-radius:var(--pr)}.cvb .hd{display:flex;gap:12pt;align-items:center;break-inside:avoid}.cvb .hdw{flex:1;min-width:0}" +
  ".cvb .g{display:grid;grid-template-columns:var(--gc);align-items:start}.cvb .g-r{grid-template-areas:'mn sd'}.cvb .g-l{grid-template-areas:'sd mn'}.cvb .mn{grid-area:mn;min-width:0}.cvb .sd{grid-area:sd;min-width:0}" +
  ".cvb .g-r .mn{padding-right:7mm}.cvb .g-l .mn{padding-left:7mm}.cvb .sd .en{display:block}.cvb .sd .en-d{text-align:left;white-space:normal}.cvb .sd .sk{display:block}.cvb .sd .sk li{margin:0 0 3pt}" +
  ".cvb .ctl{list-style:none;padding:0;margin:0 0 8pt}.cvb .ctl li{margin:0 0 4pt;overflow-wrap:anywhere}.cvb .ctl b.nb{text-transform:none}.cvb .ctl b{display:block;font-size:.78em;text-transform:uppercase;letter-spacing:.06em;opacity:.75}.cvb .cf{font-size:.86em;color:var(--mu)}" +
  "@media print{.cvb.hb{background:transparent}.cvb.hb .sd{background:none!important}}" +
  "@media screen and (max-width:560px){.cvb .g{grid-template-columns:minmax(0,1fr)!important;grid-template-areas:'mn' 'sd'!important}.cvb .g .mn{padding:0!important}.cvb .hd{flex-wrap:wrap}.cvb .en{grid-template-columns:minmax(0,1fr)!important}.cvb .en-d{grid-column:1!important;grid-row:auto!important;text-align:left!important}}";

const TEMPLATE_CSS: Record<string, string> = {
  "modern-minimal":
    ".t-modern-minimal h1{font-weight:400;letter-spacing:-.01em}.t-modern-minimal h1::after{content:'';display:block;width:16mm;height:2.2pt;background:var(--a);margin-top:6pt}" +
    ".t-modern-minimal h2{font-size:calc(var(--fs)*.86*var(--hs));text-transform:uppercase;letter-spacing:.16em;color:var(--mu);margin-top:calc(18pt*var(--sp))}",
  corporate:
    ".t-corporate .hd{background:var(--p);color:#fff;padding:12pt 14pt}.t-corporate h1{color:#fff}.t-corporate .hd .hl,.t-corporate .hd .ct{color:#e8edf3}.t-corporate .ph{border:2pt solid #fff}" +
    ".t-corporate h2{text-transform:uppercase;letter-spacing:.05em;border-bottom:1.2pt solid var(--p);padding-bottom:2pt}" +
    ".t-corporate .mn .en{grid-template-columns:26mm minmax(0,1fr);column-gap:4mm}.t-corporate .mn .en-d{grid-column:1;text-align:left;white-space:normal;color:var(--a);font-weight:700}.t-corporate .mn .en-b{grid-column:2}",
  executive:
    ".t-executive .hd{display:block;text-align:center;border-bottom:.8pt solid var(--a);padding-bottom:9pt}.t-executive .hd .ph{margin:0 auto 8pt}.t-executive h1{text-transform:uppercase;letter-spacing:.16em;font-weight:400}" +
    ".t-executive .hl{letter-spacing:.06em;color:var(--a)}.t-executive h2{font-weight:400;text-transform:uppercase;letter-spacing:.14em;border-bottom:.6pt solid var(--a);padding-bottom:2pt}" +
    ".t-executive .s-skills .sk{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2pt 10pt}.t-executive .en-t{font-size:1.05em}",
  creative:
    ".t-creative .sd{background:var(--p);color:#fff;padding:6mm;align-self:stretch}.t-creative .sd h2{color:var(--a);text-transform:uppercase;letter-spacing:.1em;font-size:calc(var(--fs)*.95*var(--hs))}" +
    ".t-creative .sd .en-s,.t-creative .sd .en-d,.t-creative .sd .cf{color:#e9e3f5}.t-creative .sd .ph{width:36mm;height:36mm;margin:0 auto 8mm;border:2.5pt solid var(--a)}" +
    ".t-creative h1{font-size:calc(var(--fs)*2.9);text-transform:uppercase;letter-spacing:.02em;line-height:1}.t-creative .mn .hl{color:var(--a);font-weight:700;text-transform:uppercase;letter-spacing:.08em}" +
    ".t-creative .mn h2{text-transform:uppercase;letter-spacing:.08em}.t-creative .mn h2::after{content:'';display:block;width:12mm;height:2.5pt;background:var(--a);margin-top:3pt}",
  academic:
    ".t-academic{color:#000}.t-academic .hd{display:block;text-align:center}.t-academic h1{color:#000;font-weight:400;font-size:calc(var(--fs)*2.1)}.t-academic .hl,.t-academic .ct{color:#000}" +
    ".t-academic h2{color:#000;text-transform:uppercase;letter-spacing:.08em;font-size:calc(var(--fs)*1.05*var(--hs));border-bottom:.6pt solid #000;padding-bottom:1pt}.t-academic .en-s,.t-academic .en-d{color:#000;font-style:italic}.t-academic .pubs li{margin:0 0 4pt}",
  graduate:
    ".t-graduate .hl{color:var(--a);font-weight:700}.t-graduate h2{border-left:3.5pt solid var(--a);padding:2pt 6pt;background:color-mix(in srgb,var(--a) 9%,#fff)}" +
    ".t-graduate .s-projects .en-t,.t-graduate .s-experience .en-t{color:var(--p)}.t-graduate .s-projects .en{border-left:1.2pt solid color-mix(in srgb,var(--a) 45%,#fff);padding-left:6pt}",
  "two-column":
    ".t-two-column .sd{background:var(--tint);padding:6mm;align-self:stretch}.t-two-column h2{text-transform:uppercase;letter-spacing:.06em;font-size:calc(var(--fs)*1.02*var(--hs))}" +
    ".t-two-column .sd h2{border-bottom:1pt solid var(--ln);padding-bottom:2pt}.t-two-column .mn .hd{border-bottom:2pt solid var(--a);padding-bottom:7pt}",
  "modern-european":
    ".t-modern-european .sd{background:var(--tint);padding:6mm;align-self:stretch}.t-modern-european .sd .ph{width:32mm;height:32mm;margin:0 auto 6mm}" +
    ".t-modern-european h2{border-bottom:.8pt solid var(--a);padding-bottom:2pt}.t-modern-european .sd h2{font-size:calc(var(--fs)*1*var(--hs))}" +
    ".t-modern-european .mn .en{grid-template-columns:22mm minmax(0,1fr);column-gap:4mm}.t-modern-european .mn .en-d{grid-column:1;text-align:left;white-space:normal;color:var(--a);font-weight:700}.t-modern-european .mn .en-b{grid-column:2}",
  "clean-international":
    ".t-clean-international .hd{flex-direction:row-reverse;justify-content:space-between}.t-clean-international h1{letter-spacing:-.01em}" +
    ".t-clean-international h2{font-size:calc(var(--fs)*.95*var(--hs));text-transform:uppercase;letter-spacing:.1em;border-top:.5pt solid #cfcfcf;padding-top:6pt}.t-clean-international .en-s{color:var(--a)}",
  ats: ".t-ats{color:#000}.t-ats h1{color:#000;font-size:calc(var(--fs)*1.9)}.t-ats .hl,.t-ats .ct{color:#000}.t-ats h2{color:#000;font-size:calc(var(--fs)*1.15);margin:12pt 0 4pt}.t-ats .en{display:block}.t-ats .en-s{color:#000}",
};

const mmYyyy = (s: string): string => {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(s.trim());
  return m ? `${m[2]}/${m[1]}` : s;
};

/** Builder renderer: body fragment (<style> + <article class="cvb">). */
export function renderCvBuilderBody(cv: CvData, o: CvRenderOptions): string {
  const L = o.labels;
  const meta = cvTemplateMeta(o.template);
  const d: CvResolvedDesign = resolveCvDesign(meta.id, o.design);
  const ats = d.mode === "ats" || meta.id === "ats-classic";
  const tpl = ats ? "ats" : meta.id;
  const sideCfg = ats || d.columns !== "two" ? null : (SIDEBAR[tpl] ?? SIDEBAR_DEFAULT);
  const sideHeader = sideCfg !== null && tpl in SIDEBAR; // templates whose sidebar carries photo + contacts
  const fmt = tpl === "modern-european" ? mmYyyy : (s: string) => s;
  const p = cv.personal;

  // ---- small builders (all inputs escaped here)
  const dates = (start: string, end: string, current: boolean) => [start, current ? L.present : end].filter(has).map((x) => e(fmt(x))).join(" – ");
  const desc = (s: string) => (has(s) ? `<p class="ds">${e(s.trim())}</p>` : "");
  const bullets = (items: string[]) => {
    const xs = items.filter(has);
    if (!xs.length) return "";
    return ats ? xs.map((x) => `<p>• ${e(x)}</p>`).join("") : `<ul>${xs.map((x) => `<li>${e(x)}</li>`).join("")}</ul>`;
  };
  const entry = (title: string, sub: string, when: string, body: string) =>
    ats
      ? `<div class="en"><p><b>${title}</b>${[sub, when].filter(Boolean).map((x) => ` | ${x}`).join("")}</p>${body}</div>`
      : `<div class="en"><div class="en-b">${title ? `<h3 class="en-t">${title}</h3>` : ""}${sub ? `<p class="en-s">${sub}</p>` : ""}${body}</div>${when ? `<p class="en-d">${when}</p>` : ""}</div>`;
  const join = (...xs: string[]) => xs.filter(has).map(e).join(", ");
  const line = (label: string, html: string) => (html ? `<p>${e(label)}: ${html}</p>` : "");
  const EMP: Record<string, string> = { full_time: L.empFullTime, part_time: L.empPartTime, contract: L.empContract, internship: L.empInternship, freelance: L.empFreelance, volunteer: L.empVolunteer };

  // ---- sections (empty string = not rendered)
  const skills = cv.skills.filter((s) => has(s.name));
  const skillList = (xs: typeof skills) =>
    ats ? `<p>${xs.map((s) => e(s.name)).join(", ")}</p>` : `<ul class="sk">${xs.map((s) => `<li>${e(s.name)}${s.level ? `<span class="lv lv${s.level}" aria-hidden="true"></span>` : ""}</li>`).join("")}</ul>`;
  const skillGroups = skills.some((s) => s.kind)
    ? (
        [
          [L.skillsTechnical, skills.filter((s) => s.kind === "technical")],
          [L.skillsSoft, skills.filter((s) => s.kind === "soft")],
          ["", skills.filter((s) => !s.kind)],
        ] as const
      )
        .filter(([, xs]) => xs.length)
        .map(([label, xs]) => `<div class="skg">${label ? `<p class="lb">${e(label)}</p>` : ""}${skillList(xs)}</div>`)
        .join("")
    : skills.length
      ? skillList(skills)
      : "";
  const langs = cv.languages.filter((l) => has(l.name));
  const cefr = (l: CvData["languages"][number]) =>
    (
      [
        [L.listening, l.listening],
        [L.reading, l.reading],
        [L.spokenProduction, l.spokenProduction],
        [L.spokenInteraction, l.spokenInteraction],
        [L.writing, l.writing],
      ] as const
    ).filter(([, v]) => has(v));
  const langLevel = (l: CvData["languages"][number]) => (l.native ? L.motherTongue : has(l.level) ? l.level : cefr(l).map(([, v]) => v).join("/"));
  const languages = langs
    .map((l) =>
      !ats && tpl === "modern-european" && !l.native && cefr(l).length
        ? `<div class="en"><div class="en-b"><h3 class="en-t">${e(l.name)}</h3><p class="cf">${cefr(l).map(([k, v]) => `${e(k)} ${e(v)}`).join(" · ")}</p></div></div>`
        : `<p><b>${e(l.name)}</b>${langLevel(l) ? ` — ${e(langLevel(l))}` : ""}</p>`,
    )
    .join("");
  const S: Record<CvDesignSection, string> = {
    summary: has(cv.summary) ? `<p class="ds">${e(cv.summary.trim())}</p>` : "",
    experience: cv.experience
      .filter((x) => has(x.role) || has(x.company))
      .map((x) => {
        const ach = x.achievements.filter(has);
        const sub = [e([x.company, x.location].filter(has).join(", ")), x.employmentType ? e(EMP[x.employmentType] ?? "") : ""].filter(Boolean).join(" · ");
        return entry(e(has(x.role) ? x.role : x.company), has(x.role) ? sub : x.employmentType ? e(EMP[x.employmentType] ?? "") : e(x.location), dates(x.start, x.end, x.current), bullets(x.bullets) + (ach.length ? `<p class="lb">${e(L.achievements)}</p>${bullets(ach)}` : ""));
      })
      .join(""),
    education: cv.education
      .filter((x) => has(x.institution) || has(x.degree))
      .map((x) => entry(join(x.degree, x.field) || e(x.institution), has(x.degree) || has(x.field) ? join(x.institution, x.city) : e(x.city), dates(x.start, x.end, false), line(L.gpa, has(x.gpa) ? e(x.gpa) : "") + desc(x.description)))
      .join(""),
    projects: cv.projects
      .filter((x) => has(x.name))
      .map((x) => entry(e(x.name), e(x.role), "", (has(x.link) ? `<p>${cvLink(x.link)}</p>` : "") + desc(x.description) + (x.tech.filter(has).length ? `<p class="en-s">${x.tech.filter(has).map(e).join(", ")}</p>` : "")))
      .join(""),
    skills: skillGroups,
    languages,
    certificates: cv.certificates
      .filter((c) => has(c.name))
      .map((c) => entry(e(c.name), e(c.issuer), e(fmt(c.date || c.year)), line(L.expires, has(c.expiry) ? e(fmt(c.expiry)) : "") + line(L.credential, cvLink(c.credentialUrl) || cvLink(c.link)) + desc(c.description)))
      .join(""),
    courses: cv.courses
      .filter((c) => has(c.name))
      .map((c) => entry(e(c.name), e(c.provider), e(fmt(c.date)), desc(c.description)))
      .join(""),
    volunteer: cv.volunteer
      .filter((v) => has(v.role) || has(v.organization))
      .map((v) => entry(e(has(v.role) ? v.role : v.organization), has(v.role) ? join(v.organization, v.location) : e(v.location), dates(v.start, v.end, v.current), desc(v.description)))
      .join(""),
    publications: cv.publications.filter((x) => has(x.title)).length
      ? `<ol class="pubs">${cv.publications
          .filter((x) => has(x.title))
          .map((x) => `<li><b>${e(x.title)}</b>${has(x.publisher) || has(x.date) ? `. ${join(x.publisher, fmt(x.date))}` : ""}${has(x.link) ? `. ${cvLink(x.link)}` : ""}${desc(x.description)}</li>`)
          .join("")}</ol>`
      : "",
    honours: cv.honours
      .filter((x) => has(x.title))
      .map((x) => entry(e(x.title), e(x.issuer), e(fmt(x.date)), desc(x.description)))
      .join(""),
    activities: cv.activities
      .filter((x) => has(x.title))
      .map((x) => entry(e(x.title), e(x.place), e(fmt(x.date)), desc(x.description)))
      .join(""),
    hobbies: cv.hobbies.filter((x) => has(x.title)).some((x) => has(x.description))
      ? cv.hobbies
          .filter((x) => has(x.title))
          .map((x) => entry(e(x.title), "", "", desc(x.description)))
          .join("")
      : cv.hobbies.filter((x) => has(x.title)).length
        ? `<p>${cv.hobbies
            .filter((x) => has(x.title))
            .map((x) => e(x.title))
            .join(" · ")}</p>`
        : "",
    references: cv.references
      .filter((r) => has(r.name) || r.onRequest)
      .map((r) =>
        r.onRequest && !has(r.name)
          ? `<p>${e(L.referencesOnRequest)}</p>`
          : entry(e(r.name), join(r.position, r.company), "", r.onRequest ? `<p>${e(L.referencesOnRequest)}</p>` : (has(r.email) || has(r.phone) ? `<p>${join(r.email, r.phone)}</p>` : "") + desc(r.note)),
      )
      .join(""),
  };
  const heading = (id: CvDesignSection) => (id === "skills" && tpl === "executive" ? L.coreCompetencies : L[id]);
  const visible = d.sectionOrder.filter((id) => !d.hidden.includes(id) && S[id]);
  // Heading + FIRST entry stay together (break-after:avoid alone leaves orphan headings in Chrome); later entries flow.
  const firstBlock = (html: string): number => {
    let depth = 0;
    for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)[^>]*>/gi)) {
      if (m.index === 0 && m[1]) return 0;
      if (/^(img|br|hr|input)$/i.test(m[2]!)) {
        if (depth === 0) return m.index + m[0].length;
        continue;
      }
      depth += m[1] ? -1 : 1;
      if (depth === 0) return m.index + m[0].length;
    }
    return 0;
  };
  const sections = (ids: CvDesignSection[]) =>
    ids
      .map((id) => {
        const cut = S[id].startsWith("<") ? firstBlock(S[id]) : 0;
        return `<section class="s s-${id}"><div class="h2k"><h2>${e(heading(id))}</h2>${S[id].slice(0, cut)}</div>${S[id].slice(cut)}</section>`;
      })
      .join("");

  // ---- header pieces
  const photoSrc = ats || !meta.supportsPhoto || !d.showPhoto ? "" : safeSrc(o.assets?.photoSrc) || (/^https:\/\//i.test(p.photoUrl) ? safeSrc(p.photoUrl) : "");
  const photo = photoSrc ? `<img class="ph" src="${e(photoSrc)}" alt="">` : "";
  const contacts: Array<[string, string]> = (
    [
      [L.email, has(p.email) ? e(p.email.trim()) : ""],
      [L.phone, has(p.phone) ? e(p.phone.trim()) : ""],
      [L.address, e([p.address, p.city].filter(has).join(", "))],
      [L.linkedin, has(p.linkedin) ? cvLink(p.linkedin) : ""],
      [L.github, has(p.github) ? cvLink(p.github) : ""],
      [L.website, has(p.website) ? cvLink(p.website) : ""],
      [L.portfolio, has(p.portfolio) ? cvLink(p.portfolio) : ""],
      ...p.socials.filter((x) => has(x.platform) && has(x.value)).map((x): [string, string] => [x.platform, safeExternalUrl(x.value) ? cvLink(x.value) : e(x.value)]),
    ] as Array<[string, string]>
  ).filter(([, v]) => v);
  const details: Array<[string, string]> = (
    [
      [L.birthDate, p.birthDate],
      [L.nationality, p.nationality],
      [L.gender, p.gender],
      [L.idNumber, p.idNumber],
    ] as Array<[string, string]>
  )
    .filter(([, v]) => has(v))
    .map(([k, v]) => [k, e(fmt(v))]);
  const name = has(p.fullName) ? `<h1>${e(p.fullName.trim())}</h1>` : "";
  const headline = has(p.headline) ? `<p class="hl">${e(p.headline.trim())}</p>` : "";
  const contactLine = contacts.length ? (ats ? `<p class="ct">${contacts.map(([, v]) => v).join(" | ")}</p>` : `<p class="ct">${contacts.map(([, v]) => `<span>${v}</span>`).join("")}</p>`) : "";
  // Brand/link labels keep their natural case (uppercasing in az turns "LinkedIn" into "LİNKEDİN").
  const brand = new Set([L.linkedin, L.github, L.website, L.portfolio, ...p.socials.map((x) => x.platform)]);
  const contactList = (xs: Array<[string, string]>) => (xs.length ? `<ul class="ctl">${xs.map(([k, v]) => `<li><b${brand.has(k) ? ' class="nb"' : ""}>${e(k)}</b>${v}</li>`).join("")}</ul>` : "");

  let body: string;
  if (!sideCfg) {
    body = `<header class="hd">${photo}<div class="hdw">${name}${headline}${contactLine}</div></header><main class="mn">${sections(visible)}</main>`;
  } else {
    const side = visible.filter((id) => sideCfg.sections.includes(id));
    const main = visible.filter((id) => !sideCfg.sections.includes(id));
    const top = sideHeader ? `<header class="hd"><div class="hdw">${name}${headline}</div></header>` : "";
    const sideTop = sideHeader ? `${photo}${contactList(tpl === "modern-european" ? [...contacts, ...details] : contacts)}` : "";
    // DOM order: main content first, sidebar second (linear text layer); the grid only moves the sidebar visually.
    const grid = `<div class="g g-${sideCfg.side}"><main class="mn">${top}${sections(main)}</main><aside class="sd">${sideTop}${sections(side)}</aside></div>`;
    body = sideHeader ? grid : `<header class="hd">${photo}<div class="hdw">${name}${headline}${contactLine}</div></header>${grid}`;
  }

  // ---- theme: every value below comes from an enum or a validated #RRGGBB
  const m = MARGIN_MM[d.margins];
  const band = sideCfg && "band" in sideCfg && sideCfg.band ? sideCfg : null;
  const cols = sideCfg ? (sideCfg.side === "l" ? `${sideCfg.width}% minmax(0,1fr)` : `minmax(0,1fr) ${sideCfg.width}%`) : "";
  const vars = [
    `--p:${ats ? "#000000" : d.primary}`,
    `--a:${ats ? "#000000" : d.accent}`,
    `--bg:${ats ? "#FFFFFF" : d.background}`,
    `--fs:${FONT_PT[d.fontSize]}pt`,
    `--hs:${ats ? 1 : d.headingScale}`,
    `--sp:${SPACING[d.spacing]}`,
    `--ff:${CV_FONT_STACKS[d.font]}`,
    `--pr:${PHOTO_RADIUS[d.photoShape]}`,
    ...(cols ? [`--gc:${cols}`] : []),
  ].join(";");
  // Band templates print with @page margin 0 so the side panel bleeds to every page edge; the page margins become top/bottom padding
  // repeated on every fragment of both columns (box-decoration-break:clone). No page-number box: margin boxes need a page margin.
  const page = band
    ? `@page{size:A4;margin:0}@media print{.cvb.hb .mn,.cvb.hb .sd{padding-top:${m}mm;padding-bottom:${m}mm;-webkit-box-decoration-break:clone;box-decoration-break:clone}}.cvb.hb .mn{padding-${band.side === "l" ? "right" : "left"}:${m}mm}`
    : `@page{size:A4;margin:${m}mm;@bottom-right{content:counter(page) " / " counter(pages);font-family:${CV_FONT_STACKS[d.font]};font-size:8pt;color:#777}}`;
  // Full-height sidebar on every printed page: a fixed panel (Chrome repeats fixed elements per page). A root gradient is NOT used: it drops out after page 2.
  const bandColor = band ? (band.band === "p" ? d.primary : `color-mix(in srgb,${d.primary} 8%,#fff)`) : "";
  const bandCss = band
    ? `.cvb .bandbg{display:none}@media print{.cvb.hb .bandbg{display:block;position:fixed;top:0;bottom:0;${band.side === "l" ? "left" : "right"}:0;width:${band.width}%;background:${bandColor};z-index:-1;-webkit-print-color-adjust:exact;print-color-adjust:exact}}`
    : "";
  const fontCss = o.fonts
    ? CV_FONT_FACES.filter((f) => f.family === d.font)
        .map((f) => {
          const src = safeFontSrc(o.fonts!(f.file));
          return src ? `@font-face{font-family:'CV ${f.family === "inter" ? "Inter" : f.family === "noto-sans" ? "Noto Sans" : "Noto Serif"}';src:url("${src}") format("woff2");font-weight:${f.weight};font-style:normal;font-display:block;unicode-range:${f.unicodeRange}}` : "";
        })
        .join("")
    : "";
  const lang = o.language ? ` lang="${e(o.language)}"` : "";
  return `<style>${fontCss}${page}${bandCss}${BASE_CSS}${TEMPLATE_CSS[tpl] ?? ""}</style><article class="cv cvb t-${tpl} cv-${/^[a-z0-9_-]{1,30}$/.test(o.template) ? o.template : "unknown"}${band ? " hb" : ""}"${lang} style="${e(vars)}">${band ? '<div class="bandbg" aria-hidden="true"></div>' : ""}${body}</article>`;
}
