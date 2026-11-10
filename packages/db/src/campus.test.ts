import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb } from "./harness";

// Migration 20260101004400 (UNIMATE CAMPUS). Everything client-side runs as `authenticated` with auth.uid() set;
// every negative result has a positive control. No community/post/event exists unless a test creates it.

let db: PGlite;
const U = (k: number) => `00000000-0000-4000-8000-00000000f${String(k).padStart(3, "0")}`;
const [SITEMOD, A, B, C, D, E] = [U(1), U(2), U(3), U(4), U(5), U(6)];
let UNI = "";
let UNI2 = "";

const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params));
const rows = async (uid: string, sql: string, params: unknown[] = []) => (await run(uid, sql, params)).rows;
const one = async (uid: string, sql: string, params: unknown[] = []) => (await rows(uid, sql, params))[0]!;
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
const setClock = (iso: string) => raw("insert into app_private.clock_override (at) values ($1) on conflict (singleton) do update set at = excluded.at", [iso]);
// Rows written under a fake future clock would otherwise look "recent" to the real clock afterwards.
const clearClock = async () => {
  await raw("delete from app_private.clock_override");
  await raw("delete from public.campus_actions where created_at > now() + interval '1 hour'");
};

const mkCommunity = async (uid: string, name: string, kind = "course", vis = "public") =>
  (await one(uid, "select public.create_community($1, $2, $3) as id", [name, kind, vis])).id as string;
const post = async (uid: string, c: string, title: string, body = "", extra: { kind?: string; anon?: boolean; lang?: string | null } = {}) =>
  (await one(uid, "select public.create_post($1, $2, $3, $4, $5, $6) as id", [c, title, body, extra.kind ?? "post", extra.anon ?? false, extra.lang ?? null])).id as string;
const comment = async (uid: string, p: string, body: string, parent: string | null = null) =>
  (await one(uid, "select public.create_comment($1, $2, $3) as id", [p, body, parent])).id as string;
const feed = (uid: string, c: string | null = null, args: unknown[] = []) =>
  c ? rows(uid, "select * from public.community_feed($1, $2, $3, $4)", [c, args[0] ?? 20, args[1] ?? null, args[2] ?? null]) : rows(uid, "select * from public.home_feed($1, $2, $3)", [args[0] ?? 20, args[1] ?? null, args[2] ?? null]);
const notifs = async (uid: string, key: string) => (await raw("select params, read_at from public.notifications where user_id = $1 and template_key = $2 order by created_at", [uid, key])) as Record<string, any>[];
const future = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();

let pubC = "";
let privC = "";
let groupC = "";

beforeAll(async () => {
  db = await createTestDb({ seed: false });
  for (const [i, u] of [SITEMOD, A, B, C, D, E].entries()) await raw("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [u, `k${i}@example.test`, JSON.stringify({ display_name: `User${i}` })]);
  await raw("update public.profiles set role = 'moderator' where id = $1", [SITEMOD]);
  UNI = (await raw("select id from public.universities order by name limit 1"))[0]!.id;
  UNI2 = (await raw("select id from public.universities order by name desc limit 1"))[0]!.id;
  await raw("update public.profiles set university_id = $1 where id = any($2)", [UNI, [A, B, C]]);
  await raw("update public.profiles set university_id = $1 where id = $2", [UNI2, D]);
}, 120_000);
afterAll(async () => {
  await clearClock();
  await db.close();
});

describe("no seed data, privileges", () => {
  it("starts with no communities, posts or events", async () => {
    for (const t of ["communities", "posts", "events", "comments"]) expect((await raw(`select count(*)::int as n from public.${t}`))[0]!.n).toBe(0);
    expect(await rows(A, "select * from public.discover_communities()")).toEqual([]);
  });
  it("anon cannot call campus RPCs; clients cannot call internals or read internal tables (positive control: authenticated RPC works)", async () => {
    await expect(asAnon(db, (tx) => tx.query("select * from public.home_feed()"))).rejects.toThrow(/permission denied/);
    await fails(A, "select public.campus_notify($1, 'welcome', '{}')", [B]);
    await fails(A, "select public.campus_rate_check('x', interval '1 hour', 5)");
    await fails(A, "select count(*) from public.campus_actions");
    await fails(A, "select count(*) from public.community_invites");
    await fails(A, "select public.send_event_reminders(24)");
    expect((await rows(A, "select * from public.home_feed()")).length).toBe(0);
  });
});

describe("communities", () => {
  it("ensure_university_community creates once, named after the institution; joining is limited to your own university", async () => {
    const id1 = (await one(A, "select public.ensure_university_community($1) as id", [UNI])).id;
    const id2 = (await one(B, "select public.ensure_university_community($1, true) as id", [UNI])).id;
    expect(id2).toBe(id1);
    const name = (await raw("select name from public.universities where id = $1", [UNI]))[0]!.name as string;
    const c = (await raw("select name, kind, visibility from public.communities where id = $1", [id1]))[0]!;
    expect(c).toMatchObject({ kind: "university", visibility: "public" });
    expect(c.name).toBe(name.slice(0, 100));
    expect((await raw("select count(*)::int as n from public.communities where kind = 'university'"))[0]!.n).toBe(1);
    expect((await one(B, "select public.get_community($1) as c", [id1])).c.my_status).toBe("active");
    // D studies at another university: cannot join via ensure(join) nor join_community
    await fails(D, "select public.ensure_university_community($1, true)", [UNI]);
    await fails(D, "select public.join_community($1)", [id1]);
    await fails(D, "insert into public.memberships (community_id, user_id) values ($1, $2)", [id1, D]);
    await fails(A, "select public.ensure_university_community(gen_random_uuid())");
    await run(C, "select public.join_community($1)", [id1]);
  });
  it("create_community validates, enforces server-side kind and creates owner + invite for groups", async () => {
    pubC = await mkCommunity(A, "Calculus I", "course", "public");
    privC = await mkCommunity(A, "Law Faculty", "faculty", "private");
    groupC = await mkCommunity(A, "Study Squad", "group", "public"); // groups are forced private
    expect((await raw("select visibility, kind from public.communities where id = $1", [groupC]))[0]).toMatchObject({ visibility: "private", kind: "group" });
    expect((await raw("select role from public.memberships where community_id = $1 and user_id = $2", [pubC, A]))[0]!.role).toBe("owner");
    await fails(A, "select public.create_community('x', 'course')");
    await fails(A, "select public.create_community('Official', 'university')");
    await fails(A, "select public.create_community('<script>alert(1)</script>', 'course')");
    await fails(A, "insert into public.communities (name, slug, created_by, kind) values ('Fake Uni', 'fake-uni', $1, 'university')", [A]);
    await fails(A, "update public.communities set kind = 'university' where id = $1", [pubC]);
    expect((await raw("select count(*)::int as n from public.community_invites"))[0]!.n).toBe(1);
  });
  it("discover: search, kind filter, joined filter; private groups hidden from non-members; banned hidden", async () => {
    const names = (r: Record<string, any>[]) => r.map((x) => x.name);
    expect(names(await rows(B, "select * from public.discover_communities('calc')"))).toEqual(["Calculus I"]);
    expect(names(await rows(B, "select * from public.discover_communities(null, 'faculty')"))).toEqual(["Law Faculty"]);
    expect(names(await rows(B, "select * from public.discover_communities(null, null, true)")).sort()).toEqual([(await raw("select name from public.universities where id = $1", [UNI]))[0]!.name.slice(0, 100)]);
    expect(names(await rows(B, "select * from public.discover_communities()"))).not.toContain("Study Squad");
    expect(names(await rows(A, "select * from public.discover_communities()"))).toContain("Study Squad"); // positive control: member sees it
    expect((await rows(B, "select * from public.discover_communities('%')")).length).toBe(0); // wildcard is escaped
    await fails(B, "select * from public.discover_communities(null, 'nope')");
  });
  it("public join is immediate; private needs approval; approve/reject require a moderator; request notifies moderators", async () => {
    expect((await one(B, "select public.join_community($1) as s", [pubC])).s).toBe("active");
    expect((await one(B, "select public.join_community($1) as s", [privC])).s).toBe("pending");
    expect((await one(B, "select public.join_community($1) as s", [privC])).s).toBe("pending");
    await fails(B, "select public.join_community($1)", [groupC]);
    const n = await rows(A, "select * from public.list_my_notifications()");
    expect(n.some((x) => x.kind === "campus" && /User2|Join request|wants to join/i.test(`${x.title} ${x.body}`))).toBe(true);
    await fails(C, "select public.review_join_request($1, $2, true)", [privC, B]);
    await fails(B, "select public.review_join_request($1, $2, true)", [privC, B]);
    expect((await one(A, "select public.review_join_request($1, $2, true) as ok", [privC, B])).ok).toBe(true);
    expect((await one(B, "select public.get_community($1) as c", [privC])).c.my_status).toBe("active");
    await fails(A, "select public.review_join_request($1, $2, true)", [privC, B]); // no pending request left
    // reject path
    await run(C, "select public.join_community($1)", [privC]);
    await run(A, "select public.review_join_request($1, $2, false)", [privC, C]);
    expect((await one(C, "select public.get_community($1) as c", [privC])).c.my_status).toBeNull();
  });
  it("study groups: invite code only for moderators; join_by_code; wrong code fails; code rotation invalidates the old one", async () => {
    const code = (await one(A, "select public.get_invite_code($1) as c", [groupC])).c as string;
    expect(code).toMatch(/^[A-Z0-9]{20}$/);
    await fails(B, "select public.get_invite_code($1)", [groupC]);
    expect((await one(C, "select public.join_by_code('WRONGCODE1') as id")).id).toBeNull(); // a miss returns null (so the attempt is recorded durably)
    expect((await one(C, "select public.join_by_code($1) as id", [code.toLowerCase()])).id).toBe(groupC);
    expect((await one(C, "select public.get_community($1) as c", [groupC])).c.my_status).toBe("active");
    const code2 = (await one(A, "select public.get_invite_code($1, true) as c", [groupC])).c as string;
    expect(code2).not.toBe(code);
    expect((await one(B, "select public.join_by_code($1) as id", [code])).id).toBeNull();
    await run(B, "select public.join_by_code($1)", [code2]);
    // group discussion = group feed, visible to members only
    const p = await post(C, groupC, "Exam prep plan", "Meet on Monday");
    expect((await feed(B, groupC)).map((x) => x.id)).toContain(p);
    expect(await feed(D, groupC)).toEqual([]);
    await fails(D, "select public.create_post($1, 'hi')", [groupC]);
  });
  it("members list: members only, blocks hide both ways; ban list needs moderator", async () => {
    expect((await rows(B, "select * from public.community_members($1)", [pubC])).length).toBe(2);
    expect(await rows(D, "select * from public.community_members($1)", [pubC])).toEqual([]);
    await fails(B, "select * from public.community_members($1, 10, 0, 'banned')", [pubC]);
    expect(await rows(A, "select * from public.community_members($1, 10, 0, 'banned')", [pubC])).toEqual([]);
  });
  it("leave: owner cannot leave; member can; get_community hides private-group data from outsiders", async () => {
    await fails(A, "select public.leave_community($1)", [pubC]);
    await run(C, "select public.join_community($1)", [pubC]);
    expect((await one(C, "select public.leave_community($1) as ok", [pubC])).ok).toBe(true);
    expect((await one(D, "select public.get_community($1) as c", [groupC])).c).toBeNull();
  });
});

describe("posts, validation, rate limits", () => {
  it("create/edit/delete own post; others cannot; language tag is stored as-is and validated", async () => {
    const p = await post(B, pubC, "Integrals help", "How do I integrate x*e^x?", { kind: "question", lang: "en" });
    const card = await one(B, "select * from public.get_post($1)", [p]);
    expect(card).toMatchObject({ title: "Integrals help", language: "en", is_mine: true, kind: "question", is_anonymous: false });
    await fails(C, "select public.edit_post($1, 'x', 'y')", [p]);
    await run(B, "select public.edit_post($1, 'Integrals help (edited)', 'body', 'az')", [p]);
    const c2 = await one(B, "select * from public.get_post($1)", [p]);
    expect(c2.title).toContain("edited");
    expect(c2.language).toBe("az");
    expect(c2.edited_at).not.toBeNull();
    await fails(B, "select public.create_post($1, 'x', '', 'post', false, 'de')", [pubC]);
    await fails(C, "select public.delete_post($1)", [p]);
    expect((await one(B, "select public.delete_post($1) as ok", [p])).ok).toBe(true);
    expect(await rows(B, "select * from public.get_post($1)", [p])).toEqual([]);
    expect((await feed(B, pubC)).map((x) => x.id)).not.toContain(p);
  });
  it("only members post; sanitisation rejects HTML and non-https links, accepts https and math", async () => {
    await fails(D, "select public.create_post($1, 'hello')", [pubC]);
    await fails(B, "select public.create_post($1, '<script>alert(1)</script>')", [pubC]);
    await fails(B, "select public.create_post($1, 'ok', 'see <img src=x onerror=alert(1)>')", [pubC]);
    await fails(B, "select public.create_post($1, 'ok', 'visit http://evil.example/x')", [pubC]);
    await fails(B, "select public.create_post($1, 'ok', 'click javascript:alert(1)')", [pubC]);
    await fails(B, "insert into public.posts (community_id, author_id, title, body) values ($1, $2, 'direct', '<b>x</b>')", [pubC, B]);
    await post(B, pubC, "Math", "if x<y and y>3 then see https://example.org/page");
    expect(await post(B, pubC, "Plain https", "https://example.org/a")).toBeTruthy();
  });
  it("posts per hour are capped server-side (also for direct inserts) and duplicates are rejected; the window slides", async () => {
    await setClock("2030-01-01T10:00:00Z");
    for (let i = 0; i < 10; i++) await post(E, (await mkCommunityOnce()), `Rate post ${i}`, `body ${i}`);
    expect(await fails(E, "select public.create_post($1, 'one too many')", [await mkCommunityOnce()])).toMatch(/rate limit/);
    expect(await fails(E, "insert into public.posts (community_id, author_id, title, body) values ($1, $2, 'direct', 'x')", [await mkCommunityOnce(), E])).toMatch(/rate limit/);
    await setClock("2030-01-01T11:30:00Z");
    await post(E, await mkCommunityOnce(), "After window", "ok");
    expect(await fails(E, "select public.create_post($1, 'After window', 'ok')", [await mkCommunityOnce()])).toMatch(/duplicate/);
    await clearClock();
  });
});

let rateCommunity = "";
async function mkCommunityOnce() {
  if (!rateCommunity) {
    await setClock("2029-12-31T10:00:00Z");
    rateCommunity = await mkCommunity(E, "Rate Lab", "course", "public");
    await setClock("2030-01-01T10:00:00Z");
  }
  return rateCommunity;
}

describe("feeds, blocks, anonymity", () => {
  let p1 = "";
  let p2 = "";
  let p3 = "";
  it("cursor pagination, newest first, no duplicates or gaps; home feed = my communities", async () => {
    await clearClock();
    const cc = await mkCommunity(A, "Feed Lab", "course", "public");
    await run(B, "select public.join_community($1)", [cc]);
    p1 = await post(A, cc, "first");
    await raw("update public.posts set created_at = now() - interval '3 minutes' where id = $1", [p1]);
    p2 = await post(B, cc, "second");
    await raw("update public.posts set created_at = now() - interval '2 minutes' where id = $1", [p2]);
    p3 = await post(A, cc, "third");
    await raw("update public.posts set created_at = now() - interval '1 minutes' where id = $1", [p3]);
    const page1 = await feed(B, cc, [2]);
    expect(page1.map((x) => x.id)).toEqual([p3, p2]);
    const last = page1[1]!;
    const page2 = await feed(B, cc, [2, last.created_at, last.id]);
    expect(page2.map((x) => x.id)).toEqual([p1]);
    const home = (await feed(B)).map((x) => x.id);
    expect(home).toEqual(expect.arrayContaining([p1, p2, p3]));
    expect((await feed(D)).map((x) => x.id)).toEqual([]);
    expect((await feed(B, null, [1])).length).toBe(1);
    cc2 = cc;
  });
  it("blocking hides content both ways (feed, detail, comments), unblocking restores it, follows are dropped", async () => {
    await run(B, "select public.follow_user($1)", [A]);
    const cm = await comment(A, p2, "A comments on B");
    expect((await rows(B, "select * from public.post_comments($1)", [p2])).map((x) => x.id)).toContain(cm);
    await run(B, "select public.block_user($1)", [A]);
    expect((await rows(B, "select 1 from public.follows where follower_id = $1", [B])).length).toBe(0);
    expect((await feed(B, cc2)).map((x) => x.id)).toEqual([p2]);
    expect((await feed(A, cc2)).map((x) => x.id)).toEqual([p1, p3].reverse());
    expect(await rows(A, "select * from public.get_post($1)", [p2])).toEqual([]);
    expect(await rows(B, "select * from public.get_post($1)", [p1])).toEqual([]);
    expect((await rows(B, "select * from public.post_comments($1)", [p2])).map((x) => x.id)).not.toContain(cm);
    expect((await one(A, "select public.campus_profile($1) as p", [B])).p).toBeNull();
    await fails(A, "select public.follow_user($1)", [B]);
    await fails(B, "select public.follow_user($1)", [A]);
    await fails(A, "select public.react('post', $1, 'like')", [p2]);
    expect((await rows(B, "select * from public.list_blocked_users()")).map((x) => x.user_id)).toEqual([A]);
    await run(B, "select public.unblock_user($1)", [A]);
    expect((await feed(B, cc2)).map((x) => x.id)).toContain(p1);
    expect((await one(A, "select public.campus_profile($1) as p", [B])).p).not.toBeNull();
  });
  it("private community posts never reach outsiders via feeds, search or follows", async () => {
    const pp = await post(A, privC, "Secret faculty plan", "confidential");
    expect((await feed(D)).map((x) => x.id)).not.toContain(pp);
    await run(D, "select public.follow_user($1)", [A]);
    expect((await feed(D)).map((x) => x.id)).not.toContain(pp);
    expect((await feed(A)).map((x) => x.id)).toContain(pp);
    expect((await one(D, "select public.search_campus('Secret faculty') as r")).r.posts).toEqual([]);
    expect((await one(A, "select public.search_campus('Secret faculty') as r")).r.posts.length).toBe(1);
    expect(await rows(D, "select * from public.get_post($1)", [pp])).toEqual([]);
    expect(await rows(D, "select * from public.user_posts($1)", [A]).then((r) => r.map((x) => x.id))).not.toContain(pp);
  });
  it("anonymous questions: author hidden everywhere, owner can edit/delete, others and moderators cannot unmask via RPC", async () => {
    const q = await post(B, pubC, "Embarrassing question", "Why?", { kind: "question", anon: true });
    const seenByA = await one(A, "select * from public.get_post($1)", [q]);
    expect(seenByA).toMatchObject({ is_anonymous: true, author_id: null, author_name: null, author_username: null, is_mine: false });
    const mine = await one(B, "select * from public.get_post($1)", [q]);
    expect(mine).toMatchObject({ is_anonymous: true, author_id: null, is_mine: true });
    expect((await raw("select author_id from public.posts where id = $1", [q]))[0]!.author_id).toBeNull();
    expect((await rows(A, "select * from public.post_private_authors")).length).toBe(0);
    await fails(B, "select public.create_post($1, 'x', '', 'post', true)", [pubC]); // only questions may be anonymous
    expect((await rows(D, "select * from public.user_posts($1)", [B])).map((x) => x.id)).not.toContain(q);
    await fails(A, "select public.edit_post($1, 'hijack', '')", [q]);
    await run(B, "select public.edit_post($1, 'Embarrassing question?', 'Why?')", [q]);
    // reporting your own anonymous post is refused; others may report it
    await fails(B, "select public.report_content('post', $1, 'spam')", [q]);
    await run(A, "select public.report_content('post', $1, 'spam')", [q]);
    // the anonymous owner is notified of replies without learning more than the commenter's name
    await comment(A, q, "Here is the answer");
    expect((await notifs(B, "campus_post_reply")).some((x) => x.params.post_id === q)).toBe(true);
    expect((await rows(B, "select * from public.list_my_notifications()")).some((x) => x.params?.post_id === q && x.title === "Yeni cavab")).toBe(true); // rendered in the recipient's locale (az)
    expect((await one(B, "select public.delete_post($1) as ok", [q])).ok).toBe(true);
  });
});

describe("comments, Q&A, reactions", () => {
  let q = "";
  let ans = "";
  it("setup: C rejoins the course", async () => {
    await run(C, "select public.join_community($1)", [pubC]);
  });
  it("threaded comments with a depth cap; rate limits; text validation; edit/delete own only; tombstones keep replies", async () => {
    q = await post(B, pubC, "Thread question", "details", { kind: "question" });
    const c0 = await comment(A, q, "root");
    const c1 = await comment(B, q, "level 1", c0);
    const c2 = await comment(A, q, "level 2", c1);
    const c3 = await comment(B, q, "level 3", c2);
    expect(await fails(A, "select public.create_comment($1, 'level 4', $2)", [q, c3])).toMatch(/depth/);
    const list = await rows(C, "select * from public.post_comments($1)", [q]);
    expect(list.map((x) => x.depth)).toEqual([0, 1, 2, 3]);
    await fails(A, "select public.create_comment($1, '<b>x</b>')", [q]);
    await fails(A, "select public.create_comment($1, 'see ftp://x.example/y')", [q]);
    await fails(A, "select public.create_comment($1, '   ')", [q]);
    await fails(A, "select public.edit_comment($1, 'mine now')", [c1]);
    await run(A, "select public.edit_comment($1, 'root (edited)')", [c0]);
    await run(A, "select public.delete_comment($1)", [c0]);
    const tomb = (await rows(C, "select * from public.post_comments($1)", [q])).find((x) => x.id === c0)!;
    expect(tomb).toMatchObject({ is_deleted: true, body: null });
    await fails(D, "select public.create_comment($1, 'outsider')", [q]);
    ans = c1;
  });
  it("comment rate limit per minute and duplicate guard", async () => {
    const qq = await post(C, pubC, "Rate Q", "x", { kind: "question" });
    await setClock("2031-05-05T10:00:00Z");
    for (let i = 0; i < 5; i++) await comment(A, qq, `fast ${i}`);
    expect(await fails(A, "select public.create_comment($1, 'fast 6')", [qq])).toMatch(/rate limit/);
    await setClock("2031-05-05T10:02:00Z");
    expect(await fails(A, "select public.create_comment($1, 'fast 0')", [qq])).toMatch(/duplicate/);
    await comment(A, qq, "fast 7");
    await clearClock();
  });
  it("like + helpful: one per user, helpful only on answers, never on own content, counts and my_* flags", async () => {
    const r1 = await one(C, "select public.react('post', $1, 'like') as r", [q]);
    expect(r1.r).toMatchObject({ like_count: 1, my_like: true });
    const r2 = await one(C, "select public.react('post', $1, 'like') as r", [q]);
    expect(r2.r.like_count).toBe(1);
    await fails(C, "insert into public.reactions (user_id, post_id, kind) values ($1, $2, 'like')", [C, q]);
    await fails(B, "select public.react('post', $1, 'like')", [q]); // own post
    await fails(C, "select public.react('post', $1, 'helpful')", [q]);
    const h = await one(C, "select public.react('comment', $1, 'helpful') as r", [ans]);
    expect(h.r).toMatchObject({ helpful_count: 1, my_helpful: true });
    await fails(B, "select public.react('comment', $1, 'helpful')", [ans]); // own answer
    const lst = (await rows(C, "select * from public.post_comments($1)", [q])).find((x) => x.id === ans)!;
    expect(lst).toMatchObject({ helpful_count: 1, my_helpful: true });
    const off = await one(C, "select public.react('post', $1, 'like', false) as r", [q]);
    expect(off.r).toMatchObject({ like_count: 0, my_like: false });
    const secret = (await raw("select id from public.posts where title = 'Secret faculty plan'"))[0]!.id as string;
    await fails(D, "select public.react('post', $1, 'like')", [secret]); // cannot see it
    expect((await one(B, "select public.react('post', $1, 'like') as r", [secret])).r).toBeTruthy();
    const normalPost = await post(A, pubC, "Plain post", "no answers here");
    await fails(C, "select public.react('comment', gen_random_uuid(), 'like')");
    await fails(C, "select public.react('post', $1, 'helpful')", [normalPost]);
  });
  it("reaction milestones notify at 1, 5 and 25 only, once each, even after unlike/re-like", async () => {
    const mp = await post(A, pubC, "Milestone post", "m");
    const voters = [B, C, SITEMOD];
    for (const v of voters) if (v !== SITEMOD) await run(v, "select public.react('post', $1, 'like')", [mp]);
    // extra voters
    const extra: string[] = [];
    for (let i = 0; i < 24; i++) {
      const id = `00000000-0000-4000-8000-00000000ff${String(i).padStart(2, "0")}`;
      extra.push(id);
      await raw("insert into auth.users (id, email) values ($1, $2)", [id, `x${i}@example.test`]);
      await raw("insert into public.memberships (community_id, user_id) values ($1, $2)", [pubC, id]);
    }
    const count = async () => (await raw("select count(*)::int as n from public.notifications where user_id = $1 and template_key = 'campus_reaction_milestone' and params->>'post_id' = $2", [A, mp]))[0]!.n as number;
    expect(await count()).toBe(1);
    await run(B, "select public.react('post', $1, 'like', false)", [mp]);
    await run(B, "select public.react('post', $1, 'like')", [mp]);
    expect(await count()).toBe(1);
    for (const id of extra.slice(0, 3)) await run(id, "select public.react('post', $1, 'like')", [mp]);
    expect(await count()).toBe(2); // reached 5
    for (const id of extra.slice(3)) await run(id, "select public.react('post', $1, 'like')", [mp]);
    expect(await count()).toBe(3); // reached 25 (and not at 6..24)
    const first = (await rows(A, "select * from public.list_my_notifications(100)")).find((x) => x.params?.count === 25);
    expect(first!.body).toContain("25");
  });
  it("accepted answer: asker or community moderator; clears when the answer is deleted; not on plain posts", async () => {
    await fails(C, "select public.set_accepted_answer($1, $2)", [q, ans]);
    await run(B, "select public.set_accepted_answer($1, $2)", [q, ans]);
    expect((await one(C, "select * from public.get_post($1)", [q])).accepted_comment_id).toBe(ans);
    expect((await rows(C, "select * from public.post_comments($1)", [q])).find((x) => x.id === ans)!.is_accepted).toBe(true);
    await run(A, "select public.set_accepted_answer($1, null)", [q]); // A owns pubC, so is a community moderator
    expect((await one(C, "select * from public.get_post($1)", [q])).accepted_comment_id).toBeNull();
    await run(B, "select public.set_accepted_answer($1, $2)", [q, ans]);
    await run(B, "select public.delete_comment($1)", [ans]);
    expect((await one(C, "select * from public.get_post($1)", [q])).accepted_comment_id).toBeNull();
    const plain = await post(A, pubC, "Not a question", "x");
    await fails(A, "select public.set_accepted_answer($1, null)", [plain]);
    await fails(B, "select public.set_accepted_answer($1, $2)", [q, plain]);
  });
  it("reply notifications: post owner and parent author, never self, never across a block", async () => {
    const np = await post(C, pubC, "Notify me", "n");
    await run(B, "select public.join_community($1)", [pubC]);
    const rc = await comment(B, np, "reply from B");
    await comment(A, np, "reply to B", rc);
    const forC = await rows(C, "select * from public.list_my_notifications(100)");
    expect(forC.filter((x) => x.params?.post_id === np).length).toBe(2);
    const forB = await rows(B, "select * from public.list_my_notifications(100)");
    expect((await notifs(B, "campus_comment_reply")).length).toBe(1);
    await comment(C, np, "own thread");
    expect((await rows(C, "select * from public.list_my_notifications(100)")).filter((x) => x.params?.post_id === np).length).toBe(2);
  });
});
let cc2 = "";

describe("follows and profile", () => {
  it("follow/unfollow, counts, new-follower notification only once, no self-follow", async () => {
    await run(C, "select public.follow_user($1)", [B]);
    await run(C, "select public.unfollow_user($1)", [B]);
    await run(C, "select public.follow_user($1)", [B]);
    expect((await notifs(B, "campus_new_follower")).filter((x) => x.params.user_id === C).length).toBe(1);
    const prof = (await one(A, "select public.campus_profile($1) as p", [B])).p;
    expect(prof).toMatchObject({ follower_count: 1, is_following: false, display_name: "User2" });
    expect(Object.keys(prof).sort()).toEqual(["bio", "discoverable", "display_name", "follower_count", "following_count", "id", "is_following", "is_self", "post_count", "university_id", "university_name", "username"]);
    await fails(C, "select public.follow_user($1)", [C]);
    await fails(C, "select public.follow_user(gen_random_uuid())");
  });
  it("a non-discoverable profile hides bio/counts and disappears from people search; positive control: self still sees everything", async () => {
    await raw("update public.profiles set bio = 'Hello bio' where id = $1", [E]);
    expect((await one(A, "select public.campus_profile($1) as p", [E])).p.bio).toBe("Hello bio");
    expect((await one(A, "select public.search_campus('User5') as r")).r.people.map((x: any) => x.id)).toContain(E);
    await run(E, "select public.set_campus_discoverable(false)");
    const hidden = (await one(A, "select public.campus_profile($1) as p", [E])).p;
    expect(hidden.bio).toBeNull();
    expect(hidden.follower_count).toBeNull();
    expect(hidden.display_name).toBe("User5");
    expect((await one(A, "select public.search_campus('User5') as r")).r.people).toEqual([]);
    expect((await one(E, "select public.campus_profile($1) as p", [E])).p.bio).toBe("Hello bio");
  });
});

describe("reports and moderation", () => {
  it("categories validated, one open report per reporter+target, own content refused, resolve notifies the reporter", async () => {
    const tp = await post(B, pubC, "Spammy post", "buy now");
    const rid = (await one(C, "select public.report_content('post', $1, 'spam', 'looks like an ad') as id", [tp])).id;
    expect(await fails(C, "select public.report_content('post', $1, 'spam')", [tp])).toMatch(/already/);
    await fails(C, "select public.report_content('post', $1, 'bogus')", [tp]);
    await fails(B, "select public.report_content('post', $1, 'spam')", [tp]);
    const secret = (await raw("select id from public.posts where title = 'Secret faculty plan'"))[0]!.id as string;
    await fails(D, "select public.report_content('post', $1, 'spam')", [secret]); // cannot see it
    await run(D, "select public.report_content('user', $1, 'harassment')", [B]);
    await fails(D, "select public.report_content('user', $1, 'harassment')", [D]);
    await run(C, "select public.report_content('community', $1, 'other', 'rules are unfair')", [pubC]);
    const tc = await comment(A, tp, "a comment");
    await run(C, "select public.report_content('comment', $1, 'harassment')", [tc]);
    // community moderator queue: scoped to the community, not visible to ordinary members
    const q = await rows(A, "select * from public.community_moderation_queue($1)", [pubC]);
    expect(q.map((x) => x.target_kind).sort()).toEqual(["comment", "post", "post"]); // incl. the earlier report on the (now deleted) anonymous post; community reports are site-moderator only
    expect(q.find((x) => x.report_id === rid)).toMatchObject({ category: "spam", author_id: B });
    await fails(C, "select * from public.community_moderation_queue($1)", [pubC]);
    expect(await rows(B, "select * from public.community_moderation_queue($1)", [pubC]).catch(() => "denied")).toBe("denied");
    expect(await rows(A, "select * from public.community_moderation_queue($1)", [await mkCommunity(A, "Other Lab")])).toEqual([]);
    await fails(B, "select public.community_resolve_report($1, 'dismissed')", [rid]);
    await run(A, "select public.community_resolve_report($1, 'actioned', 'removed')", [rid]);
    await fails(A, "select public.community_resolve_report($1, 'dismissed')", [rid]);
    expect((await notifs(C, "report_resolved")).map((x) => x.params.report_id)).toEqual([rid]);
    expect((await rows(A, "select * from public.community_moderation_queue($1, 'actioned')", [pubC])).length).toBe(1);
    // existing site-wide admin path still resolves the other reports and notifies too
    const other = (await raw("select id from public.reports where community_id = $1", [pubC]))[0]!.id as string;
    await run(SITEMOD, "select public.admin_resolve_report($1, 'dismissed', 'ok')", [other]);
    expect((await raw("select status from public.reports where id = $1", [other]))[0]!.status).toBe("dismissed");
    expect((await notifs(C, "report_resolved")).length).toBe(2);
  });
  it("moderator tools: remove post/comment (own community only), ban/unban, role limits, audit trail", async () => {
    const bad = await post(B, pubC, "Offensive", "bad");
    await fails(B, "select public.mod_remove_content('post', $1, 'because')", [bad]);
    await fails(A, "select public.mod_remove_content('post', $1, 'x')", [bad]);
    const otherC = await mkCommunity(C, "C's place");
    await fails(C, "select public.mod_remove_content('post', $1, 'not mine to remove')", [bad]);
    expect(otherC).toBeTruthy();
    expect((await one(A, "select public.mod_remove_content('post', $1, 'rule 2 violation') as ok", [bad])).ok).toBe(true);
    expect(await rows(C, "select * from public.get_post($1)", [bad])).toEqual([]);
    expect((await raw("select count(*)::int as n from public.audit_logs where action = 'content.remove' and entity_id = $1", [bad]))[0]!.n).toBe(1);
    await fails(B, "select public.set_member_ban($1, $2, true)", [pubC, A]);
    await fails(A, "select public.set_member_ban($1, $2, true)", [pubC, A]);
    await run(A, "select public.set_member_ban($1, $2, true, 'spam')", [pubC, B]);
    await fails(B, "select public.create_post($1, 'banned post')", [pubC]);
    await fails(B, "select public.join_community($1)", [pubC]);
    expect((await one(B, "select public.leave_community($1) as ok", [pubC])).ok).toBe(false); // a banned member cannot shed the ban
    expect((await rows(B, "select * from public.discover_communities('Calculus')")).length).toBe(0);
    expect((await rows(A, "select * from public.community_members($1, 10, 0, 'banned')", [pubC])).map((x) => x.user_id)).toEqual([B]);
    await run(A, "select public.set_member_ban($1, $2, false)", [pubC, B]);
    expect((await one(B, "select public.join_community($1) as s", [pubC])).s).toBe("active");
    // only the owner may ban a moderator
    await raw("update public.memberships set role = 'moderator' where community_id = $1 and user_id = $2", [pubC, B]);
    await raw("insert into public.memberships (community_id, user_id) values ($1, $2) on conflict do nothing", [pubC, C]);
    await raw("update public.memberships set role = 'moderator' where community_id = $1 and user_id = $2", [pubC, C]);
    await fails(B, "select public.set_member_ban($1, $2, true)", [pubC, C]);
    await run(A, "select public.set_member_ban($1, $2, true)", [pubC, C]);
    await run(A, "select public.set_member_ban($1, $2, false)", [pubC, C]);
  });
});

describe("events and planner", () => {
  let pubEvent = "";
  let grpEvent = "";
  it("setup: B and C are plain members again", async () => {
    await raw("update public.memberships set role = 'member' where community_id = $1 and user_id in ($2, $3)", [pubC, B, C]);
  });
  it("public events start pending (moderator approves); private-group events publish immediately; past/invalid rejected", async () => {
    pubEvent = (await one(B, "select public.create_event($1, 'Open day', $2, 'Come along', 'Hall 1', null, 2, 'az') as id", [pubC, future(48)])).id;
    expect((await raw("select status from public.events where id = $1", [pubEvent]))[0]!.status).toBe("pending");
    expect(await rows(C, "select * from public.list_events()")).toEqual([]);
    expect((await rows(B, "select * from public.list_events('mine')")).length).toBe(1);
    await fails(C, "select public.moderate_event($1, true)", [pubEvent]);
    expect((await rows(A, "select * from public.list_events('pending', $1)", [pubC])).map((x) => x.id)).toEqual([pubEvent]);
    await fails(C, "select * from public.list_events('pending', $1)", [pubC]);
    expect((await one(A, "select public.moderate_event($1, true) as s", [pubEvent])).s).toBe("published");
    expect((await rows(C, "select * from public.list_events()")).map((x) => x.id)).toEqual([pubEvent]);
    grpEvent = (await one(C, "select public.create_event($1, 'Group session', $2) as id", [groupC, future(24)])).id;
    expect((await raw("select status from public.events where id = $1", [grpEvent]))[0]!.status).toBe("published");
    expect((await rows(D, "select * from public.list_events()")).map((x) => x.id)).toEqual([pubEvent]); // group event is private to members
    await fails(D, "select public.create_event($1, 'x', $2)", [pubC, future(5)]);
    await fails(B, "select public.create_event($1, 'Past', $2)", [pubC, "2001-01-01T00:00:00Z"]);
    await fails(B, "select public.create_event($1, 'Bad end', $2, null, null, $3)", [pubC, future(5), future(4)]);
    await fails(B, "select public.create_event($1, 'Zero cap', $2, null, null, null, 0)", [pubC, future(5)]);
    await fails(B, "select public.create_event($1, '<script>x</script>', $2)", [pubC, future(5)]);
  });
  it("editing a published public event returns it to review; events list is ordered with a cursor", async () => {
    expect((await one(B, "select public.edit_event($1, 'Open day 2', 'Come along', 'Hall 1', $2, null, 2) as s", [pubEvent, future(50)])).s).toBe("pending");
    await fails(C, "select public.edit_event($1, 'hijack', null, null, $2)", [pubEvent, future(50)]);
    await run(A, "select public.moderate_event($1, true)", [pubEvent]);
    const e2 = (await one(A, "select public.create_event($1, 'Earlier event', $2) as id", [pubC, future(10)])).id;
    await run(A, "select public.moderate_event($1, true)", [e2]).catch(() => undefined);
    const all = await rows(C, "select * from public.list_events('upcoming', null, 1)");
    expect(all.length).toBe(1);
    const next = await rows(C, "select * from public.list_events('upcoming', null, 5, $1, $2)", [all[0]!.starts_at, all[0]!.id]);
    expect(next.every((x) => new Date(x.starts_at) >= new Date(all[0]!.starts_at))).toBe(true);
    expect(next.map((x) => x.id)).not.toContain(all[0]!.id);
  });
  it("RSVP: going/interested/none, capacity enforced on going, interested unlimited, visibility respected", async () => {
    const r = await one(C, "select public.rsvp_event($1, 'going') as r", [pubEvent]);
    expect(r.r).toMatchObject({ going: 1, my_rsvp: "going" });
    await run(B, "select public.rsvp_event($1, 'going')", [pubEvent]);
    expect(await fails(A, "select public.rsvp_event($1, 'going')", [pubEvent])).toMatch(/full/);
    const i = await one(A, "select public.rsvp_event($1, 'interested') as r", [pubEvent]);
    expect(i.r).toMatchObject({ going: 2, interested: 1, my_rsvp: "interested" });
    expect(await fails(A, "select public.rsvp_event($1, 'going')", [pubEvent])).toMatch(/full/);
    await run(C, "select public.rsvp_event($1, 'none')", [pubEvent]);
    expect((await one(A, "select public.rsvp_event($1, 'going') as r", [pubEvent])).r.going).toBe(2);
    await fails(A, "select public.rsvp_event($1, 'maybe')", [pubEvent]);
    await fails(D, "select public.rsvp_event($1, 'going')", [grpEvent]);
    expect((await rows(A, "select * from public.list_events('going')")).map((x) => x.id)).toEqual([pubEvent]);
    const direct = await rows(A, "select * from public.event_rsvps");
    expect(direct.every((x) => x.user_id === A)).toBe(true);
  });
  it("add to planner creates one real task per user+event (idempotent)", async () => {
    const t1 = (await one(A, "select public.add_event_to_planner($1) as id", [pubEvent])).id;
    const t2 = (await one(A, "select public.add_event_to_planner($1) as id", [pubEvent])).id;
    expect(t2).toBe(t1);
    const task = (await rows(A, "select title, due_at, user_id from public.tasks where id = $1", [t1]))[0]!;
    expect(task).toMatchObject({ title: "Open day 2", user_id: A });
    expect((await rows(A, "select * from public.list_events('upcoming')")).find((x) => x.id === pubEvent)!.in_planner).toBe(true);
    expect((await rows(B, "select * from public.tasks where id = $1", [t1]))).toEqual([]);
    await fails(D, "select public.add_event_to_planner($1)", [grpEvent]);
  });
  it("cancel: creator or moderator only; event reminders are produced once per (event, user)", async () => {
    await fails(D, "select public.cancel_event($1)", [pubEvent]);
    await setClock(new Date(Date.now() + 40 * 3600_000).toISOString());
    expect(Number((await raw("select public.send_event_reminders(24) as n"))[0]!.n)).toBeGreaterThanOrEqual(1);
    expect(Number((await raw("select public.send_event_reminders(24) as n"))[0]!.n)).toBe(0);
    await clearClock();
    const reminder = (await rows(A, "select * from public.list_my_notifications(100)")).find((x) => x.params?.event_id === pubEvent);
    expect(reminder!.body).toContain("Open day 2");
    expect((await one(B, "select public.cancel_event($1) as ok", [pubEvent])).ok).toBe(true);
    expect((await rows(C, "select * from public.list_events()")).map((x) => x.id)).not.toContain(pubEvent);
    expect(await rows(C, "select * from public.get_event($1)", [pubEvent])).toEqual([]);
  });
});

describe("search and notification templates", () => {
  it("search covers communities, posts and discoverable people; short queries return nothing; blocks hide people", async () => {
    const r = (await one(A, "select public.search_campus('calc') as r")).r;
    expect(r.communities.map((x: any) => x.name)).toContain("Calculus I");
    expect((await one(A, "select public.search_campus('Thread') as r")).r.posts.length).toBeGreaterThanOrEqual(1);
    expect((await one(A, "select public.search_campus('User2') as r")).r.people.map((x: any) => x.id)).toContain(B);
    expect((await one(A, "select public.search_campus('a') as r")).r).toEqual({ communities: [], posts: [], people: [] });
    await run(B, "select public.block_user($1)", [A]);
    expect((await one(A, "select public.search_campus('User2') as r")).r.people).toEqual([]);
    await run(B, "select public.unblock_user($1)", [A]);
  });
  it("every campus template exists in az, tr, en and ru with identical placeholders", async () => {
    const t = await raw("select key, locale, title, body from public.notification_templates where key like 'campus\\_%' order by key, locale");
    const keys = [...new Set(t.map((x) => x.key))];
    expect(keys.sort()).toEqual(["campus_comment_reply", "campus_comment_reply_op", "campus_event_reminder", "campus_join_approved", "campus_join_request", "campus_new_follower", "campus_post_reply", "campus_reaction_milestone"]);
    for (const k of keys) {
      const per = t.filter((x) => x.key === k);
      expect(per.map((x) => x.locale).sort()).toEqual(["az", "en", "ru", "tr"]);
      const ph = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join();
      expect(new Set(per.map((x) => ph(x.body))).size).toBe(1);
    }
  });
});
