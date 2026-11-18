import { describe, expect, it } from "vitest";
import { todayInBaku } from "../career/career";
import { ageOn, checkBirthDate, parseBirthDate } from "./age";

describe("age", () => {
  it("parses and rejects", () => {
    expect(parseBirthDate("2000-02-29")).toEqual({ y: 2000, m: 2, d: 29 });
    for (const s of ["2009-02-30", "2001-02-29", "1899-12-31", "2009-13-01", "2009-1-1", "", "abc", "2009-00-10"])
      expect(parseBirthDate(s)).toBeNull();
  });
  it("16 boundary", () => {
    expect(checkBirthDate("2009-06-16", "2025-06-15")).toBe("underage");
    expect(checkBirthDate("2009-06-15", "2025-06-15")).toBe("ok");
    expect(checkBirthDate("2025-06-16", "2025-06-15")).toBe("future");
    expect(checkBirthDate("nope", "2025-06-15")).toBe("invalid");
  });
  it("Feb 29", () => {
    const b = parseBirthDate("2008-02-29")!;
    expect(ageOn(b, parseBirthDate("2025-02-28")!)).toBe(16);
    expect(ageOn(b, parseBirthDate("2025-03-01")!)).toBe(17);
    expect(ageOn(b, parseBirthDate("2024-02-28")!)).toBe(15);
    expect(ageOn(b, parseBirthDate("2024-02-29")!)).toBe(16);
  });
  it("Baku date", () => {
    expect(todayInBaku(new Date("2025-06-15T21:00:00Z"))).toBe("2025-06-16");
  });
});
