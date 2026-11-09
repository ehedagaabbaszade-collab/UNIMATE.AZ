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

describe("institutions directory (universities + colleges)", () => {
  it("anon (sign-up screen) can list every institution", async () => {
    const rows = await asAnon(db, async (tx) => (await tx.query("select name, institution_type, source from public.universities")).rows as any[]);
    expect(rows.length).toBeGreaterThanOrEqual(100);
    // 38 colleges come from the official edu.gov.az list; user-supplied extras are tracked separately and flagged unverified.
    expect(rows.filter((r) => r.institution_type === "college" && r.source === "edu.gov.az").length).toBe(38);
    expect(rows.filter((r) => r.source === "user_supplied_unverified").length).toBe(24);
    expect(rows.filter((r) => r.institution_type === "college").length).toBe(52);
  });

  it("includes well-known state and private institutions with exact Azerbaijani spelling", async () => {
    const { rows } = await db.query("select name from public.universities");
    const names = new Set(rows.map((r: any) => r.name));
    for (const n of [
      "Bakı Dövlət Universiteti",
      "Azərbaycan Tibb Universiteti",
      "Azərbaycan Dövlət İqtisad Universiteti",
      "Xəzər Universiteti",
      "ADA Universiteti",
      "Qərbi Kaspi Universiteti",
      "Odlar Yurdu Universiteti",
      "Şirvan Dövlət İqtisadiyyat və Humanitar Kolleci",
    ])
      expect(names.has(n), n).toBe(true);
  });

  it("has no duplicates and invents no faculties", async () => {
    const dup = await db.query("select name from public.universities group by name having count(*) > 1");
    expect(dup.rows).toHaveLength(0);
    const f = await db.query("select count(*)::int as n from public.faculties");
    expect((f.rows[0] as any).n).toBe(0);
  });

  it("every college parent names an institution that exists in the directory", async () => {
    const { rows } = await db.query(
      `select c.name, c.affiliated_with from public.universities c
       where c.affiliated_with is not null and not exists (select 1 from public.universities p where p.name = c.affiliated_with)`,
    );
    expect(rows).toEqual([]);
    const one = await db.query(
      "select affiliated_with from public.universities where name = 'Azərbaycan Maliyyə-İqtisad Kolleci'",
    );
    expect((one.rows[0] as any).affiliated_with).toBe("Azərbaycan Dövlət İqtisad Universiteti");
  });

  it("re-running the migration is idempotent", async () => {
    const sql = (await import("node:fs")).readFileSync(
      new URL("../../../supabase/migrations/20260101003000_institutions_directory.sql", import.meta.url),
      "utf-8",
    );
    const before = (await db.query("select count(*)::int as n from public.universities")).rows[0] as any;
    await db.exec(sql);
    const after = (await db.query("select count(*)::int as n from public.universities")).rows[0] as any;
    expect(after.n).toBe(before.n);
  });
});
