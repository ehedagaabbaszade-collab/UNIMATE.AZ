import { describe, expect, it } from "vitest";
import { EMPTY_PREFS, INTERESTS, STUDENT_CATEGORY_ID, categoryUrl, recommend } from "./bossaz";

describe("Boss.az deep links", () => {
  it("builds exact category URLs", () => {
    expect(categoryUrl([160])).toBe("https://boss.az/search/vacancies?categoryIds=160");
    expect(categoryUrl([108, 110])).toBe("https://boss.az/search/vacancies?categoryIds=108&categoryIds=110");
  });
  it("every interest maps to real category ids", () => {
    for (const i of INTERESTS) expect(i.categoryIds.length > 0 && i.keywords.length > 0 && i.categoryIds.every((n) => Number.isInteger(n) && n > 0), i.id).toBe(true);
  });
});

describe("profile-based recommendations", () => {
  it("ranks a Management student's fields first, from the profile, with reasons", () => {
    const r = recommend({ major: "Menecment", faculty: "Biznes və idarəetmə", skills: ["Excel", "Mühasibat uçotu"] }, EMPTY_PREFS);
    expect(r[0]!.interestId).toBe("management");
    expect(r[0]!.reasons[0]).toEqual({ kind: "major", text: "Menecment" });
    expect(r.map((x) => x.interestId)).toContain("finance");
    expect(r.every((x) => x.url.startsWith("https://boss.az/search/vacancies?categoryIds="))).toBe(true);
  });
  it("a different student gets different recommendations (nothing hardcoded)", () => {
    const med = recommend({ major: "Müalicə işi (tibb bacısı)", skills: [] }, EMPTY_PREFS);
    expect(med[0]!.interestId).toBe("medicine");
    expect(med.map((x) => x.interestId)).not.toContain("management");
  });
  it("explicit interests rank above skills", () => {
    const r = recommend({ skills: ["Photoshop"] }, { interests: ["logistics"] });
    expect(r[0]).toMatchObject({ interestId: "logistics", matched: true });
    expect(r[0]!.reasons).toContainEqual({ kind: "interest", interestId: "logistics" });
  });
  it("a student with no profile data still gets Boss.az's student category", () => {
    const r = recommend({ skills: [] }, EMPTY_PREFS);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ interestId: null, matched: false, url: categoryUrl([STUDENT_CATEGORY_ID]) });
  });
  it("matches without special letters", () => {
    expect(recommend({ major: "IDARECILIK", skills: [] }, EMPTY_PREFS)[0]!.interestId).toBe("management");
  });
});
