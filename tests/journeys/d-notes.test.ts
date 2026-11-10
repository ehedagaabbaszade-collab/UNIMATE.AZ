import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kit, newDb } from "./helpers";

// Journey (d): upload (pending) -> admin approve -> search -> rating -> copyright report auto-hides -> restore blocked by hold.
let db: PGlite;
let k: ReturnType<typeof kit>;
const uni = "a0000000-0000-4000-8000-0000000000e1";
const course = "c0000000-0000-4000-8000-0000000000e1";
const REASON = "journey review ticket";

beforeAll(async () => {
  db = await newDb(false);
  k = kit(db);
  await k.raw("insert into public.universities (id, name) values ($1, 'Journey University')", [uni]);
  await k.raw("insert into public.courses (id, university_id, code, title) values ($1, $2, 'MATH101', 'Analiz I')", [course, uni]);
}, 120_000);
afterAll(async () => {
  await db.close();
});

describe("notes journey", () => {
  it("pending -> approved -> searchable -> rated -> takedown hides -> restore refused while held", async () => {
    const uploader = await k.user({ name: "Uploader", university: uni });
    const reader = await k.user({ name: "Reader", university: uni });
    const outsider = await k.user({ name: "Outsider" });
    const mod = await k.user({ role: "moderator" });

    // upload: object in the private bucket, then create_resource
    const path = `${uploader}/analiz.pdf`;
    await k.raw("insert into storage.objects (bucket_id, name, owner, metadata) values ('resources', $1, $2, $3)", [
      path,
      uploader,
      JSON.stringify({ size: 1000, mimetype: "application/pdf", eTag: '"e1"' }),
    ]);
    const id = (
      await k.one(uploader, "select public.create_resource('Analiz konspekti', 'limit və törəmə', 'note', $1, 'university', $2, $3, 'application/pdf', 1000, 'analiz.pdf') as id", [course, ["analiz", "final"], path])
    ).id as string;
    expect((await k.raw("select status from public.resources where id = $1", [id]))[0]!.status).toBe("pending");
    // denials while pending: invisible to other students, absent from search, cannot be rated
    expect(await k.rows(reader, "select id from public.resources where id = $1", [id])).toEqual([]);
    expect((await k.rows(reader, "select id from public.search_resources('analiz')")).map((r) => r.id)).not.toContain(id);
    await k.fails(reader, "select public.rate_resource($1, 5, 'great')", [id]);
    // students cannot self-publish or approve
    expect((await k.fails(uploader, "update public.resources set status = 'published' where id = $1", [id])).message).toMatch(/only moderators/);
    expect((await k.raw("select status from public.resources where id = $1", [id]))[0]!.status).toBe("pending");
    await k.fails(uploader, "select public.admin_review_content('resource', $1, 'approve', $2)", [id, REASON]);

    // moderator approves -> searchable (az-normalised query), same-university only
    await k.run(mod, "select public.admin_review_content('resource', $1, 'approve', $2)", [id, REASON]);
    expect((await k.rows(reader, "select id from public.search_resources('ANALİZ')")).map((r) => r.id)).toContain(id);
    expect((await k.rows(outsider, "select id from public.search_resources('analiz')")).map((r) => r.id)).not.toContain(id);

    // rating: others only, 1-5, one per user
    await k.run(reader, "select public.rate_resource($1, 4, 'good')", [id]);
    await k.run(reader, "select public.rate_resource($1, 5, 'better')", [id]);
    await k.fails(reader, "select public.rate_resource($1, 6, null)", [id]);
    await k.fails(uploader, "select public.rate_resource($1, 5, null)", [id]);
    const agg = (await k.raw("select avg_rating, rating_count from public.resources where id = $1", [id]))[0]!;
    expect([Number(agg.avg_rating), agg.rating_count]).toEqual([5, 1]);

    // copyright report: auto-hides (pending + hold); uploader cannot report; short text refused
    await k.fails(uploader, "select public.report_copyright($1, 'this is my own work really')", [id]);
    await k.fails(reader, "select public.report_copyright($1, 'short')", [id]);
    const td = (await k.one(reader, "select public.report_copyright($1, 'copied verbatim from my textbook, chapter 3') as t", [id])).t as string;
    expect(await k.raw("select status, takedown_hold from public.resources where id = $1", [id])).toEqual([{ status: "pending", takedown_hold: true }]);
    expect((await k.rows(reader, "select id from public.search_resources('analiz')")).map((r) => r.id)).not.toContain(id);
    await k.fails(mod, "select public.admin_review_content('resource', $1, 'approve', $2)", [id, REASON]); // blocked by the open takedown

    // moderator removes it; restore is refused while the takedown is open and after it is accepted
    await k.run(mod, "select public.admin_moderate_content('resource', $1, 'remove', $2)", [id, REASON]);
    expect((await k.fails(mod, "select public.admin_moderate_content('resource', $1, 'restore', $2)", [id, REASON])).message).toMatch(/copyright takedown/);
    await k.run(mod, "select public.admin_resolve_takedown($1, 'accepted'::public.takedown_status, 'valid claim')", [td]);
    expect((await k.fails(mod, "select public.admin_moderate_content('resource', $1, 'restore', $2)", [id, REASON])).message).toMatch(/copyright takedown/);
    expect((await k.raw("select status from public.resources where id = $1", [id]))[0]!.status).toBe("removed");
    await k.fails(reader, "select public.admin_resolve_takedown($1, 'rejected'::public.takedown_status, 'abc')", [td]); // students cannot resolve
  }, 60_000);
});
