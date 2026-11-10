import { describe, expect, it } from "vitest";
import {
  CvDataSchema,
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
    expect(Object.keys(cv).sort()).toEqual(["certificates", "education", "experience", "languages", "personal", "projects", "skills", "summary"]);
  });
  it("rejects non-https links, too many items, over-long text and unknown shapes", () => {
    expect(CvDataSchema.safeParse({ personal: { linkedin: "http://x.org" } }).success).toBe(false);
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
    expect(CV_MAX_BYTES).toBe(60_000);
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
  const labels = { personal: "Contact", summary: "Summary", education: "Education", experience: "Experience", skills: "Skills", languages: "Languages", projects: "Projects", certificates: "Certificates", present: "Present" };
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
    });
    for (const template of ["classic", "modern", "compact"] as const) {
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
