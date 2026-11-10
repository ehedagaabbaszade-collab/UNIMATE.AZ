import { describe, expect, it } from "vitest";
import {
  courseSchema,
  facultySchema,
  fieldErrors,
  formObject,
  grantPlanSchema,
  institutionSchema,
  isHttpsUrl,
  opportunitySchema,
  organizationSchema,
  parseFutureDate,
  promptSchema,
  reasonSchema,
  roleChangeSchema,
  signInSchema,
} from "./schemas";

const U = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-10T10:00:00Z");

describe("reason (matches the 3-500 char database rule)", () => {
  it("trims and bounds", () => {
    expect(reasonSchema.safeParse("ab").success).toBe(false);
    expect(reasonSchema.safeParse("   ab   ").success).toBe(false);
    expect(reasonSchema.safeParse("abc").success).toBe(true);
    expect(reasonSchema.safeParse("x".repeat(500)).success).toBe(true);
    expect(reasonSchema.safeParse("x".repeat(501)).success).toBe(false);
  });
});

describe("grant plan: paid plans REQUIRE a future expiry", () => {
  const schema = grantPlanSchema(NOW);
  it("rejects a missing, malformed or past expiry for plus/pro", () => {
    for (const until of ["", "garbage", "2026-11-10T09:00", "2020-01-01T00:00"]) {
      const r = schema.safeParse({ plan: "pro", until, reason: "support ticket" });
      expect(r.success, until).toBe(false);
      if (!r.success) expect(fieldErrors(r.error).until).toBe("admin.users.untilInvalid");
    }
  });
  it("accepts a future expiry and returns an ISO timestamp", () => {
    const r = schema.parse({ plan: "plus", until: "2026-12-01T12:00", reason: "support ticket" });
    expect(r.plan).toBe("plus");
    expect(new Date(r.until!).getTime()).toBeGreaterThan(NOW.getTime());
  });
  it("free needs no expiry (it ends a manual grant) but still needs a reason", () => {
    expect(schema.parse({ plan: "free", until: "", reason: "ended early" }).until).toBeNull();
    expect(schema.safeParse({ plan: "free", until: "", reason: "" }).success).toBe(false);
  });
  it("rejects unknown plans", () => {
    expect(schema.safeParse({ plan: "enterprise", until: "2027-01-01T00:00", reason: "abc" }).success).toBe(false);
  });
  it("parseFutureDate", () => {
    expect(parseFutureDate("", NOW)).toBeNull();
    expect(parseFutureDate("2026-11-10T10:00:00Z", NOW)).toBeNull();
    expect(parseFutureDate("2026-11-10T10:00:01Z", NOW)).not.toBeNull();
  });
});

describe("role change", () => {
  it("accepts only known roles and needs a reason", () => {
    expect(roleChangeSchema.safeParse({ role: "moderator", reason: "promoted" }).success).toBe(true);
    expect(roleChangeSchema.safeParse({ role: "root", reason: "promoted" }).success).toBe(false);
    expect(roleChangeSchema.safeParse({ role: "admin", reason: "" }).success).toBe(false);
  });
});

describe("https URLs (mirror career_https_url)", () => {
  it("accepts https with a dotted host only", () => {
    expect(isHttpsUrl("https://example.com/apply?x=1")).toBe(true);
    for (const bad of ["http://example.com", "javascript:alert(1)", "https://localhost", "https://user:pw@example.com", "https://exa mple.com", "example.com", "ftp://example.com", ""]) {
      expect(isHttpsUrl(bad), bad).toBe(false);
    }
  });
  it("organization website is optional but validated", () => {
    expect(organizationSchema.parse({ name: "Acme", website: "", verified: false }).website).toBeNull();
    expect(organizationSchema.safeParse({ name: "Acme", website: "http://acme.az", verified: false }).success).toBe(false);
    expect(organizationSchema.safeParse({ name: "", website: "", verified: false }).success).toBe(false);
  });
});

describe("opportunity", () => {
  const base = { organizationId: U, kind: "internship", title: "Intern", applyUrl: "https://acme.az/jobs/1", remote: false, languages: ["az", "en"] };
  it("parses skills, optional deadline and languages", () => {
    const r = opportunitySchema.parse({ ...base, skills: " sql, , python ", deadline: "2027-03-01", description: "" });
    expect(r.skills).toEqual(["sql", "python"]);
    expect(r.deadline).toBe("2027-03-01");
    expect(r.description).toBeNull();
    expect(opportunitySchema.parse({ ...base, deadline: "" }).deadline).toBeNull();
  });
  it("rejects bad kinds, urls, dates and languages", () => {
    expect(opportunitySchema.safeParse({ ...base, kind: "job" }).success).toBe(false);
    expect(opportunitySchema.safeParse({ ...base, applyUrl: "http://acme.az" }).success).toBe(false);
    expect(opportunitySchema.safeParse({ ...base, deadline: "01/03/2027" }).success).toBe(false);
    expect(opportunitySchema.safeParse({ ...base, languages: ["xx"] }).success).toBe(false);
    expect(opportunitySchema.safeParse({ ...base, organizationId: "" }).success).toBe(false);
  });
  it("formObject maps checkboxes and repeated fields", () => {
    const fd = new FormData();
    fd.append("languages", "az");
    fd.append("languages", "tr");
    fd.append("remote", "on");
    fd.append("title", "T");
    expect(formObject(fd, ["remote", "other"], ["languages", "none"])).toEqual({ languages: ["az", "tr"], remote: true, other: false, title: "T", none: [] });
  });
});

describe("academic forms", () => {
  it("institution: type/ownership enums, optional fields become null", () => {
    const r = institutionSchema.parse({ name: "Test Uni", shortName: "", city: " Baku ", type: "college", ownership: "private", affiliated: "", reason: "verified" });
    expect(r).toMatchObject({ shortName: null, city: "Baku", affiliated: null, type: "college" });
    expect(institutionSchema.safeParse({ name: "T", type: "college", ownership: "private", reason: "abc" }).success).toBe(false);
    expect(institutionSchema.safeParse({ name: "Test", type: "zoo", ownership: "private", reason: "abc" }).success).toBe(false);
  });
  it("faculty needs a university id", () => {
    expect(facultySchema.safeParse({ universityId: "", name: "Faculty", reason: "abc" }).success).toBe(false);
    expect(facultySchema.safeParse({ universityId: U, name: "Faculty", reason: "abc" }).success).toBe(true);
  });
  it("course: credits 0-30, comma decimals, major optional", () => {
    const ok = courseSchema.parse({ universityId: U, majorId: "", code: "CS101", title: "Intro", credits: "4,5", reason: "abc" });
    expect(ok.credits).toBe(4.5);
    expect(ok.majorId).toBeNull();
    expect(courseSchema.parse({ universityId: U, majorId: U, code: "C", title: "Intro", credits: "", reason: "abc" }).credits).toBeNull();
    for (const credits of ["31", "-1", "abc"]) {
      expect(courseSchema.safeParse({ universityId: U, majorId: "", code: "C", title: "Intro", credits, reason: "abc" }).success, credits).toBe(false);
    }
  });
});

describe("prompt + sign-in", () => {
  it("prompt name charset, template bounds", () => {
    expect(promptSchema.safeParse({ name: "summary.v2", template: "T", model: "", activate: true, reason: "abc" }).success).toBe(true);
    expect(promptSchema.safeParse({ name: "bad name", template: "T", model: "", activate: false, reason: "abc" }).success).toBe(false);
    expect(promptSchema.safeParse({ name: "ok", template: "   ", model: "", activate: false, reason: "abc" }).success).toBe(false);
    expect(promptSchema.safeParse({ name: "ok", template: "x".repeat(50001), model: "", activate: false, reason: "abc" }).success).toBe(false);
  });
  it("sign-in needs an e-mail and a password; error messages are i18n keys", () => {
    const r = signInSchema.safeParse({ email: "nope", password: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.values(fieldErrors(r.error)).every((k) => k.startsWith("admin."))).toBe(true);
  });
});
