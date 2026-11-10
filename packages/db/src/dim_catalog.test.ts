import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, createTestDb } from "./harness";

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 120_000);
afterAll(async () => {
  await db.close();
});

describe("DİM 2026/2027 college catalog", () => {
  it("imports every extracted college and program with their source pages", async () => {
    const q = async (sql: string) => (await db.query(sql)).rows as any[];
    expect((await q("select count(*)::int n from public.admission_colleges"))[0].n).toBe(55);
    const p = (await q("select count(*)::int n, count(distinct code)::int codes, sum(seats)::int seats, count(*) filter (where state_funded)::int dh, count(*) filter (where special_ability)::int star, min(source_page)::int p0, max(source_page)::int p1, count(*) filter (where needs_verification)::int uncertain from public.college_programs"))[0];
    expect(p).toEqual({ n: 783, codes: 783, seats: 3993, dh: 294, star: 54, p0: 5, p1: 15, uncertain: 0 });
  });

  it("keeps language, format and fee semantics", async () => {
    const rows = (await db.query("select language, study_format, count(*)::int n from public.college_programs group by 1,2 order by 1,2")).rows as any[];
    expect(new Set(rows.map((r) => r.language))).toEqual(new Set(["az", "ru", "az_ru"]));
    expect(new Set(rows.map((r) => r.study_format))).toEqual(new Set(["full_time", "part_time"]));
    const bad = (await db.query("select count(*)::int n from public.college_programs where state_funded <> (tuition_azn is null)")).rows[0] as any;
    expect(bad.n).toBe(0);
  });

  it("preserves official spelling and codes", async () => {
    const { rows } = await db.query("select specialty, college_name from public.college_programs p join public.admission_colleges c on c.id = p.college_id where p.code = '478468'");
    expect(rows[0]).toMatchObject({ specialty: "Kompüter şəbəkəsi avadanlıqlarının təmiri və servisi", college_name: "Bakı Dövlət Rabitə və Nəqliyyat Kolleci" });
  });

  it("feeds the university -> faculty -> major picker: every college has one faculty and vocational majors", async () => {
    const q = async (sql: string) => (await db.query(sql)).rows as any[];
    expect((await q("select count(*)::int n from public.admission_colleges where university_id is null"))[0].n).toBe(0);
    expect((await q("select count(*)::int n from public.faculties f join public.universities u on u.id = f.university_id where u.institution_type = 'college'"))[0].n).toBe(55);
    expect((await q("select count(*)::int n, count(distinct degree_level)::int levels from public.majors"))[0]).toEqual({ n: 479, levels: 1 });
    const m = await q("select m.name from public.majors m join public.faculties f on f.id = m.faculty_id join public.universities u on u.id = f.university_id where u.name = 'Bakı Avrasiya Kolleci' and m.name = 'Vergi işi'");
    expect(m).toHaveLength(1);
    const long = await q("select max(length(name))::int n from public.majors");
    expect(long[0].n).toBeLessThanOrEqual(200);
  });

  it("is readable by anon (sign-up) and read-only for API roles", async () => {
    const n = await asAnon(db, async (tx) => (await tx.query("select count(*)::int n from public.college_programs")).rows[0] as any);
    expect(n.n).toBe(783);
    await expect(asAnon(db, (tx) => tx.query("delete from public.college_programs"))).rejects.toThrow();
    await expect(asAnon(db, (tx) => tx.query("update public.college_programs set seats = 0"))).rejects.toThrow();
  });
});
