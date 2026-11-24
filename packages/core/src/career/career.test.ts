import { describe, expect, it } from "vitest";
import {
  CV_PRINT_LABEL_KEYS,
  CV_DEFAULT_TEMPLATE,
  CV_TEMPLATES,
  CvDescribeRequestSchema,
  buildCvDescribeData,
  cvMissingRequired,
  CvDataSchema,
  cvTemplateMeta,
  CvPersonalSchema,
  CvFeedbackSchema,
  InterviewRequestSchema,
  InterviewScoreSchema,
  CV_MAX_BYTES,
  cvCompleteness,
  cvToPlainText,
  daysUntil,
  deadlineView,
  emptyCv,
  groupByStatus,
  mapOpportunityRow,
  mapTrackingRow,
  matchSkills,
  normalizeSkill,
  parseCvData,
  renderCvBodyHtml,
  renderCvHtml,
  safeExternalUrl,
  skillGap,
  todayInBaku,
} from "../index";

describe("normalizeSkill", () => {
  it("folds az/tr letters and case like the SQL notes_normalize", () => {
    expect(normalizeSkill("  ŞƏBƏKƏ   Təhlükəsizliyi ")).toBe("sebeke tehlukesizliyi");
    expect(normalizeSkill("İstanbul")).toBe("istanbul");
    expect(normalizeSkill("ISPARTA")).toBe("isparta");
    expect(normalizeSkill("Python")).toBe("python");
  });
});

describe("matchSkills / skillGap", () => {
  it("matches case- and diacritic-insensitively and keeps the listing wording", () => {
    const m = matchSkills(["python", "SQL"], ["Python", "Excel", "sql", "Python"]);
    expect(m.matched).toEqual(["Python", "sql"]);
    expect(m.missing).toEqual(["Excel"]);
    expect(m.ratio).toBeCloseTo(2 / 3);
  });
  it("has no ratio when the listing names no skills", () => {
    expect(matchSkills(["a"], []).ratio).toBeNull();
  });
  it("counts missing skills across listings and orders by count then name", () => {
    const gap = skillGap(["python"], [{ skills: ["Python", "SQL", "Excel"] }, { skills: ["sql", "Figma"] }, { skills: ["Excel", "SQL"] }]);
    expect(gap).toEqual([
      { skill: "SQL", count: 3 },
      { skill: "Excel", count: 2 },
      { skill: "Figma", count: 1 },
    ]);
    expect(skillGap(["x"], [{ skills: ["a", "b"] }], 1)).toHaveLength(1);
    expect(skillGap(["a", "b"], [{ skills: ["a", "b"] }])).toEqual([]);
  });
});

describe("deadlines", () => {
  it("counts calendar days and classifies", () => {
    expect(daysUntil("2026-12-31", "2026-12-24")).toBe(7);
    expect(daysUntil(null, "2026-12-24")).toBeNull();
    expect(deadlineView("2026-12-24", "2026-12-24")).toEqual({ state: "today" });
    expect(deadlineView("2026-12-20", "2026-12-24")).toEqual({ state: "expired", days: 4 });
    expect(deadlineView("2026-12-27", "2026-12-24")).toEqual({ state: "soon", days: 3 });
    expect(deadlineView("2027-02-01", "2026-12-24").state).toBe("later");
    expect(deadlineView(null, "2026-12-24")).toEqual({ state: "none" });
  });
  it("uses Azerbaijan time (UTC+4) for today", () => {
    expect(todayInBaku(new Date("2026-06-01T20:30:00Z"))).toBe("2026-06-02");
    expect(todayInBaku(new Date("2026-06-01T19:30:00Z"))).toBe("2026-06-01");
  });
  it("only allows https external links", () => {
    expect(safeExternalUrl("https://example.org/apply")).toBe("https://example.org/apply");
    expect(safeExternalUrl("http://example.org")).toBeNull();
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});

describe("row mapping", () => {
  it("maps list and tracking rows defensively", () => {
    const o = mapOpportunityRow({ id: "1", organization_id: "o", organization_name: "Org", organization_verified: true, kind: "internship", title: "T", location: null, remote: true, deadline: "2026-01-02", apply_url: "https://x.org", skills: ["a", 3], languages: ["az"], tracked_status: "applied" });
    expect(o).toMatchObject({ organizationVerified: true, skills: ["a"], trackedStatus: "applied", remote: true });
    expect(mapOpportunityRow({ tracked_status: "bogus" }).trackedStatus).toBeNull();
    const t = mapTrackingRow({ id: "t", status: "offer", listing_state: "weird", notes: null });
    expect(t).toMatchObject({ status: "offer", listingState: "removed", notes: "" });
    const g = groupByStatus([t]);
    expect(g.map((c) => c.status)).toEqual(["saved", "applied", "interview", "offer", "rejected"]);
    expect(g[3]!.items).toHaveLength(1);
  });
});

describe("CV schema", () => {
  it("an empty object parses to the full empty structure", () => {
    const cv = emptyCv();
    expect(cv.personal.fullName).toBe("");
    expect(cv.education).toEqual([]);
    expect(Object.keys(cv).sort()).toEqual(["activities", "certificates", "courses", "education", "experience", "hobbies", "honours", "languages", "personal", "projects", "publications", "references", "skills", "summary", "volunteer"]);
  });
  it("rejects non-https links, too many items, over-long text and unknown shapes", () => {
    expect(CvDataSchema.safeParse({ personal: { linkedin: "javascript:alert(1)" } }).success).toBe(false);
    expect(CvDataSchema.safeParse({ personal: { linkedin: "https://linkedin.com/in/a" } }).success).toBe(true);
    expect(CvDataSchema.safeParse({ skills: Array.from({ length: 31 }, (_, i) => `s${i}`) }).success).toBe(false);
    expect(CvDataSchema.safeParse({ summary: "x".repeat(1501) }).success).toBe(false);
    expect(CvDataSchema.safeParse({ experience: [{ bullets: Array(9).fill("x") }] }).success).toBe(false);
    expect(CvDataSchema.safeParse("nope").success).toBe(false);
  });
  it("enforces the byte budget", () => {
    expect(parseCvData({}).ok).toBe(true);
    expect(parseCvData({ skills: [123] })).toEqual({ ok: false, error: "invalid" });
    const big = { education: Array.from({ length: 30 }, () => ({ description: "ж".repeat(600), institution: "ж".repeat(160), degree: "ж".repeat(160), field: "ж".repeat(160) })), experience: Array.from({ length: 30 }, () => ({ bullets: Array(8).fill("ж".repeat(300)) })) };
    expect(CV_MAX_BYTES).toBe(100_000);
    expect(parseCvData(big)).toEqual({ ok: false, error: "too_large" });
  });
});

describe("cvCompleteness", () => {
  it("is 0 for an empty CV and 100 for a full one; weights sum to 100", () => {
    const e = cvCompleteness(emptyCv());
    expect(e.score).toBe(0);
    expect(e.sections.reduce((n, s) => n + s.weight, 0)).toBe(100);
    const full = CvDataSchema.parse({
      personal: { fullName: "A B", email: "a@b.az", phone: "1" },
      summary: "x".repeat(130),
      education: [{ institution: "U" }],
      experience: [{ company: "C", role: "R" }],
      skills: ["a", "b", "c", "d", "e"],
      languages: [{ name: "az" }],
      projects: [{ name: "P" }],
      certificates: [{ name: "C" }],
    });
    const f = cvCompleteness(full);
    expect(f.score).toBe(100);
    expect(f.missing).toEqual([]);
  });
  it("gives partial credit and lists the biggest gaps first", () => {
    const cv = CvDataSchema.parse({ personal: { fullName: "A" }, skills: ["a", "b"], education: [{ institution: "U" }] });
    const c = cvCompleteness(cv);
    expect(c.score).toBe(Math.round(5 + 8 + 15)); // personal 1/3 of 15, skills 2/5 of 20, education 15
    expect(c.missing[0]).toBe("summary"); // biggest remaining gain (15), ties keep section order
    expect(c.missing).not.toContain("education");
  });
});

describe("cvToPlainText", () => {
  it("renders sections and leaves out name, e-mail, phone and links", () => {
    const cv = CvDataSchema.parse({
      personal: { fullName: "Secret Name", email: "secret@x.az", phone: "+994000", headline: "Student", city: "Baku", linkedin: "https://linkedin.com/in/secret" },
      skills: ["SQL"],
      experience: [{ role: "Intern", company: "Acme", bullets: ["Built reports"] }],
    });
    const t = cvToPlainText(cv);
    expect(t).toContain("SKILLS: SQL");
    expect(t).toContain("Built reports");
    for (const secret of ["Secret Name", "secret@x.az", "+994000", "linkedin"]) expect(t).not.toContain(secret);
  });
});

describe("AI contracts", () => {
  it("validates interview requests (discriminated by mode)", () => {
    expect(InterviewRequestSchema.safeParse({ mode: "questions", role: "Data analyst", level: "intern" }).success).toBe(true);
    expect(InterviewRequestSchema.safeParse({ mode: "questions", role: "x", level: "intern" }).success).toBe(false);
    expect(InterviewRequestSchema.safeParse({ mode: "questions", role: "Analyst", level: "ceo" }).success).toBe(false);
    expect(InterviewRequestSchema.safeParse({ mode: "score", role: "Analyst", level: "junior", question: "Tell me about you", answer: "too short" }).success).toBe(false);
    expect(InterviewRequestSchema.safeParse({ mode: "questions", role: "Analyst", level: "junior", outputLanguage: "de" }).success).toBe(false);
  });
  it("validates model output shapes", () => {
    expect(CvFeedbackSchema.safeParse({ overall: "ok", strengths: ["a"], improvements: [{ section: "summary", suggestion: "s" }] }).success).toBe(true);
    expect(CvFeedbackSchema.safeParse({ overall: "ok", strengths: [], improvements: [] }).success).toBe(false);
    expect(CvFeedbackSchema.safeParse({ overall: "ok", strengths: ["a"], improvements: [{ section: "hax", suggestion: "s" }] }).success).toBe(false);
    expect(InterviewScoreSchema.safeParse({ score: 11, improvements: ["x"], improvedAnswer: "y" }).success).toBe(false);
    expect(InterviewScoreSchema.safeParse({ score: 7, improvements: ["x"], improvedAnswer: "y" }).success).toBe(true);
  });
});

describe("CV html export", () => {
  const labels = Object.fromEntries(CV_PRINT_LABEL_KEYS.map((k) => [k, k.charAt(0).toUpperCase() + k.slice(1)])) as Record<(typeof CV_PRINT_LABEL_KEYS)[number], string>;
  it("escapes every user field and only links https URLs", () => {
    const evil = `<script>alert(1)</script>"&'`;
    const cv = CvDataSchema.parse({
      personal: { fullName: evil, headline: evil, email: evil, linkedin: "https://linkedin.com/in/a?x=1&y=\"2" },
      summary: evil,
      experience: [{ role: evil, company: evil, bullets: [evil], current: true }],
      education: [{ institution: evil, degree: evil }],
      skills: [evil],
      projects: [{ name: evil, link: "https://example.org/p", description: evil, tech: [evil] }],
      certificates: [{ name: evil }],
      languages: [{ name: evil, level: evil }],
      honours: [{ title: evil, issuer: evil, description: evil }],
      hobbies: [{ title: evil, description: evil }],
      activities: [{ title: evil, place: evil, description: evil }],
    });
    for (const template of CV_TEMPLATES) {
      const html = renderCvBodyHtml(cv, { template, labels });
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain('href="https://example.org/p"');
      expect(html).toContain(`cv-${template}`);
      expect(html).toContain("Present");
    }
    const doc = renderCvHtml(cv, { template: "classic", language: "az", title: evil, labels });
    expect(doc.startsWith("<!doctype html><html lang=\"az\">")).toBe(true);
    expect(doc).not.toContain("<script>");
  });
  it("omits empty sections", () => {
    const html = renderCvBodyHtml(CvDataSchema.parse({ skills: ["SQL"] }), { template: "classic", labels });
    expect(html).toContain("<h2>Skills</h2>");
    expect(html).not.toContain("Education");
    expect(html).not.toContain("Experience");
  });
});

describe("layout templates", () => {
  const labels = Object.fromEntries(CV_PRINT_LABEL_KEYS.map((k) => [k, k.charAt(0).toUpperCase() + k.slice(1)])) as Record<(typeof CV_PRINT_LABEL_KEYS)[number], string>;
  const evil = "<script>alert(1)</script>";
  const full = {
    personal: { fullName: evil, headline: "Dev", email: "a@x.az", phone: "+994", city: "Baku", socials: [{ platform: "GitHub", value: "https://github.com/a" }] },
    summary: evil,
    experience: [{ role: "Dev", company: "Co", current: true, bullets: ["Did x"] }],
    education: [{ institution: "BDU", degree: "BSc", start: "2020", end: "2024" }],
    skills: ["SQL"],
    languages: [{ name: "Azerbaijani", native: true }, { name: "English", level: "B2" }],
    projects: [{ name: "P", link: "https://example.org/p" }],
    certificates: [{ name: "Excel", issuer: "Coursera" }],
    honours: [{ title: "Award" }],
    hobbies: [{ title: "Chess" }],
    activities: [{ title: "Club" }],
  };
  for (const template of ["sidebar", "headline", "timeline", "elegant", "photocard", "split"] as const) {
    it(`${template}: renders, escapes, and gates the photo`, () => {
      const r = (data: object, assets?: { photoSrc?: string }) => renderCvBodyHtml(CvDataSchema.parse(data), { template, labels, assets });
      expect(() => r({})).not.toThrow();
      expect(r({})).not.toContain("<img");
      const html = r(full);
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("Present");
      expect(html).not.toContain("<img");
      const t = cvTemplateMeta(template);
      const photo = r(full, { photoSrc: "https://example.org/p.png" }).includes('<img class="ph" src="https://example.org/p.png"');
      expect(photo).toBe(t.supportsPhoto && t.defaults.showPhoto); // legacy id renders through its builder alias
      expect(renderCvHtml(CvDataSchema.parse(full), { template, language: "en", title: "t", labels })).toContain(`cv-${template}`);
    });
  }
});

describe("Europass template", () => {
  const labels = Object.fromEntries(CV_PRINT_LABEL_KEYS.map((k) => [k, k.charAt(0).toUpperCase() + k.slice(1)])) as Record<(typeof CV_PRINT_LABEL_KEYS)[number], string>;
  const evil = `<img src=x>"&'`;
  const base = {
    personal: { fullName: "Aysel Mammadova", email: "a@x.az", phone: "+994", socials: [{ platform: "GitHub", value: "https://github.com/a" }, { platform: "Instagram", value: "@aysel" }] },
    experience: [{ role: "Finance Assistant", company: "Asor Group MMC", location: "Baku", start: "01/2025", current: true, bullets: ["Prepared reports"] }],
    languages: [{ name: "Azerbaijani", native: true }, { name: "English", listening: "B2", reading: "B2", spokenProduction: "B1", spokenInteraction: "B1", writing: "B1" }, { name: "German", level: "A2 school" }],
    certificates: [{ name: "Excel", issuer: "Coursera", mode: "Online", description: "Pivot tables" }],
  };
  const render = (data: object, assets?: { logoSrc?: string; photoSrc?: string }) => renderCvBodyHtml(CvDataSchema.parse(data), { template: "europass", labels, assets });

  it("is a legacy template; new CVs start on its builder successor", () => {
    expect(CV_TEMPLATES).not.toContain("europass");
    expect(CV_DEFAULT_TEMPLATE).toBe("modern-european");
  });
  it("renders the photo and logo when given and escapes the src", () => {
    const html = render(base, { photoSrc: "https://x.az/p.png?a=1&b=2", logoSrc: "/brand/full-logo.png" });
    expect(html).toContain('class="eu-photo" src="https://x.az/p.png?a=1&amp;b=2"');
    expect(html).toContain('class="eu-logo" src="/brand/full-logo.png"');
    expect(html).toContain("<b>GitHub:</b>");
    expect(html).toContain("Finance Assistant – Asor Group MMC");
    expect(html).toContain("<td colspan=\"5\">A2 school</td>");
  });
  it("emits no photo element at all without a photo", () => {
    const html = render(base, { logoSrc: "/brand/full-logo.png" });
    expect(html).not.toContain("<img class=\"eu-photo\"");
    expect(html).not.toMatch(/<img[^>]*eu-photo/);
  });
  it("drops javascript:, http: and protocol-relative image sources, accepts data URIs", () => {
    for (const bad of ["javascript:alert(1)", "http://x.az/p.png", "//evil.az/p.png", "data:image/svg+xml;base64,AAAA", "data:text/html;base64,AAAA"]) {
      const html = render(base, { photoSrc: bad, logoSrc: bad });
      expect(html).not.toContain("<img");
    }
    expect(render({ ...base, personal: { ...base.personal, photoUrl: "https://x.az/me.jpg" } })).toContain('src="https://x.az/me.jpg"');
    const signed = render(base, { photoSrc: 'https://x.supabase.co/sign/a.jpg?token="><script>1</script>' });
    expect(signed).not.toContain("<script>");
    expect(render(base, { photoSrc: "data:image/png;base64,iVBORw0KGgo=" })).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });
  it("escapes XSS in every new field", () => {
    const html = render({
      personal: { fullName: "N", idNumber: evil, birthDate: evil, nationality: evil, gender: evil, address: evil, socials: [{ platform: evil, value: evil }] },
      education: [{ institution: evil, degree: evil, city: evil, eqfLevel: evil, field: evil }],
      languages: [{ name: evil, listening: "B1" }, { name: evil, native: true }],
      certificates: [{ name: evil, issuer: evil, mode: evil, description: evil, date: evil }],
      honours: [{ title: evil, issuer: evil, date: evil, description: evil }],
      hobbies: [{ title: evil, description: evil }],
      activities: [{ title: evil, place: evil, date: evil, description: evil }],
    });
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img src=x&gt;");
  });
  it("omits empty sections and shows the new ones", () => {
    expect(render({ personal: { fullName: "N" } })).not.toContain("<section");
    const html = render({ hobbies: [{ title: "Chess" }], honours: [{ title: "Dean's list" }], activities: [{ title: "Volunteer" }] });
    for (const h of ["Hobbies", "Honours", "Activities"]) expect(html).toContain("<h2>" + h + "</h2>");
  });
  it("old templates render the new sections and socials without crashing", () => {
    const cv = CvDataSchema.parse({ ...base, hobbies: [{ title: "Chess" }], honours: [{ title: "Award" }], activities: [{ title: "Club" }] });
    const html = renderCvBodyHtml(cv, { template: "classic", labels });
    expect(html).toContain("Chess");
    expect(html).toContain('href="https://github.com/a"');
  });
});

describe("CV schema additions", () => {
  it("parses old rows that lack every new key", () => {
    const cv = CvDataSchema.parse({ personal: { fullName: "X" }, languages: [{ name: "EN", level: "B2" }], certificates: [{ name: "C" }], education: [{ institution: "U" }] });
    expect(cv.hobbies).toEqual([]);
    expect(cv.personal.socials).toEqual([]);
    expect(cv.languages[0]).toMatchObject({ native: false, listening: "" });
  });
  it("rejects invalid CEFR levels, non-https photos and more than 10 socials", () => {
    expect(CvDataSchema.safeParse({ languages: [{ name: "EN", writing: "D9" }] }).success).toBe(false);
    expect(CvDataSchema.safeParse({ personal: { photoUrl: "http://x.az/p.png" } }).success).toBe(false);
    const uid = "123e4567-e89b-12d3-a456-426614174000";
    const path = (v: string) => CvDataSchema.safeParse({ personal: { photoPath: v } }).success;
    expect(path(`${uid}/a-b_1.jpg`)).toBe(true);
    expect(path("")).toBe(true);
    for (const bad of [`${uid}/../x.jpg`, `${uid}/..`, `../${uid}/x.jpg`, "u1/x.jpg", `${uid}/a/b.jpg`, `${uid}/x.jpg?y`, `/${uid}/x.jpg`]) expect(path(bad)).toBe(false);
    expect(CvDataSchema.safeParse({ personal: { socials: Array.from({ length: 11 }, () => ({ platform: "a", value: "b" })) } }).success).toBe(false);
  });
  it("cvMissingRequired reports empty or blank name, e-mail and phone", () => {
    expect(cvMissingRequired(emptyCv())).toEqual(["fullName", "email", "phone"]);
    expect(cvMissingRequired(CvDataSchema.parse({ personal: { fullName: "A", email: "  ", phone: "1" } }))).toEqual(["email"]);
    expect(cvMissingRequired(CvDataSchema.parse({ personal: { fullName: "A", email: "a@b.c", phone: "1" } }))).toEqual([]);
  });
  it("keeps completeness weights summing to 100", () => {
    expect(cvCompleteness(emptyCv()).sections.reduce((n, x) => n + x.weight, 0)).toBe(100);
  });
  it("never sends identifiers to the AI (plain text) and includes the new sections", () => {
    const cv = CvDataSchema.parse({
      personal: { fullName: "Secret", idNumber: "AZE1234567", birthDate: "01/01/2000", address: "Hidden St 5", photoUrl: "https://x.az/me.jpg", whatsapp: "x", phone: "+994", email: "s@x.az", socials: [{ platform: "Instagram", value: "@secretname" }] },
      honours: [{ title: "Dean's list", issuer: "Khazar" }],
      hobbies: [{ title: "Chess" }],
      activities: [{ title: "Volunteer", place: "Baku" }],
    });
    const text = cvToPlainText(cv);
    expect(text).toContain("Dean's list");
    expect(text).toContain("Chess");
    for (const s of ["AZE1234567", "01/01/2000", "Hidden St", "me.jpg", "+994", "s@x.az", "secretname", "Secret"]) expect(text).not.toContain(s);
  });
});

describe("cv-describe contracts", () => {
  it("validates requests and limits context", () => {
    const ok = { kind: "experience", language: "az", context: { role: "Analyst", company: "Acme" } };
    expect(CvDescribeRequestSchema.safeParse(ok).success).toBe(true);
    expect(CvDescribeRequestSchema.safeParse({ ...ok, kind: "bio" }).success).toBe(false);
    expect(CvDescribeRequestSchema.safeParse({ ...ok, language: "de" }).success).toBe(false);
    expect(CvDescribeRequestSchema.safeParse({ ...ok, context: { role: "x".repeat(201) } }).success).toBe(false);
    expect(CvDescribeRequestSchema.safeParse({ ...ok, context: Object.fromEntries(Array.from({ length: 11 }, (_, i) => ["k" + i, "v"])) }).success).toBe(false);
  });
  it("prompt data holds only allow-listed context and the existing text, no PII", () => {
    const req = CvDescribeRequestSchema.parse({ kind: "experience", language: "en", context: { role: "Analyst", company: "Acme", phone: "+994", email: "a@b.c", idNumber: "AZE1", birthDate: "2000", address: "Baku 5", instagram: "@me" }, current: "Did reports" });
    const d = buildCvDescribeData(req);
    expect(d).toContain("role: Analyst");
    expect(d).toContain("EXISTING TEXT");
    for (const s of ["+994", "a@b.c", "AZE1", "2000", "Baku 5", "@me"]) expect(d).not.toContain(s);
  });
});

describe("CV links and contacts are optional", () => {
  it("accepts a CV with no links, e-mail or phone and normalizes sloppy links", () => {
    const empty = CvDataSchema.parse({ personal: { fullName: "Ayşən Məmmədova" } });
    expect(empty.personal.linkedin).toBe("");
    expect(empty.personal.email).toBe("");
    expect(CvPersonalSchema.parse({ linkedin: "  " }).linkedin).toBe("");
    expect(CvPersonalSchema.parse({ linkedin: "linkedin.com/in/ayshen" }).linkedin).toBe("https://linkedin.com/in/ayshen");
    expect(CvPersonalSchema.parse({ website: "http://example.az" }).website).toBe("https://example.az");
    expect(CvPersonalSchema.safeParse({ website: "javascript:alert(1)" }).success).toBe(false);
  });
});
