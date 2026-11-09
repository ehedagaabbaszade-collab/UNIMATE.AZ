import type { PGlite } from "@electric-sql/pglite";
import { awardXp, localDay, MAX_BYTES, validateUpload, type XpEvent } from "@unimate/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { affected, asAnon, asService, asUser, createTestDb, ids, seedFixtures, select } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb({ seed: true });
  await seedFixtures(db);
}, 120_000);

afterAll(async () => {
  await db.close();
});

const A = ids.alice;
const B = ids.bob;
const C = ids.carol;
const MOD = ids.mod;

const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params));
let n = 0;
const newUser = async () => {
  n++;
  const id = `00000000-0000-4000-8000-0000002${String(n).padStart(5, "0")}`;
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `pg${n}@example.test`]);
  return id;
};
const uuid = (prefix: string, k: number) => `${prefix}0000000-0000-4000-8000-${String(k).padStart(12, "0")}`;

describe("account deletion", () => {
  it("request is idempotent, scheduled ~14 days out, visible only to its owner", async () => {
    const u = await newUser();
    const w = await newUser();
    const first = (await run(u, "select public.request_account_deletion() as t")).rows[0]!.t as Date;
    const second = (await run(u, "select public.request_account_deletion() as t")).rows[0]!.t as Date;
    expect(second.getTime()).toBe(first.getTime());
    const days = (first.getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(13.99);
    expect(days).toBeLessThanOrEqual(14);
    expect((await select(db, "authenticated", u, "select * from public.account_deletion_requests")).length).toBe(1);
    expect(await select(db, "authenticated", w, "select * from public.account_deletion_requests")).toEqual([]);
  });
  it("clients cannot write the table directly", async () => {
    const u = await newUser();
    expect(await affected(db, "authenticated", u, "insert into public.account_deletion_requests (user_id) values ($1)", [u])).toBe(0);
    await run(u, "select public.request_account_deletion()");
    expect(await affected(db, "authenticated", u, "update public.account_deletion_requests set scheduled_for = now() + interval '1 second' where user_id = $1", [u])).toBe(0);
    expect(await affected(db, "authenticated", u, "delete from public.account_deletion_requests where user_id = $1", [u])).toBe(0);
    expect(await select(db, "anon", null, "select * from public.account_deletion_requests")).toEqual([]);
  });
  it("anon and uid-less callers are rejected", async () => {
    await expect(asAnon(db, (tx) => tx.query("select public.request_account_deletion()"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query("select public.request_account_deletion()"))).rejects.toThrow(/not authenticated/);
    await expect(asUser(db, null, (tx) => tx.query("select public.cancel_account_deletion()"))).rejects.toThrow(/not authenticated/);
  });
  it("cancel works once; a cancelled request is never purged; a new request can follow", async () => {
    const u = await newUser();
    await run(u, "select public.request_account_deletion()");
    expect((await run(u, "select public.cancel_account_deletion() as ok")).rows[0]!.ok).toBe(true);
    expect((await run(u, "select public.cancel_account_deletion() as ok")).rows[0]!.ok).toBe(false);
    await db.query("update public.account_deletion_requests set scheduled_for = now() - interval '1 day', requested_at = now() - interval '15 days' where user_id = $1", [u]);
    expect((await asService(db, (tx) => tx.query("select public.purge_due_account_deletions() as n"))).rows[0]).toMatchObject({ n: 0 });
    expect((await raw("select 1 from public.profiles where id = $1", [u])).length).toBe(1);
    await run(u, "select public.request_account_deletion()");
    expect((await raw("select count(*)::int c from public.account_deletion_requests where user_id = $1", [u]))[0]!.c).toBe(2);
  });
  it("purge is service-role only; deletes only due users and cascades their data", async () => {
    const due = await newUser();
    const notDue = await newUser();
    await db.query("insert into public.documents (user_id, title, storage_path, idempotency_key) values ($1, 't', $2, 'idem-purge-01')", [due, `${due}/p.pdf`]);
    await run(due, "select public.request_account_deletion()");
    await run(notDue, "select public.request_account_deletion()");
    for (const uid of [due, A]) {
      await expect(run(uid, "select public.purge_due_account_deletions()")).rejects.toThrow(/permission denied/);
      await expect(run(uid, "select public.due_account_deletions()")).rejects.toThrow(/permission denied/);
    }
    await expect(asAnon(db, (tx) => tx.query("select public.purge_due_account_deletions()"))).rejects.toThrow(/permission denied/);
    // not yet due
    expect((await asService(db, (tx) => tx.query("select public.purge_due_account_deletions() as n"))).rows[0]).toMatchObject({ n: 0 });
    await db.query("update public.account_deletion_requests set scheduled_for = now() - interval '1 day', requested_at = now() - interval '15 days' where user_id = $1", [due]);
    const list = (await asService(db, (tx) => tx.query("select * from public.due_account_deletions()"))).rows.map((r) => Object.values(r as object)[0]);
    expect(list).toEqual([due]);
    expect((await asService(db, (tx) => tx.query("select public.purge_due_account_deletions() as n"))).rows[0]).toMatchObject({ n: 1 });
    expect(await raw("select 1 from auth.users where id = $1", [due])).toEqual([]);
    expect(await raw("select 1 from public.profiles where id = $1", [due])).toEqual([]);
    expect(await raw("select 1 from public.documents where user_id = $1", [due])).toEqual([]);
    expect((await raw("select 1 from public.profiles where id = $1", [notDue])).length).toBe(1);
    expect((await raw("select 1 from public.profiles where id in ($1, $2)", [A, B])).length).toBe(2);
    expect((await raw("select 1 from public.audit_logs where action = 'account.purged' and entity_id = $1", [due])).length).toBe(1);
  });
});

describe("community owner succession", () => {
  const mk = async (k: number, members: [string, string, string, string?][]) => {
    const owner = await newUser();
    const com = uuid("c", 900 + k);
    await db.query("insert into public.communities (id, name, slug, created_by) values ($1, 'Succ', $2, $3)", [com, `succ-${k}`, owner]);
    for (const [u, role, created, status] of members) {
      await db.query("insert into public.memberships (community_id, user_id, role, status, created_at) values ($1, $2, $3, $4, $5)", [com, u, role, status ?? "active", created]);
    }
    return { owner, com };
  };
  const roleOf = async (com: string, u: string) => (await raw("select role from public.memberships where community_id = $1 and user_id = $2", [com, u]))[0]?.role;

  it("oldest active moderator wins over an older plain member", async () => {
    const [m1, mod1, mod2] = [await newUser(), await newUser(), await newUser()];
    const { owner, com } = await mk(1, [[m1, "member", "2020-01-01"], [mod1, "moderator", "2021-01-01"], [mod2, "moderator", "2022-01-01"]]);
    await db.query("delete from auth.users where id = $1", [owner]);
    expect(await roleOf(com, mod1)).toBe("owner");
    expect(await roleOf(com, mod2)).toBe("moderator");
    expect(await roleOf(com, m1)).toBe("member");
    expect((await raw("select count(*)::int c from public.memberships where community_id = $1 and role = 'owner'", [com]))[0]!.c).toBe(1);
  });
  it("without moderators the oldest ACTIVE member wins (pending and banned skipped)", async () => {
    const [pend, ban, m1, m2] = [await newUser(), await newUser(), await newUser(), await newUser()];
    const { owner, com } = await mk(2, [[pend, "member", "2019-01-01", "pending"], [ban, "member", "2019-06-01", "banned"], [m2, "member", "2022-01-01"], [m1, "member", "2021-01-01"]]);
    await db.query("delete from auth.users where id = $1", [owner]);
    expect(await roleOf(com, m1)).toBe("owner");
    expect(await roleOf(com, pend)).toBe("member");
    expect(await roleOf(com, ban)).toBe("member");
  });
  it("community with nobody left survives ownerless; deleting a non-owner changes nothing", async () => {
    const { owner, com } = await mk(3, []);
    await db.query("delete from auth.users where id = $1", [owner]);
    expect((await raw("select 1 from public.communities where id = $1", [com])).length).toBe(1);
    expect((await raw("select 1 from public.memberships where community_id = $1", [com])).length).toBe(0);
    const m = await newUser();
    const o2 = await mk(4, [[m, "member", "2020-01-01"]]);
    await db.query("delete from auth.users where id = $1", [m]);
    expect(await roleOf(o2.com, o2.owner)).toBe("owner");
  });
});

describe("export_my_data", () => {
  const SELF = "00000000-0000-4000-8000-0000000003a1";
  let json: any;
  let bobJson: any;
  const anonPost = uuid("7", 801);
  beforeAll(async () => {
    // Alice: extra owned data. Bob (BOB- markers): same shapes, must never appear in Alice's export.
    for (const [u, tag] of [[A, "ALICE"], [B, "BOB"]] as const) {
      await db.query("insert into public.summaries (user_id, document_id, content) values ($1, $2, $3)", [u, u === A ? ids.docA : ids.docB, `${tag}-summary`]);
      await db.query("insert into public.flashcards (user_id, front, back) values ($1, $2, 'b')", [u, `${tag}-front`]);
      await db.query("insert into public.tasks (user_id, title) values ($1, $2)", [u, `${tag}-task`]);
      await db.query("insert into public.exams (user_id, title, starts_at) values ($1, $2, now())", [u, `${tag}-exam`]);
      await db.query("insert into public.study_sessions (user_id) values ($1)", [u]);
      await db.query("insert into public.notifications (user_id, kind, title) values ($1, 'k', $2)", [u, `${tag}-notif`]);
      await db.query("insert into public.xp_events (user_id, kind, points) values ($1, 'x', 5)", [u]);
      await db.query("insert into public.streaks (user_id, current_streak, longest_streak) values ($1, 1, 1)", [u]);
      await db.query("insert into public.resources (uploader_id, title) values ($1, $2)", [u, `${tag}-note`]);
      await db.query("insert into public.quizzes (id, user_id, title) values ($1, $2, $3)", [u === A ? uuid("8", 801) : uuid("8", 802), u, `${tag}-quiz`]);
      await db.query("insert into public.questions (quiz_id, position, kind, prompt, answer, options) values ($1, 0, 'mcq', $2, 'a', '[]')", [u === A ? uuid("8", 801) : uuid("8", 802), `${tag}-question`]);
      await db.query("insert into public.attempts (quiz_id, user_id, max_score) values ($1, $2, 1)", [u === A ? uuid("8", 801) : uuid("8", 802), u]);
    }
    await db.query("insert into public.posts (community_id, author_id, title, body) values ($1, $2, 'BOB-post', 'BOB-body')", [ids.pubCommunity, B]);
    await db.query("insert into public.memberships (community_id, user_id) values ($1, $2) on conflict do nothing", [ids.pubCommunity, B]);
    // carol (not alice, not bob) posts anonymously; alice comments on it and bob comments on alice's post
    await db.query("insert into public.posts (id, community_id, author_id, is_anonymous, kind, title, body) values ($1, $2, null, true, 'question', 'CAROL-anon', 'CAROL-anon-body')", [anonPost, ids.pubCommunity]);
    await db.query("insert into public.post_private_authors (post_id, author_id) values ($1, $2)", [anonPost, C]);
    await db.query("insert into public.comments (post_id, author_id, body) values ($1, $2, 'ALICE-comment'), ($3, $4, 'BOB-comment')", [anonPost, A, ids.pubPost, B]);
    await db.query("insert into public.follows (follower_id, followee_id) values ($1, $2), ($2, $1)", [A, B]);
    await db.query("insert into public.ai_usage (user_id, feature, model, input_tokens, output_tokens, cost_micro_usd) values ($1, 'chat', 'm1', 7, 3, 100), ($1, 'chat', 'm1', 1, 1, 50)", [A]);
    // Bob's own anonymous question (for his positive control)
    await db.query("insert into public.posts (id, community_id, author_id, is_anonymous, kind, title, body) values ($1, $2, null, true, 'question', 'BOB-anon', 'x')", [uuid("7", 802), ids.pubCommunity]);
    await db.query("insert into public.post_private_authors (post_id, author_id) values ($1, $2)", [uuid("7", 802), B]);
    json = (await run(A, "select public.export_my_data() as d")).rows[0]!.d;
    bobJson = (await run(B, "select public.export_my_data() as d")).rows[0]!.d;
  });

  it("contains the caller's own rows across tables (positive control)", () => {
    const names = (k: string, f: string) => (json[k] as any[]).map((r) => r[f]);
    expect(json.profile.id).toBe(A);
    expect(names("documents", "title")).toContain("Alice doc");
    expect(names("summaries", "content")).toContain("ALICE-summary");
    expect(json.conversations.map((c: any) => c.id)).toContain(ids.convA);
    expect(json.conversations[0].messages.map((m: any) => m.content)).toContain("alice secret question");
    expect(json.quizzes[0].questions.map((q: any) => q.prompt)).toContain("ALICE-question");
    expect(json.attempts.length).toBe(1);
    expect(names("flashcards", "front")).toContain("ALICE-front");
    expect(json.study_sessions.length).toBe(1);
    expect(names("tasks", "title")).toContain("ALICE-task");
    expect(names("exams", "title")).toContain("ALICE-exam");
    expect(names("posts", "title")).toContain("public post");
    expect(names("comments", "body")).toEqual(["ALICE-comment"]);
    expect(json.memberships.length).toBeGreaterThanOrEqual(2);
    expect(json.following.map((f: any) => f.followee_id)).toEqual([B]);
    expect(names("resources", "title")).toContain("ALICE-note");
    expect(names("notifications", "title")).toContain("ALICE-notif");
    expect(json.xp_events.length).toBe(1);
    expect(json.streak.user_id).toBe(A);
    const m1 = json.ai_usage_summary.find((r: any) => r.model === "m1");
    expect(m1).toEqual({ feature: "chat", model: "m1", requests: 2, input_tokens: 8, output_tokens: 4, cost_micro_usd: 150 });
    expect(json.ai_usage_summary.every((r: any) => !("user_id" in r) && !("id" in r))).toBe(true);
  });
  it("never contains other users' data or anonymous authorship of others", () => {
    const s = JSON.stringify(json);
    expect(s).not.toContain("BOB-");
    expect(s).not.toContain("bob secret question");
    expect(s).not.toContain(ids.docB);
    expect(s).not.toContain(ids.msgB);
    expect(s).not.toContain("CAROL-anon");
    expect(s).not.toContain(C);
    expect(json.anonymous_posts).toEqual([]);
    expect(json.following.every((f: any) => f.follower_id === A)).toBe(true);
    expect(Object.keys(json)).not.toContain("followers");
  });
  it("includes the caller's own anonymous posts, and not Alice's in Bob's export", () => {
    expect(bobJson.anonymous_posts.map((p: any) => p.title)).toEqual(["BOB-anon"]);
    expect(JSON.stringify(bobJson)).not.toContain("ALICE-");
    expect(bobJson.profile.id).toBe(B);
  });
  it("staff only get their own data; anon and uid-less callers are rejected", async () => {
    const m = (await run(MOD, "select public.export_my_data() as d")).rows[0]!.d;
    expect(m.profile.id).toBe(MOD);
    expect(m.documents).toEqual([]);
    expect(JSON.stringify(m)).not.toContain("ALICE-");
    await expect(asAnon(db, (tx) => tx.query("select public.export_my_data()"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query("select public.export_my_data()"))).rejects.toThrow(/not authenticated/);
    expect(SELF.length).toBe(36);
  });
});

describe("profiles locale and goals", () => {
  const upd = (uid: string, col: string, val: unknown, target = uid) =>
    asUser(db, uid, (tx) => tx.query(`update public.profiles set ${col} = $1 where id = $2`, [val, target]));
  it("accepts tr, still rejects unknown locales", async () => {
    await upd(A, "locale", "tr");
    expect((await raw("select locale from public.profiles where id = $1", [A]))[0]!.locale).toBe("tr");
    await expect(upd(A, "locale", "de")).rejects.toThrow(/check constraint/);
    await upd(A, "locale", "az");
  });
  it("goals: valid set stored; invalid shapes rejected; only own row", async () => {
    await upd(A, "goals", ["GPA 3.5", "Learn SQL"]);
    expect((await raw("select goals from public.profiles where id = $1", [A]))[0]!.goals).toEqual(["GPA 3.5", "Learn SQL"]);
    await expect(upd(A, "goals", Array.from({ length: 11 }, (_, i) => `g${i}`))).rejects.toThrow(/check constraint/);
    await expect(upd(A, "goals", ["ok", "   "])).rejects.toThrow(/check constraint/);
    await expect(upd(A, "goals", ["x".repeat(101)])).rejects.toThrow(/check constraint/);
    await expect(upd(A, "goals", ["ok", null])).rejects.toThrow(/check constraint/);
    await expect(upd(A, "goals", null)).rejects.toThrow(/not-null|null value/);
    expect((await asUser(db, A, (tx) => tx.query("update public.profiles set goals = $1 where id = $2", [["hack"], B]))).affectedRows).toBe(0);
    expect((await raw("select goals from public.profiles where id = $1", [B]))[0]!.goals).toEqual([]);
  });
});

describe("faculties and majors are admin-managed only (no fabricated structure)", () => {
  it("none seeded; students and moderators denied, admin may insert", async () => {
    expect((await raw("select (select count(*) from public.faculties)::int f, (select count(*) from public.majors)::int m"))[0]).toEqual({ f: 0, m: 0 });
    const uni = (await raw("select id from public.universities limit 1"))[0]!.id;
    for (const u of [A, MOD]) {
      await expect(run(u, "insert into public.faculties (university_id, name) values ($1, 'Test Faculty')", [uni])).rejects.toThrow(/row-level security/);
    }
    await run(ids.admin, "insert into public.faculties (university_id, name) values ($1, 'Test Faculty')", [uni]);
    expect((await select(db, "authenticated", A, "select name from public.faculties")).map((r) => r.name)).toEqual(["Test Faculty"]);
  });
});

describe("documents bucket and size limits match core validateUpload", () => {
  const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const JPG = Uint8Array.from([0xff, 0xd8, 0xff]);
  const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
  const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  const samples: [string, string, Uint8Array][] = [
    ["a.pdf", "application/pdf", PDF], ["a.docx", DOCX, ZIP], ["a.pptx", PPTX, ZIP], ["a.png", "image/png", PNG], ["a.jpg", "image/jpeg", JPG],
  ];
  it("allowed_mime_types is exactly the set core accepts; text/plain is not accepted by core", async () => {
    const b = (await raw("select file_size_limit, allowed_mime_types from public.documents limit 0; ").catch(() => [])) && (await raw("select file_size_limit, allowed_mime_types from storage.buckets where id = 'documents'"))[0]!;
    for (const [name, mime, head] of samples) {
      expect(validateUpload({ name, size: 10, mimeType: mime, headBytes: head }).ok).toBe(true);
      expect(b.allowed_mime_types).toContain(mime);
    }
    expect(b.allowed_mime_types.length).toBe(samples.length);
    expect(validateUpload({ name: "a.txt", size: 10, mimeType: "text/plain", headBytes: PDF }).ok).toBe(false);
    expect(Number(b.file_size_limit)).toBe(Math.max(...Object.values(MAX_BYTES)));
  });
  it("documents.size_bytes enforces the per-kind core limits", async () => {
    let k = 0;
    const ins = (mime: string, size: number) =>
      db.query("insert into public.documents (user_id, title, storage_path, idempotency_key, mime_type, size_bytes) values ($1, 't', $2, $3, $4, $5)",
        [A, `${A}/lim${++k}.bin`, `idem-lim-${String(k).padStart(4, "0")}`, mime, size]);
    await ins("application/pdf", MAX_BYTES.pdf);
    await expect(ins("application/pdf", MAX_BYTES.pdf + 1)).rejects.toThrow(/check constraint/);
    await ins("image/png", MAX_BYTES.png);
    await expect(ins("image/png", MAX_BYTES.png + 1)).rejects.toThrow(/check constraint/);
    await expect(ins("image/jpeg", MAX_BYTES.jpg + 1)).rejects.toThrow(/check constraint/);
    await ins(DOCX, MAX_BYTES.docx);
    await expect(ins(DOCX, MAX_BYTES.docx + 1)).rejects.toThrow(/check constraint/);
    await ins(PPTX, MAX_BYTES.pptx);
  });
});

describe("award_xp", () => {
  const today = () => localDay(new Date());
  const mkRefs = async (u: string) => {
    const quiz = (await raw("insert into public.quizzes (user_id, title) values ($1, 'q') returning id", [u]))[0]!.id;
    const q = (await raw("insert into public.questions (quiz_id, position, kind, prompt, answer, options) values ($1, 0, 'mcq', 'p', 'a', '[]') returning id", [quiz]))[0]!.id;
    const f = (await raw("insert into public.flashcards (user_id, front, back) values ($1, 'f', 'b') returning id", [u]))[0]!.id;
    return { q: q as string, f: f as string };
  };
  const award = async (u: string, kind: string, ref: string | null, hint: number | null = null) =>
    (await run(u, "select public.award_xp($1, $2, $3) as r", [kind, ref, hint])).rows[0]!.r as { awarded: number; reason?: string; streak?: number; earned_today?: number };
  const seedState = async (u: string, earned: number, streak: number) => {
    if (earned > 0) await db.query("insert into public.xp_events (user_id, kind, points) values ($1, 'seed', $2)", [u, earned]);
    if (streak > 0) await db.query("insert into public.streaks (user_id, current_streak, longest_streak, last_active_date) values ($1, $2, $2, $3)", [u, streak, today()]);
  };
  const toEvent = (kind: string): XpEvent =>
    kind === "quiz_correct" ? { type: "quiz_answer", correct: true } : kind === "quiz_incorrect" ? { type: "quiz_answer", correct: false } : { type: "review_completed" };

  const cases: [string, number, number][] = [];
  for (const kind of ["quiz_correct", "quiz_incorrect", "review_completed"])
    for (const earned of [0, 100, 149, 150, 200, 290, 295, 299, 300])
      for (const streak of [0, 3, 10, 15]) cases.push([kind, earned, streak]);

  it.each(cases)("matches core awardXp: %s earned=%i streak=%i", async (kind, earned, streak) => {
    const u = await newUser();
    const refs = await mkRefs(u);
    await seedState(u, earned, streak);
    const expected = awardXp(toEvent(kind), { earnedToday: earned, streakDays: streak });
    const r = await award(u, kind, kind === "review_completed" ? refs.f : refs.q);
    expect(r.awarded).toBe(expected);
    const rows = await raw("select coalesce(sum(points) filter (where kind <> 'seed'), 0)::int s from public.xp_events where user_id = $1", [u]);
    expect(rows[0]!.s).toBe(expected);
  });

  it("a stale streak (last active 2 days ago) gives no bonus, like core streakDays=0", async () => {
    const u = await newUser();
    const refs = await mkRefs(u);
    await db.query("insert into public.streaks (user_id, current_streak, longest_streak, last_active_date) values ($1, 8, 8, (now() at time zone 'Asia/Baku')::date - 2)", [u]);
    expect((await award(u, "review_completed", refs.f)).awarded).toBe(awardXp({ type: "review_completed" }, { earnedToday: 0, streakDays: 0 }));
  });
  it("sequence over a full day never exceeds the hard cap and tracks core step by step", async () => {
    const u = await newUser();
    let earned = 0;
    for (let i = 0; i < 40; i++) {
      const f = (await raw("insert into public.flashcards (user_id, front, back) values ($1, 'f', 'b') returning id", [u]))[0]!.id;
      const r = await award(u, "review_completed", f);
      const exp = awardXp({ type: "review_completed" }, { earnedToday: earned, streakDays: i === 0 ? 0 : 1 });
      expect(r.awarded).toBe(exp);
      earned += exp;
    }
    expect(earned).toBe(300);
    expect((await raw("select sum(points)::int s from public.xp_events where user_id = $1", [u]))[0]!.s).toBe(300);
  });
  it("yesterday's XP does not count toward today's caps", async () => {
    const u = await newUser();
    const refs = await mkRefs(u);
    await db.query("insert into public.xp_events (user_id, kind, points, created_at) values ($1, 'seed', 300, now() - interval '25 hours')", [u]);
    expect((await award(u, "review_completed", refs.f)).awarded).toBe(25);
  });
  it("idle earns nothing and writes nothing; amount_hint is ignored; same ref twice a day pays once", async () => {
    const u = await newUser();
    const refs = await mkRefs(u);
    expect(await award(u, "idle", null, 999)).toMatchObject({ awarded: 0 });
    expect((await raw("select count(*)::int c from public.xp_events where user_id = $1", [u]))[0]!.c).toBe(0);
    expect((await award(u, "quiz_incorrect", refs.q, 100000)).awarded).toBe(1);
    expect(await award(u, "quiz_incorrect", refs.q)).toMatchObject({ awarded: 0, reason: "duplicate" });
    expect((await raw("select count(*)::int c from public.xp_events where user_id = $1", [u]))[0]!.c).toBe(1);
  });
  it("validates kind and reference ownership", async () => {
    const u = await newUser();
    const other = await newUser();
    const mine = await mkRefs(u);
    const theirs = await mkRefs(other);
    await expect(award(u, "bonus", mine.f)).rejects.toThrow(/unknown xp kind/);
    await expect(award(u, "review_completed", null)).rejects.toThrow(/ref_id required/);
    await expect(award(u, "review_completed", theirs.f)).rejects.toThrow(/reference not found/);
    await expect(award(u, "quiz_correct", theirs.q)).rejects.toThrow(/reference not found/);
    await expect(award(u, "quiz_correct", mine.f)).rejects.toThrow(/reference not found/);
    expect((await award(u, "quiz_correct", mine.q)).awarded).toBe(10);
    await expect(asAnon(db, (tx) => tx.query("select public.award_xp('idle', null, null)"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query("select public.award_xp('idle', null, null)"))).rejects.toThrow(/not authenticated/);
  });
  it("streak: starts at 1, same day unchanged, consecutive day +1, gap resets, longest kept", async () => {
    const u = await newUser();
    const f = async () => (await raw("insert into public.flashcards (user_id, front, back) values ($1, 'f', 'b') returning id", [u]))[0]!.id as string;
    expect((await award(u, "review_completed", await f())).streak).toBe(1);
    expect((await award(u, "review_completed", await f())).streak).toBe(1);
    await db.query("update public.streaks set last_active_date = last_active_date - 1 where user_id = $1", [u]);
    expect((await award(u, "review_completed", await f())).streak).toBe(2);
    await db.query("update public.streaks set last_active_date = last_active_date - 3 where user_id = $1", [u]);
    expect((await award(u, "review_completed", await f())).streak).toBe(1);
    expect((await raw("select longest_streak l from public.streaks where user_id = $1", [u]))[0]!.l).toBe(2);
  });
  it("clients cannot write xp_events or streaks directly (positive controls: service can, owner can read)", async () => {
    const u = await newUser();
    expect(await affected(db, "authenticated", u, "insert into public.xp_events (user_id, kind, points) values ($1, 'x', 10000)", [u])).toBe(0);
    expect(await affected(db, "authenticated", u, "insert into public.streaks (user_id, current_streak, longest_streak) values ($1, 999, 999)", [u])).toBe(0);
    expect(await affected(db, "service_role", null, "insert into public.xp_events (user_id, kind, points) values ($1, 'x', 5)", [u])).toBe(1);
    expect(await affected(db, "authenticated", u, "update public.xp_events set points = 10000 where user_id = $1", [u])).toBe(0);
    expect(await affected(db, "authenticated", u, "delete from public.xp_events where user_id = $1", [u])).toBe(0);
    expect((await select(db, "authenticated", u, "select points from public.xp_events")).map((r) => r.points)).toEqual([5]);
  });
});
