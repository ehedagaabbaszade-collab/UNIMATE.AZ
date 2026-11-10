import { describe, expect, it } from "vitest";
import { EMPTY_PREFS, INTERESTS, recommend, searchUrl } from "./workaz";

describe("Work.az deep links", () => {
  it("builds the exact search URL with encoded Azerbaijani text", () => {
    expect(searchUrl("mühasib")).toBe("https://www.work.az/vakansiyalar?search=m%C3%BChasib");
    expect(searchUrl("  part time ")).toBe("https://www.work.az/vakansiyalar?search=part%20time");
  });
  it("every interest has a primary search term and keywords", () => {
    for (const i of INTERESTS) expect(i.terms.length && i.keywords.length, i.id).toBeTruthy();
  });
});

describe("profile-based recommendations", () => {
  it("ranks a Management student's fields first, from the profile, with reasons", () => {
    const r = recommend({ major: "Menecment", faculty: "Biznes və idarəetmə", skills: ["Excel", "Mühasibat uçotu"] }, EMPTY_PREFS);
    expect(r[0]!.interestId).toBe("management");
    expect(r[0]!.reasons[0]).toEqual({ kind: "major", text: "Menecment" });
    expect(r.map((x) => x.interestId)).toContain("finance"); // from the "Mühasibat uçotu" skill
    expect(r.every((x) => x.url.startsWith("https://www.work.az/vakansiyalar?search="))).toBe(true);
  });

  it("a different student gets different recommendations (nothing hardcoded)", () => {
    const med = recommend({ major: "Müalicə işi (tibb bacısı)", skills: [] }, EMPTY_PREFS);
    expect(med[0]!.interestId).toBe("medicine");
    expect(med.map((x) => x.interestId)).not.toContain("management");
  });

  it("explicit interests and employment types are honoured and ranked above skills", () => {
    const r = recommend({ skills: ["Photoshop"] }, { interests: ["logistics"], kinds: ["remote"] });
    expect(r[0]).toMatchObject({ interestId: "logistics", matched: true });
    expect(r[0]!.reasons).toContainEqual({ kind: "interest", interestId: "logistics" });
    expect(r.find((x) => x.kind === "remote")).toMatchObject({ matched: true, reasons: [{ kind: "type", type: "remote" }] });
  });

  it("students with no profile data still get entry-level internship and part-time searches", () => {
    const r = recommend({ skills: [] }, EMPTY_PREFS);
    expect(r.map((x) => x.kind)).toEqual(["part_time", "internship"]);
    expect(r.every((x) => !x.matched && x.reasons[0]!.kind === "entry")).toBe(true);
  });

  it("matches without special letters (ə, ı, ş typed as e, i, s)", () => {
    expect(recommend({ major: "IDARECILIK", skills: [] }, EMPTY_PREFS)[0]!.interestId).toBe("management");
  });
});
