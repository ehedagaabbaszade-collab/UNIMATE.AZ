import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb } from "./harness";

// Migration 20260101004500 (campus hardening). Everything client-side runs as `authenticated` with auth.uid() set; every
// negative result has a positive control.

let db: PGlite;
const U = (k: number) => `00000000-0000-4000-8000-00000000e${String(k).padStart(3, "0")}`;
const [SITEMOD, A, B, C, D, E, F, G] = [U(1), U(2), U(3), U(4), U(5), U(6), U(7), U(8)];
const NAMES: Record<string, string> = { [A]: "Aysel", [B]: "Bextiyar", [C]: "Cavid" };

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
const mkCommunity = async (uid: string, name: string, kind = "course", vis = "public") =>
  (await one(uid, "select public.create_community($1, $2, $3) as id", [name, kind, vis])).id as string;
const post = async (uid: string, c: string, title: string, body = "", extra: { kind?: string; anon?: boolean } = {}) =>
  (await one(uid, "select public.create_post($1, $2, $3, $4, $5) as id", [c, title, body, extra.kind ?? "post", extra.anon ?? false])).id as string;
const comment = async (uid: string, p: string, body: string, parent: string | null = null) =>
  (await one(uid, "select public.create_comment($1, $2, $3) as id", [p, body, parent])).id as string;
const thread = (uid: string, p: string) => rows(uid, "select * from public.post_comments($1)", [p]);
const notifs = (uid: string, key: string) => raw("select params from public.notifications where user_id = $1 and template_key = $2 order by created_at", [uid, key]);

let UNI = "";
let pubC = "";

beforeAll(async () => {
  db = await createTestDb({ seed: false });
  for (const [i, u] of [SITEMOD, A, B, C, D, E, F, G].entries())
    await raw("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [u, `h${i}@example.test`, JSON.stringify({ display_name: NAMES[u] ?? `User${i}` })]);
  await raw("update public.profiles set role = 'moderator' where id = $1", [SITEMOD]);
  UNI = (await raw("select id from public.universities order by name limit 1"))[0]!.id;
  await raw("update public.profiles set university_id = $1", [UNI]);
  pubC = await mkCommunity(A, "Hardening Lab"); // A = owner = community moderator
  for (const u of [B, C, D]) await run(u, "select public.join_community($1)", [pubC]);
}, 120_000);
afterAll(async () => {
  await db.close();
});

describe("BLOCKER 1: the asker of an anonymous question stays anonymous when replying", () => {
  let q = "";
  let cAnswer = "";
  let bReply = "";
  let bTop = "";
  it("thread: asker's replies carry no author fields and is_op=true; others unchanged (positive controls)", async () => {
    q = await post(B, pubC, "Anonymous integral question", "How do I integrate?", { kind: "question", anon: true });
    cAnswer = await comment(C, q, "Try substitution");
    bReply = await comment(B, q, "Thanks, which substitution?", cAnswer);
    bTop = await comment(B, q, "Edit: it is a definite integral");
    for (const viewer of [A, C, D, B]) {
      const t = await thread(viewer, q);
      const op = t.filter((r) => r.id === bReply || r.id === bTop);
      expect(op).toHaveLength(2);
      for (const r of op) {
        expect(r).toMatchObject({ author_id: null, author_name: null, author_username: null, is_op: true });
        expect(r.is_mine).toBe(viewer === B);
      }
      const other = t.find((r) => r.id === cAnswer)!;
      expect(other).toMatchObject({ author_id: C, author_name: NAMES[C], is_op: false, is_mine: viewer === C }); // control
      expect(JSON.stringify(t)).not.toContain(B);
      expect(JSON.stringify(t)).not.toContain(NAMES[B]!);
    }
    // control: on a NON-anonymous post the author is shown (and still flagged is_op)
    const open = await post(B, pubC, "Open post", "visible author");
    const oc = await comment(B, open, "my own comment");
    expect((await thread(C, open)).find((r) => r.id === oc)).toMatchObject({ author_id: B, author_name: NAMES[B], is_op: true });
  });
  it("feed, post detail and search never expose the asker (positive control: post itself is readable)", async () => {
    const card = await rows(C, "select * from public.get_post($1)", [q]);
    expect(card).toHaveLength(1);
    expect(card[0]).toMatchObject({ author_id: null, author_name: null, is_mine: false, is_anonymous: true });
    expect((await rows(B, "select * from public.get_post($1)", [q]))[0]!.is_mine).toBe(true);
    const feed = await rows(C, "select * from public.community_feed($1)", [pubC]);
    expect(feed.find((r) => r.id === q)).toMatchObject({ author_id: null, author_name: null, author_username: null });
    const s = await one(C, "select public.search_campus('integral') as r");
    expect(s.r.posts.map((x: any) => x.id)).toContain(q);
    expect(JSON.stringify([card, feed.filter((r) => r.id === q), s.r])).not.toContain(B);
    // profile pages never list anonymous posts
    expect((await rows(C, "select * from public.user_posts($1)", [B])).map((r) => r.id)).not.toContain(q);
  });
  it("direct table reads do not reveal the asker's replies (author, site moderator and positive control still see them)", async () => {
    expect(await rows(C, "select author_id from public.comments where id = $1", [bReply])).toEqual([]);
    expect(await rows(A, "select author_id from public.comments where post_id = $1 and author_id = $2", [q, B])).toEqual([]);
    expect((await rows(B, "select author_id from public.comments where id = $1", [bReply]))[0]!.author_id).toBe(B); // own row
    expect((await rows(SITEMOD, "select author_id from public.comments where id = $1", [bReply]))).toHaveLength(1); // site staff
    expect((await rows(A, "select id from public.comments where id = $1", [cAnswer]))).toHaveLength(1); // control: ordinary comment
  });
  it("notifications: the reply notification carries neither name nor user_id for an anonymous asker", async () => {
    const n = await notifs(C, "campus_comment_reply_op");
    expect(n).toHaveLength(1);
    expect(Object.keys(n[0]!.params).sort()).toEqual(["comment_id", "community_id", "post_id", "title"]);
    expect(JSON.stringify(n[0]!.params)).not.toContain(B);
    expect(JSON.stringify(n[0]!.params)).not.toContain(NAMES[B]!);
    // the legacy key is not used for the asker's replies
    expect(await notifs(C, "campus_comment_reply")).toHaveLength(0);
    // positive control: the asker IS notified of C's answer, and that params carries C's (non-anonymous) name
    const asker = await notifs(B, "campus_post_reply");
    expect(asker.length).toBeGreaterThan(0);
    expect(asker[0]!.params).toMatchObject({ name: NAMES[C], user_id: C });
    // positive control: a non-anonymous reply keeps name + user_id under the original key
    const open = await post(A, pubC, "Open question", "x", { kind: "question" });
    const dc = await comment(D, open, "d comment");
    await comment(B, open, "b answers d", dc);
    expect((await notifs(D, "campus_comment_reply"))[0]!.params).toMatchObject({ name: NAMES[B], user_id: B });
    // rendered copy exists in every language for the new key
    const t = await raw("select locale from public.notification_templates where key = 'campus_comment_reply_op' order by locale");
    expect(t.map((x) => x.locale)).toEqual(["az", "en", "ru", "tr"]);
  });
  it("blocks cannot be used as an oracle: a viewer who blocked the asker still sees (and can react to) the anonymous reply", async () => {
    await run(D, "select public.block_user($1)", [B]);
    const t = await thread(D, q);
    expect(t.map((r) => r.id)).toContain(bReply); // not hidden by D's block
    expect((await run(D, "select public.react('comment', $1, 'helpful') as r", [bReply])).rows[0]!.r.helpful_count).toBe(1);
    await fails(D, "select public.create_comment($1, 'replying to op', $2)", [q, "00000000-0000-4000-8000-000000000000"]); // control: bogus parent still refused
    expect((await run(D, "select public.create_comment($1, 'replying to op', $2) as id", [q, bReply])).rows[0]!.id).toBeTruthy();
    // control: a NON-anonymous comment by the blocked user is hidden for the blocker
    const open = await post(B, pubC, "Open again", "x");
    const oc = await comment(B, open, "visible to others");
    expect((await thread(D, open)).map((r) => r.id)).not.toContain(oc);
    expect((await thread(C, open)).map((r) => r.id)).toContain(oc);
    await run(D, "select public.unblock_user($1)", [B]);
  });
  it("moderation queue: community moderators see the target but not the asker; ordinary authors stay visible (control)", async () => {
    await run(C, "select public.report_content('comment', $1, 'harassment', 'rude reply')", [bReply]);
    const cc = await comment(D, q, "an ordinary comment");
    await run(C, "select public.report_content('comment', $1, 'spam')", [cc]);
    const queue = await rows(A, "select * from public.community_moderation_queue($1)", [pubC]);
    const op = queue.find((r) => r.target_id === bReply)!;
    expect(op).toMatchObject({ target_kind: "comment", author_id: null });
    expect(op.excerpt).toContain("which substitution");
    expect(queue.find((r) => r.target_id === cc)!.author_id).toBe(D); // control
    expect(JSON.stringify(queue.filter((r) => r.target_id === bReply))).not.toContain(B);
    // the (anonymous) post itself, reported: author stays null
    await run(D, "select public.report_content('post', $1, 'spam')", [q]);
    expect((await rows(A, "select * from public.community_moderation_queue($1)", [pubC])).find((r) => r.target_id === q)!.author_id).toBeNull();
  });
  it("export: the asker gets their own anonymous replies; nobody else's export contains them", async () => {
    const mine = (await one(B, "select public.export_my_data() as j")).j;
    expect(mine.comments.map((c: any) => c.id)).toContain(bReply);
    expect(mine.anonymous_posts.map((p: any) => p.id)).toContain(q);
    const theirs = JSON.stringify((await one(C, "select public.export_my_data() as j")).j);
    expect(theirs).not.toContain(B);
    expect(theirs).not.toContain(NAMES[B]!);
    expect(theirs).not.toContain("anonymous_posts\":[{"); // C has no anonymous posts of their own
  });
});

describe("SHOULD-FIX 2: join_by_code is brute-force limited and codes are strong", () => {
  let group = "";
  let code = "";
  it("codes are 20 chars from the full alphabet, unique per rotation; short legacy-style codes are impossible", async () => {
    group = await mkCommunity(A, "Study squad", "group");
    code = (await one(A, "select public.get_invite_code($1) as c", [group])).c;
    expect(code).toMatch(/^[A-Z0-9]{20}$/);
    const seen = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const c = (await one(A, "select public.get_invite_code($1, true) as c", [group])).c as string;
      expect(c).toMatch(/^[A-Z0-9]{20}$/);
      seen.add(c);
      for (const ch of c) chars.add(ch);
    }
    expect(seen.size).toBe(40);
    expect(chars.size).toBeGreaterThanOrEqual(30); // 800 samples from a 36 symbol alphabet
    expect(/[A-Z]/.test([...chars].join("")) && /[0-9]/.test([...chars].join(""))).toBe(true);
    code = (await one(A, "select public.get_invite_code($1) as c", [group])).c;
    await expect(raw("update public.community_invites set code = 'ABCDEFGHIJ' where community_id = $1", [group])).rejects.toThrow(/check constraint/);
  });
  it("a miss returns null and is recorded durably; the 11th miss in an hour is throttled; the valid code is throttled too for that user", async () => {
    for (let i = 0; i < 10; i++) expect((await one(D, "select public.join_by_code($1) as id", [`WRONG${i}CODE`])).id).toBeNull();
    expect((await raw("select count(*)::int as n from public.campus_actions where user_id = $1 and kind = 'invite_miss'", [D]))[0]!.n).toBe(10);
    expect(await fails(D, "select public.join_by_code('ANOTHERWRONGCODE')")).toMatch(/too many invalid invite codes/);
    expect(await fails(D, "select public.join_by_code($1)", [code])).toMatch(/too many invalid invite codes/);
    expect((await raw("select count(*)::int as n from public.memberships where community_id = $1 and user_id = $2", [group, D]))[0]!.n).toBe(0);
    // positive control: an unrelated user is not affected by D's misses and joins with the valid code (case-insensitive)
    expect((await one(E, "select public.join_by_code($1) as id", [code.toLowerCase()])).id).toBe(group);
  });
  it("global throttle: a flood of misses across accounts stops everyone for a while, then clears", async () => {
    await raw("insert into public.campus_actions (user_id, kind) select $1, 'invite_miss' from generate_series(1, 500)", [G]);
    expect(await fails(F, "select public.join_by_code($1)", [code])).toMatch(/too many invalid invite codes/);
    await raw("delete from public.campus_actions where user_id = $1 and kind = 'invite_miss'", [G]);
    expect((await one(F, "select public.join_by_code($1) as id", [code])).id).toBe(group); // control
  });
});

describe("SHOULD-FIX 5: reports about a community are for site moderators only", () => {
  it("community moderators can neither see nor resolve them; site moderators can", async () => {
    const c = await mkCommunity(B, "Report target", "course");
    await run(A, "select public.join_community($1)", [c]);
    await run(C, "select public.join_community($1)", [c]);
    const p = await post(A, c, "A normal post", "x");
    const rPost = (await one(D, "select public.report_content('post', $1, 'spam') as id", [p])).id; // D reports a post: normal queue
    // C joined above; D is not a member but the community is public, so can report it
    const rComm = (await one(D, "select public.report_content('community', $1, 'other', 'this community is abusive') as id", [c])).id;
    const q = await rows(B, "select * from public.community_moderation_queue($1)", [c]); // B = owner
    expect(q.map((r) => r.report_id)).toEqual([rPost]); // control: post report visible, community report not
    expect(q.map((r) => r.target_kind)).not.toContain("community");
    expect(await fails(B, "select public.community_resolve_report($1, 'dismissed')", [rComm])).toMatch(/report not found/);
    expect((await one(B, "select public.community_resolve_report($1, 'dismissed') as ok", [rPost])).ok).toBe(true); // control
    expect((await raw("select status from public.reports where id = $1", [rComm]))[0]!.status).toBe("open");
    // site moderators see it and resolve it through the site-wide path
    expect((await rows(SITEMOD, "select id from public.reports where community_id = $1", [c])).map((r) => r.id)).toEqual([rComm]);
    expect((await rows(B, "select id from public.reports where community_id = $1", [c]))).toEqual([]);
    await run(SITEMOD, "select public.admin_resolve_report($1, 'dismissed', 'reviewed')", [rComm]);
    expect((await raw("select status from public.reports where id = $1", [rComm]))[0]!.status).toBe("dismissed");
  });
});

describe("SHOULD-FIX 6: direct writes cannot bypass the RPC rules", () => {
  let p1 = "";
  let anonQ = "";
  let qComment = "";
  let plainComment = "";
  const like = (uid: string, col: "post_id" | "comment_id", id: string, kind = "like") =>
    run(uid, `insert into public.reactions (user_id, ${col}, kind) values ($1, $2, $3)`, [uid, id, kind]);
  it("reactions: no self-like, 'helpful' only on question answers, others fine (positive controls)", async () => {
    p1 = await post(A, pubC, "A plain post", "x");
    anonQ = await post(B, pubC, "Anon direct question", "x", { kind: "question", anon: true });
    qComment = await comment(A, anonQ, "answer by A");
    plainComment = await comment(A, p1, "comment on plain post");
    expect(await fails(A, "insert into public.reactions (user_id, post_id, kind) values ($1, $2, 'like')", [A, p1])).toMatch(/own content/);
    expect(await fails(B, "insert into public.reactions (user_id, post_id, kind) values ($1, $2, 'like')", [B, anonQ])).toMatch(/own content/); // anonymous owner
    expect(await fails(A, "insert into public.reactions (user_id, comment_id, kind) values ($1, $2, 'like')", [A, qComment])).toMatch(/own content/);
    expect(await fails(C, "insert into public.reactions (user_id, post_id, kind) values ($1, $2, 'helpful')", [C, p1])).toMatch(/answers only/);
    expect(await fails(C, "insert into public.reactions (user_id, comment_id, kind) values ($1, $2, 'helpful')", [C, plainComment])).toMatch(/answers only/);
    expect(await fails(C, "insert into public.reactions (user_id, post_id, kind) values ($1, $2, 'funny')", [C, p1])).toMatch(/invalid reaction/);
    await like(C, "post_id", p1); // control
    await like(C, "post_id", anonQ);
    await like(C, "comment_id", qComment, "helpful");
    expect((await raw("select count(*)::int as n from public.reactions where user_id = $1", [C]))[0]!.n).toBe(3);
  });
  it("reactions: direct inserts share the 60/minute limit", async () => {
    await raw("insert into public.comments (post_id, author_id, body) select $1, $2, 'bulk ' || g from generate_series(1, 61) g", [p1, A]);
    const ids = (await raw("select id from public.comments where body like 'bulk %' order by body")).map((r) => r.id as string);
    for (const id of ids.slice(0, 60)) await like(E, "comment_id", id);
    expect(await fails(E, "insert into public.reactions (user_id, comment_id, kind) values ($1, $2, 'like')", [E, ids[60]])).toMatch(/rate limit/);
  });
  it("communities: a direct insert is forced to a private study group with an invite code, 5/day (positive control: RPC rules agree)", async () => {
    const ins = (name: string, kind = "group", vis = "public") =>
      run(F, "insert into public.communities (name, slug, visibility, kind, created_by) values ($1, $2, $3, $4, $5) returning id", [name, name.toLowerCase().replace(/ /g, "-"), vis, kind, F]);
    expect(await fails(F, "insert into public.communities (name, slug, kind, created_by) values ('Fac', 'fac-x', 'faculty', $1)", [F])).toMatch(/set by the server/);
    const first = (await ins("Direct One")).rows[0]!.id as string;
    const c = (await raw("select visibility, kind from public.communities where id = $1", [first]))[0]!;
    expect(c).toEqual({ visibility: "private", kind: "group" });
    expect((await raw("select code from public.community_invites where community_id = $1", [first]))[0]!.code).toMatch(/^[A-Z0-9]{20}$/);
    expect(await fails(F, "update public.communities set visibility = 'public' where id = $1", [first])).toMatch(/always private/);
    for (let i = 2; i <= 5; i++) await ins(`Direct ${"x".repeat(i)}`);
    expect(await fails(F, "insert into public.communities (name, slug, visibility, kind, created_by) values ('Direct six', 'direct-six', 'public', 'group', $1)", [F])).toMatch(/rate limit/);
    expect(await fails(F, "select public.create_community('Direct seven', 'group')")).toMatch(/rate limit/); // same bucket
  });
  it("memberships: no pending rows for study groups outside join_by_code; other private communities unchanged", async () => {
    const grp = await mkCommunity(A, "Private study", "group");
    const code = (await one(A, "select public.get_invite_code($1) as c", [grp])).c;
    expect(await fails(G, "insert into public.memberships (community_id, user_id, status) values ($1, $2, 'pending')", [grp, G])).toMatch(/invite code/);
    expect(await raw("select 1 from public.memberships where community_id = $1 and user_id = $2", [grp, G])).toEqual([]);
    expect((await one(G, "select public.join_by_code($1) as id", [code])).id).toBe(grp); // control: the supported path
    const priv = await mkCommunity(A, "Private faculty", "faculty", "private");
    await run(C, "insert into public.memberships (community_id, user_id, status) values ($1, $2, 'pending')", [priv, C]); // control
    expect((await raw("select status from public.memberships where community_id = $1 and user_id = $2", [priv, C]))[0]!.status).toBe("pending");
  });
});

describe("NITS", () => {
  it("campus_posts_guard pins accepted_comment_id and edited_at for direct writes; the RPC still works", async () => {
    const q = await post(A, pubC, "Pin me", "body", { kind: "question" });
    const ans = await comment(C, q, "an answer");
    await run(A, "update public.posts set accepted_comment_id = $2, edited_at = '2001-01-01' where id = $1", [q, ans]);
    expect((await raw("select accepted_comment_id, edited_at from public.posts where id = $1", [q]))[0]).toEqual({ accepted_comment_id: null, edited_at: null });
    expect((await one(A, "select public.set_accepted_answer($1, $2) as ok", [q, ans])).ok).toBe(true);
    await run(A, "update public.posts set title = 'Pin me (edited)', accepted_comment_id = null where id = $1", [q]);
    const r = (await raw("select accepted_comment_id, edited_at from public.posts where id = $1", [q]))[0]!;
    expect(r.accepted_comment_id).toBe(ans); // still accepted
    expect(new Date(r.edited_at).getFullYear()).toBeGreaterThan(2020); // server stamped, not the client value
    await run(C, "update public.comments set edited_at = '2001-01-01' where id = $1", [ans]);
    expect((await raw("select edited_at from public.comments where id = $1", [ans]))[0]!.edited_at).toBeNull();
    expect((await one(C, "select public.edit_comment($1, 'an edited answer') as ok", [ans])).ok).toBe(true); // control
    expect((await raw("select edited_at from public.comments where id = $1", [ans]))[0]!.edited_at).not.toBeNull();
  });
  it("add_event_to_planner honours blocks like rsvp_event", async () => {
    const ev = (await one(A, "select public.create_event($1, 'Block test', $2) as id", [pubC, new Date(Date.now() + 48 * 3600_000).toISOString()])).id;
    await run(A, "select public.moderate_event($1, true)", [ev]).catch(() => undefined);
    const by = (await raw("select status from public.events where id = $1", [ev]))[0]!.status;
    expect(by).toBe("published");
    await run(E, "select public.block_user($1)", [A]);
    await fails(E, "select public.rsvp_event($1, 'going')", [ev]);
    await fails(E, "select public.add_event_to_planner($1)", [ev]);
    expect(await raw("select 1 from public.event_planner_links where user_id = $1", [E])).toEqual([]);
    expect((await one(C, "select public.add_event_to_planner($1) as id", [ev])).id).toBeTruthy(); // control
    await run(E, "select public.unblock_user($1)", [A]);
  });
});
