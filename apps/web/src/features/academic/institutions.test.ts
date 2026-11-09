import { describe, expect, it } from "vitest";
import type { University } from "@/lib/db";
import { groupInstitutions, institutionLabel } from "./institutions";

const u = (name: string, type: University["institution_type"] = "university", affiliated_with: string | null = null): University => ({
  id: name,
  name,
  short_name: null,
  city: null,
  institution_type: type,
  affiliated_with,
});

describe("groupInstitutions", () => {
  it("separates universities and colleges", () => {
    const g = groupInstitutions([u("Xəzər Universiteti"), u("Bakı Texniki Kolleci", "college"), u("ADA Universiteti")]);
    expect(g.universities.map((x) => x.name)).toEqual(["ADA Universiteti", "Xəzər Universiteti"]);
    expect(g.colleges.map((x) => x.name)).toEqual(["Bakı Texniki Kolleci"]);
  });

  it("sorts in Azerbaijani alphabetical order (ç after c, ə after e, ş after s, ü after u, not after z)", () => {
    const names = ["Zaqatala", "Şəki", "Sumqayıt", "Çinar", "Cəlilabad", "Əhməd", "Ağdam", "Üzeyir"];
    const sorted = groupInstitutions(names.map((n) => u(n))).universities.map((x) => x.name);
    expect(sorted.indexOf("Cəlilabad")).toBeLessThan(sorted.indexOf("Çinar"));
    expect(sorted.indexOf("Sumqayıt")).toBeLessThan(sorted.indexOf("Şəki"));
    expect(sorted.indexOf("Üzeyir")).toBeLessThan(sorted.indexOf("Zaqatala"));
    expect(sorted.indexOf("Əhməd")).toBeLessThan(sorted.indexOf("Zaqatala"));
  });

  it("does not mutate the input", () => {
    const input = [u("B"), u("A")];
    groupInstitutions(input);
    expect(input.map((x) => x.name)).toEqual(["B", "A"]);
  });
});

describe("institutionLabel", () => {
  it("adds the parent for colleges only", () => {
    expect(institutionLabel(u("Humanitar Kollec", "college", "Azərbaycan Dövlət Mədəniyyət və İncəsənət Universiteti"))).toBe(
      "Humanitar Kollec (Azərbaycan Dövlət Mədəniyyət və İncəsənət Universiteti)",
    );
    expect(institutionLabel(u("Bakı Dövlət Universiteti"))).toBe("Bakı Dövlət Universiteti");
    expect(institutionLabel(u("Şəki Dövlət Regional Kolleci", "college"))).toBe("Şəki Dövlət Regional Kolleci");
  });
});
