import type { PGlite } from "@electric-sql/pglite";
import { cvCompleteness, parseCvData } from "@unimate/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kit, newDb } from "./helpers";

// Journey (e): admin creates organization + opportunity -> student search/track -> CV create + completeness.
let db: PGlite;
let k: ReturnType<typeof kit>;

beforeAll(async () => {
  db = await newDb(false);
  k = kit(db);
}, 120_000);
afterAll(async () => {
  await db.close();
});

describe("career journey", () => {
  it("staff publish, students discover and track, CV completeness is computed", async () => {
    const admin = await k.user({ role: "admin" });
    const student = await k.user();
    const other = await k.user();

    // students cannot create organizations or opportunities
    await k.fails(student, "select public.admin_upsert_organization(null, 'Nope Inc')");
    await k.fails(student, "insert into public.organizations (name) values ('mine')");

    const org = (await k.one(admin, "select public.admin_upsert_organization(null, 'Azərbaycan Texnologiya MMC', 'About us', 'https://example.org', null, true) as id")).id as string;
    const deadline = (await k.one(admin, "select (public.career_today() + 30)::text as d")).d as string;
    const opp = (
      await k.one(admin, "select public.admin_upsert_opportunity(null, $1, 'internship', 'Şəbəkə mühəndisi təcrübəçi', 'Network internship', null, 'Bakı', false, $2, 'https://example.org/apply', $3, $4, 'source: journey') as id", [
        org,
        deadline,
        ["networking"],
        ["az"],
      ])
    ).id as string;

    // draft is invisible to students
    expect(await k.rows(student, "select id from public.opportunities where id = $1", [opp])).toEqual([]);
    expect((await k.one(student, "select public.get_opportunity($1) as j", [opp])).j).toBeNull();
    await k.fails(student, "select public.admin_set_opportunity_status($1, 'published')", [opp]);
    await k.run(admin, "select public.admin_set_opportunity_status($1, 'published')", [opp]);

    // search (az-normalised), filters and tracking
    const search = (u: string, q: string) =>
      k.rows(u, "select * from public.search_opportunities($1, null, null, null, null, null, 'deadline', 20, 0, false)", [q]);
    const hits = await search(student, "sebeke muhendisi");
    expect(hits.map((r) => r.id)).toContain(opp);
    expect(hits.find((r) => r.id === opp)!.tracked_status).toBeNull();
    await k.run(student, "select public.track_opportunity($1, 'saved', 'my note')", [opp]);
    await k.run(student, "select public.track_opportunity($1, 'applied')", [opp]);
    expect((await search(student, "sebeke")).find((r) => r.id === opp)!.tracked_status).toBe("applied");
    expect((await search(other, "sebeke")).find((r) => r.id === opp)!.tracked_status).toBeNull();
    expect(await k.rows(other, "select * from public.my_opportunity_tracking()")).toEqual([]);
    await k.fails(student, "select public.track_opportunity($1, 'hired')", [opp]);

    // expired listings drop out of the default search
    await k.setClock(new Date(Date.now() + 40 * 86400_000).toISOString());
    try {
      expect((await search(student, "sebeke")).map((r) => r.id)).not.toContain(opp);
    } finally {
      await k.clearClock();
    }

    // CV: create as the student, validate with core, compute completeness
    const data = { personal: { fullName: "Test Tələbə", email: "t@example.test", city: "Bakı" }, summary: "x".repeat(120), skills: ["SQL", "TypeScript", "Git", "Linux", "Docker"], education: [{ institution: "BDU" }] };
    const parsed = parseCvData(data);
    expect(parsed.ok).toBe(true);
    const cv = (await k.one(student, "insert into public.cv_documents (user_id, title, language, template, data) values ($1, 'My CV', 'az', 'classic', $2::jsonb) returning id, data", [student, JSON.stringify(data)]));
    const stored = parseCvData(cv.data);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const score = cvCompleteness(stored.data);
    expect(score.score).toBe(15 + 15 + 15 + 20); // personal (3/3), summary, education, skills
    expect(score.missing).toEqual(expect.arrayContaining(["experience", "projects"]));
    // denial: another student sees no CV; cannot insert for someone else
    expect(await k.rows(other, "select id from public.cv_documents where id = $1", [cv.id])).toEqual([]);
    await k.fails(other, "insert into public.cv_documents (user_id, data) values ($1, '{}')", [student]);
    await k.fails(student, "insert into public.cv_documents (user_id, data) values ($1, '{\"hack\": 1}')", [student]);
  }, 60_000);
});
