import { describe, expect, it } from "vitest";
import {
  CV_LEGACY_TEMPLATES,
  CV_PRINT_LABEL_KEYS,
  CV_TEMPLATES,
  CV_TEMPLATE_CATALOG,
  CvDataSchema,
  CvDesignSchema,
  parseCvDesign,
  parseCvData,
  renderCvBodyHtml,
  renderCvHtml,
  resolveCvDesign,
  safeFontSrc,
  type CvPrintLabels,
} from "../index";

const labels = Object.fromEntries(CV_PRINT_LABEL_KEYS.map((k) => [k, `L_${k}`])) as CvPrintLabels;
const evil = `<script>alert(1)</script>"'&`;
const full = CvDataSchema.parse({
  personal: { fullName: `Ayşən ${evil}`, headline: "Data analyst", email: "a@x.az", phone: "+994 50", city: "Bakı", linkedin: "linkedin.com/in/a", github: "https://github.com/a", portfolio: "javascript:alert(1)".replace("javascript:", "https://p.az/") },
  summary: `Summary ${evil}`,
  experience: [{ role: "Analyst", company: "Co", location: "Bakı", start: "2023-05", current: true, employmentType: "internship", bullets: [`Did ${evil}`], achievements: ["Won"] }],
  education: [{ institution: "BDU", degree: "BSc", field: "CS", start: "2019", end: "2023", gpa: "90" }],
  skills: ["SQL", { name: "Teamwork", kind: "soft", level: 4 }],
  languages: [{ name: "Azərbaycan", native: true }, { name: "English", listening: "B2", reading: "C1" }],
  projects: [{ name: "Proj", role: "Lead", link: "https://example.org/p", tech: ["TS"] }],
  certificates: [{ name: "Cert", issuer: "Org", date: "2024", expiry: "2027", credentialUrl: "https://c.az/1" }],
  courses: [{ name: "Course", provider: "Coursera" }],
  volunteer: [{ role: "Mentor", organization: "NGO" }],
  publications: [{ title: "Paper", publisher: "Journal", date: "2024" }],
  references: [{ name: "Dr. R", position: "Prof", onRequest: true }],
  honours: [{ title: "Award" }],
  activities: [{ title: "Club" }],
  hobbies: [{ title: "Chess" }],
});
const render = (template: string, design?: unknown, data = full, photoSrc?: string) => renderCvBodyHtml(data, { template, labels, design, assets: photoSrc ? { photoSrc } : {}, language: "az" });
const h2 = (html: string) => [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);

describe("template catalog", () => {
  it("has the ten builder templates with metadata and i18n keys", () => {
    expect(CV_TEMPLATE_CATALOG.map((t) => t.id)).toEqual([...CV_TEMPLATES]);
    for (const t of CV_TEMPLATE_CATALOG) {
      expect(t.nameKey).toBe(`career.cv.templates.${t.id}`);
      expect(CvDesignSchema.safeParse(t.defaults).success).toBe(true);
      expect(t.categories.length).toBeGreaterThan(0);
    }
  });
});

describe("builder renderer", () => {
  for (const id of CV_TEMPLATES) {
    for (const mode of ["designed", "ats"] as const) {
      it(`${id} (${mode}): renders every section, escapes, links https only`, () => {
        const html = render(id, { mode });
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
        expect(html).not.toContain("javascript:");
        expect(html).toContain('href="https://github.com/a"');
        expect(html).toContain('lang="az"');
        for (const s of ["summary", "experience", "education", "projects", "languages", "certificates", "courses", "volunteer", "publications", "references", "honours", "activities", "hobbies"]) expect(h2(html)).toContain(`L_${s}`);
        if (mode === "designed" && ["creative", "two-column", "modern-european"].includes(id)) {
          expect(html).toContain("@page{size:A4;margin:0}"); // side panel bleeds to every page edge; margins are padding
          expect(html).toContain("box-decoration-break:clone");
        } else expect(html).toContain("@bottom-right");
        expect(html).toMatch(/\.en\{[^}]*break-inside:avoid/);
        expect(html).toMatch(/h2\{[^}]*break-after:avoid/);
      });
    }
    it(`${id}: hides empty sections and respects order + hidden`, () => {
      const data = CvDataSchema.parse({ personal: { fullName: "X" }, summary: "S", skills: ["SQL"], courses: [{ name: "C" }] });
      expect(h2(render(id, { columns: "one", sectionOrder: ["courses", "skills", "summary"] }, data))).toEqual(["L_courses", id === "executive" ? "L_coreCompetencies" : "L_skills", "L_summary"]);
      expect(h2(render(id, { columns: "one", hidden: ["skills"] }, data))).not.toContain("L_skills");
      expect(h2(render(id, {}, CvDataSchema.parse({})))).toEqual([]);
    });
    it(`${id}: ATS mode is single column, no images, no graphics, real bullets, contacts in the body`, () => {
      const html = render(id, { mode: "ats", showPhoto: true, columns: "two" }, full, "https://example.org/p.png");
      expect(html).toContain("t-ats");
      expect(html).not.toContain("<img");
      expect(html).not.toContain('class="g ');
      expect(html).not.toContain("html:has(.cvb.hb)");
      expect(html).not.toContain('class="lv');
      expect(html).not.toContain("<ul");
      expect(html).toContain("<p>• Did ");
      expect(html).toContain("<b>Analyst</b> | Co, Bakı · L_empInternship | 2023-05 – L_present");
      expect(html).toMatch(/<p class="ct">a@x\.az \| \+994 50/);
    });
  }
  it("two-column layouts keep main content before the sidebar in the DOM", () => {
    for (const id of ["creative", "two-column", "modern-european"]) {
      const html = render(id);
      expect(html.indexOf('<main class="mn">')).toBeGreaterThan(-1);
      expect(html.indexOf('<main class="mn">')).toBeLessThan(html.indexOf('<aside class="sd">'));
      expect(html).toContain("html:has(.cvb.hb)");
    }
    expect(render("modern-minimal", { columns: "two" })).toContain('<aside class="sd">');
  });
  it("photo follows supportsPhoto, showPhoto and photoShape; unsafe sources never render", () => {
    expect(render("creative", {}, full, "https://example.org/p.png")).toContain('<img class="ph" src="https://example.org/p.png"');
    expect(render("creative", { showPhoto: false }, full, "https://example.org/p.png")).not.toContain("<img");
    expect(render("academic", { showPhoto: true }, full, "https://example.org/p.png")).not.toContain("<img");
    expect(render("creative", { photoShape: "square" }, full, "https://example.org/p.png")).toContain("--pr:0");
    expect(render("creative", {}, full, "javascript:alert(1)")).not.toContain("<img");
  });
  it("design tokens: only validated values reach the CSS", () => {
    const html = render("corporate", { primary: "#123ABC", font: "noto-serif", fontSize: "lg", margins: "wide", spacing: "compact", headingScale: 1.2 });
    expect(html).toContain("--p:#123ABC");
    expect(html).toContain("&#39;CV Noto Serif&#39;");
    expect(html).toContain("--fs:11.5pt");
    expect(html).toContain("margin:25mm");
    expect(html).toContain("--sp:0.75");
    expect(html).toContain("--hs:1.2");
    const bad = render("corporate", { primary: "#000;}</style><script>x</script>", font: "comic", accent: "red" });
    expect(bad).not.toContain("<script>x");
    expect(bad).toContain("--p:#1F3A5F"); // template default
    expect(bad).toContain("&#39;CV Noto Sans&#39;");
  });
  it("embeds @font-face for the chosen family only, with safe sources", () => {
    const html = renderCvBodyHtml(full, { template: "academic", labels, fonts: (f) => `/cv-fonts/${f}` });
    expect(html).toContain('@font-face{font-family:\'CV Noto Serif\';src:url("/cv-fonts/noto-serif-latin-ext-400-normal.woff2")');
    expect(html).not.toContain("inter-latin");
    expect(renderCvBodyHtml(full, { template: "academic", labels, fonts: () => 'x") ; } body{color:red' })).not.toContain("@font-face");
    expect(safeFontSrc("data:font/woff2;base64,AAAA")).toBe("data:font/woff2;base64,AAAA");
    expect(safeFontSrc("javascript:alert(1)")).toBe("");
    expect(safeFontSrc("//evil.com/x.woff2")).toBe("");
  });
  it("modern-european writes ISO dates as MM/YYYY and shows CEFR levels and personal data in the sidebar", () => {
    const html = render("modern-european", {}, CvDataSchema.parse({ ...full, personal: { ...full.personal, nationality: "AZ" } }));
    expect(html).toContain("05/2023");
    expect(html).toContain("L_listening B2 · L_reading C1");
    expect(html).toContain("<b>L_nationality</b>AZ");
  });
  it("every legacy id still renders (europass on its own renderer, the rest via aliases)", () => {
    for (const id of CV_LEGACY_TEMPLATES) {
      const html = render(id);
      expect(html).toContain("Ayşən");
      expect(html).not.toContain("<script>");
      expect(html).toContain(id === "europass" ? "cv-europass" : `cv-${id}`);
      expect(html).toContain("Mentor"); // new sections render on old templates too
    }
    expect(render("does-not-exist")).toContain("t-modern-european");
    expect(renderCvHtml(full, { template: "ats", language: "ru", title: evil, labels })).toMatch(/^<!doctype html><html lang="ru">.*<title>&lt;script&gt;/);
  });
});

describe("design schema", () => {
  it("validates strictly for saving and leniently for rendering", () => {
    expect(CvDesignSchema.safeParse({ primary: "#fff" }).success).toBe(false);
    expect(CvDesignSchema.safeParse({ sectionOrder: ["personal"] }).success).toBe(false);
    expect(CvDesignSchema.safeParse({ headingScale: 3 }).success).toBe(false);
    expect(CvDesignSchema.safeParse({ primary: "#A1B2C3", mode: "ats", hidden: ["references"] }).success).toBe(true);
    expect(parseCvDesign({ primary: "red", accent: "#00FF00", font: "x" })).toEqual({ accent: "#00FF00" });
    expect(parseCvDesign("nope")).toEqual({});
    const d = resolveCvDesign("classic", { sectionOrder: ["hobbies", "hobbies"] });
    expect(d.sectionOrder[0]).toBe("hobbies");
    expect(new Set(d.sectionOrder).size).toBe(d.sectionOrder.length);
  });
});

describe("CV data additions", () => {
  it("normalises legacy string skills to objects and keeps new sections", () => {
    const r = parseCvData({ skills: ["SQL", { name: "Excel", level: 3, kind: "technical" }], volunteer: [{ role: "M" }] });
    expect(r.ok && r.data.skills).toEqual([{ name: "SQL" }, { name: "Excel", level: 3, kind: "technical" }]);
    expect(r.ok && r.data.volunteer[0]!.current).toBe(false);
    expect(parseCvData({ skills: [{ name: "X", level: 6 }] }).ok).toBe(false);
    expect(parseCvData({ experience: [{ employmentType: "slave" }] }).ok).toBe(false);
    expect(parseCvData({ personal: { github: "github.com/a" } })).toMatchObject({ ok: true, data: { personal: { github: "https://github.com/a" } } });
  });
  it("documents the strip behaviour: unknown keys are dropped by this schema (old clients drop keys added later)", () => {
    const r = CvDataSchema.parse({ futureSection: [1], personal: { futureField: "x" } } as unknown);
    expect("futureSection" in r).toBe(false);
  });
  it("keeps brand/link contact labels in natural case (no az uppercasing of LinkedIn/GitHub)", () => {
    const html = render("creative", {});
    expect(html).toContain('<b class="nb">L_linkedin</b>');
    expect(html).not.toContain('<b class="nb">L_email</b>');
  });
});
