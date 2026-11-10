import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb } from "./harness";

// Migration 20260101004200 (UNIMATE NOTES). All client-side checks run as `authenticated` with auth.uid() set; every
// negative result has a positive control.

let db: PGlite;
const uni = "a0000000-0000-4000-8000-000000000001";
const uni2 = "a0000000-0000-4000-8000-000000000002";
const course = "c0000000-0000-4000-8000-000000000001";
const course2 = "c0000000-0000-4000-8000-000000000002";
const U = (k: number) => `00000000-0000-4000-8000-00000000f${String(k).padStart(3, "0")}`;
const [UP, ST, OTHER_UNI, MOD, BLOCKED] = [U(1), U(2), U(3), U(4), U(5)];

const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params));
const rows = async (uid: string, sql: string, params: unknown[] = []) => (await run(uid, sql, params)).rows;
const fails = async (uid: string, sql: string, params: unknown[] = []) => {
  let err: Error | null = null;
  try {
    await run(uid, sql, params);
  } catch (e) {
    err = e as Error;
  }
  expect(err, `expected failure: ${sql}`).not.toBeNull();
  return err!.message;
};

let fileN = 0;
const PDF = "application/pdf";
const upload = async (owner: string) => {
  const path = `${owner}/file${++fileN}.pdf`;
  await raw("insert into storage.objects (bucket_id, name, owner) values ('resources', $1, $2)", [path, owner]);
  return path;
};
const create = async (owner: string, o: { title?: string; course?: string | null; vis?: string; tags?: string[]; desc?: string } = {}) => {
  const path = await upload(owner);
  const r = await rows(owner, "select public.create_resource($1, $2, 'note', $3, $4::public.resource_visibility, $5, $6, $7, 1000, 'f.pdf') as id", [
    o.title ?? "Calculus notes", o.desc ?? null, o.course === undefined ? course : o.course, o.vis ?? "university", o.tags ?? [], path, PDF,
  ]);
  return r[0]!.id as string;
};
const publish = (id: string) => rows(MOD, "select public.admin_review_content('resource', $1, 'approve', 'looks fine') as ok", [id]);

beforeAll(async () => {
  db = await createTestDb({ seed: false });
  for (const [i, u] of [UP, ST, OTHER_UNI, MOD, BLOCKED].entries())
    await raw("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [u, `n${i}@example.test`, JSON.stringify({ display_name: `User${i}` })]);
  await raw("insert into public.universities (id, name) values ($1, 'Test University One'), ($2, 'Test University Two')", [uni, uni2]);
  await raw("insert into public.courses (id, university_id, code, title) values ($1, $3, 'MATH101', 'Analiz I'), ($2, $4, 'X1', 'Other')", [course, course2, uni, uni2]);
  await raw("update public.profiles set university_id = $2 where id = any($1::uuid[])", [[UP, ST, MOD, BLOCKED], uni]);
  await raw("update public.profiles set university_id = $1 where id = $2", [uni2, OTHER_UNI]);
  await raw("update public.profiles set role = 'moderator' where id = $1", [MOD]);
}, 120_000);
afterAll(async () => {
  await db.close();
});

describe("notes_normalize", () => {
  it("folds az/tr letters and case", async () => {
    const r = await raw("select public.notes_normalize('  ANALİZ  Riyaziyyat  ƏDƏBİYYAT şəhər Işıq ÇĞÖÜ ёлка ') as n");
    expect(r[0]!.n).toBe("analiz riyaziyyat edebiyyat sehər isiq cgou елка".replace("sehər", "seher"));
  });
});

describe("storage bucket", () => {
  it("is private with limits aligned to validateUpload; owner-folder writes only; no client read policy", async () => {
    const b = (await raw("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'resources'"))[0]!;
    expect(b.public).toBe(false);
    expect(Number(b.file_size_limit)).toBe(50 * 1024 * 1024);
    expect(b.allowed_mime_types).toEqual(expect.arrayContaining(["application/pdf", "image/png", "image/jpeg"]));
    expect(b.allowed_mime_types).not.toContain("text/html");
    // positive control: own folder insert works
    await run(UP, "insert into storage.objects (bucket_id, name, owner) values ('resources', $1, $2)", [`${UP}/own.pdf`, UP]);
    // other folder denied
    await fails(UP, "insert into storage.objects (bucket_id, name, owner) values ('resources', $1, $2)", [`${ST}/x.pdf`, UP]);
    // nobody (not even the owner) can read through the API: signed URLs only
    expect((await rows(UP, "select * from storage.objects where bucket_id = 'resources'")).length).toBe(0);
    expect((await raw("select * from storage.objects where bucket_id = 'resources' and name = $1", [`${UP}/own.pdf`])).length).toBe(1);
    const pol = await raw("select cmd from pg_policies where schemaname = 'storage' and policyname like 'resources_bucket_%'");
    expect(pol.map((p) => p.cmd).sort()).toEqual(["DELETE", "INSERT", "UPDATE"]);
  });
});

describe("upload flow and visibility", () => {
  it("creates a pending resource, derives university from the course, visible only to the uploader and moderators", async () => {
    const id = await create(UP, { title: "Calculus notes", tags: ["Final", "final", "  Math "] });
    const r = (await raw("select status, university_id, tags, visibility from public.resources where id = $1", [id]))[0]!;
    expect(r.status).toBe("pending");
    expect(r.university_id).toBe(uni);
    expect(r.tags).toEqual(["final", "math"]);
    expect((await rows(UP, "select id from public.resources where id = $1", [id])).length).toBe(1); // control
    expect((await rows(MOD, "select id from public.resources where id = $1", [id])).length).toBe(1);
    expect((await rows(ST, "select id from public.resources where id = $1", [id])).length).toBe(0);
    expect((await rows(ST, "select id from public.search_resources(null)")).some((x) => x.id === id)).toBe(false);
  });

  it("validates input: type, size, path, missing object, course, tags, anonymous", async () => {
    const path = await upload(UP);
    const call = (over: Record<string, unknown> = {}) => {
      const a = { title: "t", course: course, vis: "university", tags: [], path, mime: PDF, size: 1000, ...over };
      return run(UP, "select public.create_resource($1, null, 'note', $2, $3::public.resource_visibility, $4, $5, $6, $7, 'f') as id", [a.title, a.course, a.vis, a.tags, a.path, a.mime, a.size]);
    };
    await expect(call({ mime: "text/html" })).rejects.toThrow(/unsupported/);
    await expect(call({ mime: "image/png", size: 11 * 1024 * 1024 })).rejects.toThrow(/size/);
    await expect(call({ size: 0 })).rejects.toThrow(/size/);
    await expect(call({ path: `${ST}/a.pdf` })).rejects.toThrow(/storage path/);
    await expect(call({ path: `${UP}/../x.pdf` })).rejects.toThrow(/storage path/);
    await expect(call({ path: `${UP}/not-uploaded.pdf` })).rejects.toThrow(/not been uploaded/);
    await expect(call({ course: "c0000000-0000-4000-8000-0000000000ff" })).rejects.toThrow(/course/);
    await expect(call({ tags: ["1", "2", "3", "4", "5", "6", "7", "8", "9"] })).rejects.toThrow(/tags/);
    await expect(call({ title: "  " })).rejects.toThrow(/title/);
    expect((await call()).rows[0]!.id).toBeTruthy(); // control
    await expect(asUser(db, null, (tx) => tx.query("select public.create_resource('t', null, 'note', null, 'public', '{}', 'x', 'application/pdf', 1, 'f')"))).rejects.toThrow();
  });

  it("clients cannot self-publish, forge aggregates, or set the takedown hold", async () => {
    const id = await create(UP);
    await fails(UP, "update public.resources set status = 'published' where id = $1", [id]);
    await run(UP, "update public.resources set avg_rating = 5, rating_count = 99, save_count = 9, takedown_hold = true where id = $1", [id]);
    const r = (await raw("select avg_rating, rating_count, save_count, takedown_hold from public.resources where id = $1", [id]))[0]!;
    expect([Number(r.avg_rating), r.rating_count, r.save_count, r.takedown_hold]).toEqual([0, 0, 0, false]);
    expect((await rows(ST, "select count(*)::int c from public.resources where id = $1", [id]))[0]!.c).toBe(0);
  });

  it("moderator approval publishes; scope rules: same university and public visibility; other university excluded", async () => {
    const uniRes = await create(UP, { title: "Uni only", vis: "university" });
    const pubRes = await create(UP, { title: "Public one", vis: "public" });
    expect((await publish(uniRes))[0]!.ok).toBe(true);
    await publish(pubRes);
    await fails(ST, "select public.admin_review_content('resource', $1, 'approve', 'abc')", [uniRes]); // students cannot
    expect((await rows(ST, "select id from public.resources where id = $1", [uniRes])).length).toBe(1);
    expect((await rows(OTHER_UNI, "select id from public.resources where id = $1", [uniRes])).length).toBe(0);
    expect((await rows(OTHER_UNI, "select id from public.resources where id = $1", [pubRes])).length).toBe(1);
    expect((await publish(uniRes))[0]!.ok).toBe(false); // already published: no-op
  });

  it("editing a published resource sends it back to review", async () => {
    const id = await create(UP, { title: "Edit me" });
    await publish(id);
    await run(UP, "update public.resources set title = 'Edited' where id = $1", [id]);
    expect((await raw("select status from public.resources where id = $1", [id]))[0]!.status).toBe("pending");
    expect((await rows(ST, "select id from public.resources where id = $1", [id])).length).toBe(0);
  });
});

describe("search_resources", () => {
  let a: string, b: string, c: string;
  beforeAll(async () => {
    a = await create(UP, { title: "ANALİZ konspekt", tags: ["final"], desc: "Limit və törəmə" });
    b = await create(UP, { title: "Physics slides", course: null, vis: "public" });
    c = await create(BLOCKED, { title: "Analiz blocked author" });
    for (const x of [a, b, c]) await publish(x);
    await raw("update public.resources set kind = 'past_exam' where id = $1", [b]);
    await raw("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [ST, BLOCKED]);
  });
  const ids = async (uid: string, sql: string, params: unknown[] = []) => (await rows(uid, sql, params)).map((r) => r.id as string);

  it("is accent/case-insensitive for az/tr letters, AND over tokens, filters, and hides blocked authors", async () => {
    const hit = (uid: string, q: string) => ids(uid, "select id from public.search_resources($1)", [q]);
    expect(await hit(ST, "analiz")).toContain(a);
    expect(await hit(ST, "analiz")).not.toContain(c); // blocked author hidden
    expect(await hit(UP, "analiz")).toContain(c); // positive control: no block for UP
    expect(await hit(ST, "ANALİZ final")).toEqual([a]);
    expect(await hit(ST, "toreme limit")).toEqual([a]); // ə/ö folded in description
    expect(await hit(ST, "analiz konspekt")).toEqual([a]);
    expect(await hit(ST, "analiz zzz")).toEqual([]);
    expect(await hit(ST, "math101")).toContain(a); // course code is searchable
    expect(await ids(ST, "select id from public.search_resources(null, null, null, 'past_exam')")).toEqual([b]);
    expect(await ids(ST, "select id from public.search_resources(null, null, $1)", [course])).toContain(a);
    expect(await ids(ST, "select id from public.search_resources(null, null, $1)", [course])).not.toContain(b);
    expect(await ids(ST, "select id from public.search_resources(p_uploader => $1)", [UP])).toContain(a);
    expect(await ids(ST, "select id from public.search_resources(p_uploader => $1)", [BLOCKED])).toEqual([]);
  });

  it("treats wildcards and quotes literally, bounds the page size, rejects bad sorts and anonymous callers", async () => {
    expect(await ids(ST, "select id from public.search_resources('%')")).toEqual([]);
    expect(await ids(ST, "select id from public.search_resources('_')")).toEqual([]);
    expect(await ids(ST, "select id from public.search_resources($1)", ["'; drop table x; --"])).toEqual([]);
    expect((await rows(ST, "select id from public.search_resources(null, null, null, null, 'newest', 1)")).length).toBe(1);
    await fails(ST, "select * from public.search_resources(null, null, null, null, 'bogus')");
    await expect(asUser(db, null, (tx) => tx.query("select * from public.search_resources(null)"))).rejects.toThrow();
  });

  it("sorts by rating and saves", async () => {
    await run(ST, "select public.rate_resource($1, 5, 'great')", [b]);
    await run(OTHER_UNI, "select public.rate_resource($1, 2, null)", [b]);
    await run(ST, "select public.rate_resource($1, 4, null)", [a]);
    expect((await ids(ST, "select id from public.search_resources(null, null, null, null, 'rating')"))[0]).toBe(a);
    await run(ST, "insert into public.resource_saves (resource_id, user_id) values ($1, $2)", [b, ST]);
    expect((await ids(ST, "select id from public.search_resources(null, null, null, null, 'saves')"))[0]).toBe(b);
    const saved = await rows(ST, "select id, saved from public.search_resources(null) where id = $1", [b]);
    expect(saved[0]!.saved).toBe(true);
  });
});

describe("ratings and saves", () => {
  it("one per user, uploader cannot rate own, aggregates maintained, pending cannot be rated", async () => {
    const id = await create(UP, { title: "Rate me" });
    await expect(run(ST, "select public.rate_resource($1, 5, null)", [id])).rejects.toThrow(/not found/); // pending: invisible
    await publish(id);
    await expect(run(UP, "select public.rate_resource($1, 5, null)", [id])).rejects.toThrow(/own/);
    await fails(UP, "insert into public.resource_ratings (resource_id, user_id, rating) values ($1, $2, 5)", [id, UP]); // direct insert too
    await run(ST, "select public.rate_resource($1, 4, 'good notes')", [id]);
    await run(MOD, "select public.rate_resource($1, 2, null)", [id]);
    let r = (await raw("select avg_rating, rating_count from public.resources where id = $1", [id]))[0]!;
    expect([Number(r.avg_rating), r.rating_count]).toEqual([3, 2]);
    await run(ST, "select public.rate_resource($1, 5, 'better')", [id]); // update, not a second row
    r = (await raw("select avg_rating, rating_count from public.resources where id = $1", [id]))[0]!;
    expect([Number(r.avg_rating), r.rating_count]).toEqual([3.5, 2]);
    await expect(run(ST, "select public.rate_resource($1, 6, null)", [id])).rejects.toThrow(/1-5/);
    await run(ST, "delete from public.resource_ratings where resource_id = $1 and user_id = $2", [id, ST]);
    r = (await raw("select avg_rating, rating_count from public.resources where id = $1", [id]))[0]!;
    expect([Number(r.avg_rating), r.rating_count]).toEqual([2, 1]);
    // reviews list: no private data, mine first
    await run(ST, "select public.rate_resource($1, 5, 'again')", [id]);
    const rev = await rows(ST, "select * from public.list_resource_reviews($1)", [id]);
    expect(rev.length).toBe(2);
    expect(rev[0]!.is_mine).toBe(true);
    expect(Object.keys(rev[0]!).sort()).toEqual(["comment", "created_at", "display_name", "is_mine", "rating", "user_id"]);
    expect((await rows(OTHER_UNI, "select * from public.list_resource_reviews($1)", [id])).length).toBe(0); // not visible there? uni-scoped
  });

  it("saves are per-user, counted, and only for visible resources", async () => {
    const id = await create(UP, { title: "Save me" });
    await fails(ST, "insert into public.resource_saves (resource_id, user_id) values ($1, $2)", [id, ST]); // pending: not visible
    await publish(id);
    await run(ST, "insert into public.resource_saves (resource_id, user_id) values ($1, $2)", [id, ST]);
    await fails(ST, "insert into public.resource_saves (resource_id, user_id) values ($1, $2)", [id, MOD]); // for someone else
    expect((await raw("select save_count from public.resources where id = $1", [id]))[0]!.save_count).toBe(1);
    await run(ST, "delete from public.resource_saves where resource_id = $1", [id]);
    expect((await raw("select save_count from public.resources where id = $1", [id]))[0]!.save_count).toBe(0);
  });
});

describe("copyright takedown", () => {
  it("report hides pending review; rejection republishes; acceptance removes; idempotent; uploader cannot report", async () => {
    const id = await create(UP, { title: "Disputed" });
    await publish(id);
    await expect(run(UP, "select public.report_copyright($1, 'this is mine really')", [id])).rejects.toThrow(/own/);
    expect((await raw("select status from public.resources where id = $1", [id]))[0]!.status).toBe("published"); // control: still up
    await expect(run(ST, "select public.report_copyright($1, 'short')", [id])).rejects.toThrow(/10-4000/);
    const t1 = (await rows(ST, "select public.report_copyright($1, 'copied from my textbook, chapter 3') as t", [id]))[0]!.t as string;
    const t2 = (await rows(ST, "select public.report_copyright($1, 'copied from my textbook, chapter 3') as t", [id]))[0]!.t as string;
    expect(t2).toBe(t1);
    let r = (await raw("select status, takedown_hold from public.resources where id = $1", [id]))[0]!;
    expect([r.status, r.takedown_hold]).toEqual(["pending", true]);
    expect((await rows(MOD, "select id from public.resources where id = $1", [id])).length).toBe(1);
    expect((await rows(OTHER_UNI, "select id from public.search_resources(null)")).some((x) => x.id === id)).toBe(false);
    // cannot be approved through the generic path while the takedown is open
    await expect(run(MOD, "select public.admin_review_content('resource', $1, 'approve', 'try')", [id])).rejects.toThrow(/takedown/);
    await run(MOD, "select public.admin_resolve_takedown($1, 'rejected', 'not infringing')", [t1]);
    r = (await raw("select status, takedown_hold from public.resources where id = $1", [id]))[0]!;
    expect([r.status, r.takedown_hold]).toEqual(["published", false]);

    const t3 = (await rows(ST, "select public.report_copyright($1, 'second, better evidence attached') as t", [id]))[0]!.t as string;
    expect((await raw("select status from public.resources where id = $1", [id]))[0]!.status).toBe("pending");
    await run(MOD, "select public.admin_resolve_takedown($1, 'accepted', 'valid claim')", [t3]);
    r = (await raw("select status, takedown_hold from public.resources where id = $1", [id]))[0]!;
    expect([r.status, r.takedown_hold]).toEqual(["removed", false]);
    await expect(run(ST, "select public.admin_resolve_takedown($1, 'accepted', 'abc')", [t3])).rejects.toThrow(/moderator/);
  });

  it("an invisible resource cannot be reported (no existence oracle) and the user's own pending upload stays theirs", async () => {
    const id = await create(UP, { title: "Hidden" });
    await expect(run(ST, "select public.report_copyright($1, 'looks like my own notes')", [id])).rejects.toThrow(/not found/);
    const own = (await rows(UP, "select status, takedown_hold from public.resources where id = $1", [id]))[0]!;
    expect(own.status).toBe("pending");
  });
});

describe("contributor profile", () => {
  it("exposes only public aggregates and honours blocks", async () => {
    const p = (await rows(ST, "select public.get_contributor_profile($1) as p", [UP]))[0]!.p as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(["avg_rating", "display_name", "rating_count", "resource_count", "total_saves", "university_name", "user_id"]);
    expect(p.display_name).toBe("User0");
    expect(Number(p.resource_count)).toBeGreaterThan(0);
    expect(JSON.stringify(p)).not.toContain("example.test");
    expect((await rows(ST, "select public.get_contributor_profile($1) as p", [BLOCKED]))[0]!.p).toBeNull(); // ST blocked BLOCKED
    expect((await rows(UP, "select public.get_contributor_profile($1) as p", [BLOCKED]))[0]!.p).not.toBeNull(); // control
    expect((await rows(ST, "select public.get_contributor_profile('00000000-0000-4000-8000-0000000fffff') as p"))[0]!.p).toBeNull();
  });
});

describe("shared quizzes", () => {
  let quiz: string, qids: string[];
  const mk = async () => {
    quiz = (await raw("insert into public.quizzes (user_id, title, server_generated, course_id) values ($1, 'My quiz', true, $2) returning id", [UP, course]))[0]!.id;
    qids = [];
    for (const [i, [kind, opts, ans]] of [["mcq", '["a","b","c"]', "b"], ["true_false", null, "true"]].entries())
      qids.push((await raw("insert into public.questions (quiz_id, position, kind, prompt, options, answer, explanation) values ($1, $2, $3::public.question_kind, $4, $5::jsonb, $6, 'SECRET-EXPL') returning id", [quiz, i, kind, `p${i}`, opts, ans]))[0]!.id);
  };
  it("share -> moderation -> import copy; key never exposed; graded server-side; no XP; cannot re-share", async () => {
    await mk();
    await expect(run(ST, "select public.share_quiz($1)", [quiz])).rejects.toThrow(/not found/); // not the owner
    const sid = (await rows(UP, "select public.share_quiz($1) as id", [quiz]))[0]!.id as string;
    expect((await rows(UP, "select public.share_quiz($1) as id", [quiz]))[0]!.id).toBe(sid); // idempotent
    expect((await rows(ST, "select id from public.shared_quizzes where id = $1", [sid])).length).toBe(0); // pending
    await expect(run(ST, "select public.import_shared_quiz($1)", [sid])).rejects.toThrow(/not found/);
    expect((await rows(MOD, "select public.admin_review_content('shared_quiz', $1, 'approve', 'looks ok') as ok", [sid]))[0]!.ok).toBe(true);
    expect((await rows(ST, "select id from public.shared_quizzes where id = $1", [sid])).length).toBe(1);
    expect((await rows(OTHER_UNI, "select id from public.shared_quizzes where id = $1", [sid])).length).toBe(0);

    // non-owners see prompts/options only; the key table is unreachable
    const sq = await rows(ST, "select * from public.shared_quiz_questions where shared_quiz_id = $1 order by position", [sid]);
    expect(sq.length).toBe(2);
    expect(JSON.stringify(sq)).not.toContain("SECRET-EXPL");
    expect(Object.keys(sq[0]!)).not.toContain("answer");
    await fails(ST, "select * from public.shared_quiz_keys");
    await fails(ST, "select * from public.question_keys");
    expect((await raw("select count(*)::int c from public.shared_quiz_keys"))[0]!.c).toBe(2); // control: the key exists

    const mine = (await rows(ST, "select public.import_shared_quiz($1) as id", [sid]))[0]!.id as string;
    expect((await rows(ST, "select public.import_shared_quiz($1) as id", [sid]))[0]!.id).toBe(mine); // idempotent
    const copy = (await raw("select user_id, server_generated, source_shared_quiz_id from public.quizzes where id = $1", [mine]))[0]!;
    expect([copy.user_id, copy.server_generated, copy.source_shared_quiz_id]).toEqual([ST, false, sid]);
    const copyQs = await rows(ST, "select id, position, answer, explanation from public.questions where quiz_id = $1 order by position", [mine]);
    expect(copyQs.every((q) => q.answer === "" && q.explanation === null)).toBe(true);

    const res = (await rows(ST, "select public.submit_quiz_attempt($1, $2::jsonb) as r", [mine, JSON.stringify({ [copyQs[0]!.id]: 1, [copyQs[1]!.id]: true })]))[0]!.r;
    expect(res.score).toBe(2);
    expect(res.xp_awarded).toBe(0);
    expect(res.xp_eligible).toBe(false);
    // the original owner's quiz is untouched and graded the same way (control)
    const own = (await rows(UP, "select public.submit_quiz_attempt($1, $2::jsonb) as r", [quiz, JSON.stringify({ [qids[0]!]: 0 })]))[0]!.r;
    expect(own.score).toBe(0);
    expect((await raw("select import_count from public.shared_quizzes where id = $1", [sid]))[0]!.import_count).toBe(1);

    await expect(run(ST, "select public.share_quiz($1)", [mine])).rejects.toThrow(/again/);
    await expect(run(UP, "select public.import_shared_quiz($1)", [sid])).rejects.toThrow(/own/);
    await fails(ST, "update public.quizzes set source_shared_quiz_id = null where id = $1", [mine]).catch(() => {});
    await run(ST, "update public.quizzes set source_shared_quiz_id = null where id = $1", [mine]);
    expect((await raw("select source_shared_quiz_id from public.quizzes where id = $1", [mine]))[0]!.source_shared_quiz_id).toBe(sid); // frozen
  });
  it("clients cannot write shared tables directly", async () => {
    await fails(ST, "insert into public.shared_quizzes (owner_id, title, question_count, status) values ($1, 'x', 1, 'published')", [ST]);
    await fails(ST, "insert into public.shared_decks (owner_id, title, card_count, status) values ($1, 'x', 1, 'published')", [ST]);
  });
});

describe("shared flashcard decks", () => {
  it("share -> moderation -> import; imported cards cannot be re-shared; idempotent", async () => {
    const cards = (await raw("insert into public.flashcards (user_id, front, back) values ($1, 'f1', 'b1'), ($1, 'f2', 'b2') returning id", [UP])).map((r) => r.id as string);
    await expect(run(ST, "select public.share_flashcards('Deck', $1)", [cards])).rejects.toThrow(/not found/);
    const did = (await rows(UP, "select public.share_flashcards('Deck', $1) as id", [cards]))[0]!.id as string;
    await expect(run(ST, "select public.import_shared_deck($1)", [did])).rejects.toThrow(/not found/); // pending
    await run(MOD, "select public.admin_review_content('shared_deck', $1, 'approve', 'looks ok')", [did]);
    expect((await rows(ST, "select count(*)::int c from public.shared_deck_cards where deck_id = $1", [did]))[0]!.c).toBe(2);
    expect((await rows(OTHER_UNI, "select count(*)::int c from public.shared_deck_cards where deck_id = $1", [did]))[0]!.c).toBe(0);
    expect((await rows(ST, "select public.import_shared_deck($1) as n", [did]))[0]!.n).toBe(2);
    expect((await rows(ST, "select public.import_shared_deck($1) as n", [did]))[0]!.n).toBe(0);
    const mine = (await raw("select id from public.flashcards where user_id = $1 and source_shared_deck_id = $2", [ST, did])).map((r) => r.id as string);
    expect(mine.length).toBe(2);
    await expect(run(ST, "select public.share_flashcards('Again', $1)", [mine])).rejects.toThrow(/not found/);
    await expect(run(UP, "select public.import_shared_deck($1)", [did])).rejects.toThrow(/own/);
  });
});

describe("function grants", () => {
  it("anon cannot call the notes RPCs", async () => {
    for (const q of [
      "select public.create_resource('t', null, 'note', null, 'public', '{}', 'x', 'application/pdf', 1, 'f')",
      "select public.report_copyright('00000000-0000-4000-8000-000000000001', 'xxxxxxxxxxxx')",
      "select * from public.search_resources(null)",
      "select public.get_contributor_profile('00000000-0000-4000-8000-000000000001')",
      "select public.admin_review_content('resource', '00000000-0000-4000-8000-000000000001', 'approve', 'abc')",
    ])
      await expect(db.transaction(async (tx) => { await tx.exec("set local role anon"); await tx.query(q); })).rejects.toThrow(/permission denied/);
  });
});
