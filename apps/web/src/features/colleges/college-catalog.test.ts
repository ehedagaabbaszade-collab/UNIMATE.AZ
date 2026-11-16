import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NO_FILTERS, collegeLabel, filterPrograms, fold, summarizeColleges, type CollegeRow, type ProgramRow } from "./college-catalog";

const colleges: CollegeRow[] = [
  { id: "c1", heading: "Bakı Avrasiya Kolleci", parent_institution: null, college_name: "Bakı Avrasiya Kolleci" },
  { id: "c2", heading: "Azərbaycan Dövlət Pedaqoji Universiteti nəzdində Azərbaycan Dövlət Pedaqoji Kolleci", parent_institution: "Azərbaycan Dövlət Pedaqoji Universiteti", college_name: "Azərbaycan Dövlət Pedaqoji Kolleci" },
];
const map = new Map(colleges.map((c) => [c.id, c]));
const p = (o: Partial<ProgramRow>): ProgramRow => ({ id: o.code ?? "x", college_id: "c1", code: "496522", specialty: "Bank işi", division: "Azərbaycan bölməsi", language: "az", study_format: "full_time", seats: 12, tuition_azn: 1500, state_funded: false, special_ability: false, source_page: 15, needs_verification: false, ...o });
const programs = [p({ code: "496522" }), p({ code: "496539", specialty: "Maliyyə işi", language: "ru", state_funded: true, tuition_azn: null }), p({ code: "477001", college_id: "c2", specialty: "İbtidai təhsilin pedaqogikası", study_format: "part_time", seats: 3 })];

describe("college catalog helpers", () => {
  it("searches by specialty name (diacritics-insensitive) and by admission code", () => {
    expect(filterPrograms(programs, map, { ...NO_FILTERS, query: "maliyye" }).map((x) => x.code)).toEqual(["496539"]);
    expect(filterPrograms(programs, map, { ...NO_FILTERS, query: "IBTIDAI" }).map((x) => x.code)).toEqual(["477001"]);
    expect(filterPrograms(programs, map, { ...NO_FILTERS, query: "496522" }).map((x) => x.code)).toEqual(["496522"]);
    expect(filterPrograms(programs, map, { ...NO_FILTERS, query: "pedaqoji" }).map((x) => x.code)).toEqual(["477001"]);
  });
  it("filters by language, format, funding and college", () => {
    expect(filterPrograms(programs, map, { ...NO_FILTERS, language: "ru" })).toHaveLength(1);
    expect(filterPrograms(programs, map, { ...NO_FILTERS, format: "part_time" })).toHaveLength(1);
    expect(filterPrograms(programs, map, { ...NO_FILTERS, funding: "state" }).map((x) => x.code)).toEqual(["496539"]);
    expect(filterPrograms(programs, map, { ...NO_FILTERS, funding: "paid" })).toHaveLength(2);
    expect(filterPrograms(programs, map, { ...NO_FILTERS, collegeId: "c2" })).toHaveLength(1);
  });
  it("summarizes colleges and labels parents", () => {
    const s = summarizeColleges(colleges, programs);
    expect(s.find((c) => c.id === "c1")).toMatchObject({ programs: 2, seats: 24 });
    expect(summarizeColleges(colleges, [programs[0]!])).toHaveLength(1);
    expect(collegeLabel(colleges[1]!)).toContain("(Azərbaycan Dövlət Pedaqoji Universiteti)");
    expect(fold("İqtisadiyyat")).toBe(fold("iqtisadiyyat"));
  });
});

describe("extracted DİM data file", () => {
  const data = JSON.parse(readFileSync(new URL("../../../../../data/dim2026/colleges.json", import.meta.url), "utf8")) as { records: Array<{ code: string; specialty: string; institution: string; form: string; seats: number; flags: string[] }> };
  it("has complete, unique, validated records", () => {
    const r = data.records;
    expect(r).toHaveLength(783);
    expect(new Set(r.map((x) => x.code)).size).toBe(783);
    expect(new Set(r.map((x) => x.institution)).size).toBe(55);
    expect(r.every((x) => x.institution && x.specialty && /^\d{6}$/.test(x.code) && ["Ə", "Q"].includes(x.form) && x.seats >= 0 && x.flags.length === 0)).toBe(true);
    expect(r.reduce((n, x) => n + x.seats, 0)).toBe(3993);
  });
});
