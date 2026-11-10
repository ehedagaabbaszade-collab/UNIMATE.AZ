import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb } from "./harness";

// Migration 20260101004520: export_my_data covers campus, notes, gamification and settings; two-user fixture proves that
// nothing of the other user leaks into either export (every marker is unique to its owner).

let db: PGlite;
const U = (k: number) => `00000000-0000-4000-8000-00000000c${String(k).padStart(3, "0")}`;
const [ALICE, BOB] = [U(1), U(2)];
const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const rows = async (uid: string, sql: string, params: unknown[] = []) => (await asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params))).rows;
const one = async (uid: string, sql: string, params: unknown[] = []) => (await rows(uid, sql, params))[0]!;
const exportOf = async (uid: string) => (await one(uid, "select public.export_my_data() as j")).j as Record<string, any>;

const NAMES = JSON.stringify({ az: "a", tr: "b", en: "c", ru: "d" });
let pub = "";
let aliceAnonQ = "";
let bobAnonQ = "";
let aliceAnonReply = "";
let bobAnonReply = "";
let aliceEvent = "";
let bobEvent = "";

beforeAll(async () => {
  db = await createTestDb({ seed: false });
  for (const [u, name] of [[ALICE, "Alice-ZED"], [BOB, "Bob-QUX"]] as const)
    await raw("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [u, `${name}@example.test`, JSON.stringify({ display_name: name })]);
  const uni = (await raw("select id from public.universities order by name limit 1"))[0]!.id;
  await raw("update public.profiles set university_id = $1 where id in ($2, $3)", [uni, ALICE, BOB]);
  await raw("update public.profiles set leaderboard_opt_in = true where id = $1", [ALICE]);

  pub = (await one(ALICE, "select public.create_community('Export lab', 'course', 'public') as id")).id;
  await rows(BOB, "select public.join_community($1)", [pub]);
  // both users: a normal post, an anonymous question, comments (incl. the asker's replies), reactions, follows
  await rows(ALICE, "select public.create_post($1, 'ALICE-POST-MARK', 'alice body')", [pub]);
  await rows(BOB, "select public.create_post($1, 'BOB-POST-MARK', 'bob body')", [pub]);
  aliceAnonQ = (await one(ALICE, "select public.create_post($1, 'ALICE-ANON-MARK', 'x', 'question', true) as id", [pub])).id;
  bobAnonQ = (await one(BOB, "select public.create_post($1, 'BOB-ANON-MARK', 'x', 'question', true) as id", [pub])).id;
  await one(BOB, "select public.create_comment($1, 'BOB-ANSWER-MARK') as id", [aliceAnonQ]);
  aliceAnonReply = (await one(ALICE, "select public.create_comment($1, 'ALICE-ANON-REPLY-MARK') as id", [aliceAnonQ])).id;
  await one(ALICE, "select public.create_comment($1, 'ALICE-ANSWER-MARK') as id", [bobAnonQ]);
  bobAnonReply = (await one(BOB, "select public.create_comment($1, 'BOB-ANON-REPLY-MARK') as id", [bobAnonQ])).id;
  await rows(BOB, "select public.react('post', $1, 'like')", [aliceAnonQ]);
  await rows(ALICE, "select public.react('post', $1, 'like')", [bobAnonQ]);
  await rows(ALICE, "select public.follow_user($1)", [BOB]);
  await rows(BOB, "select public.follow_user($1)", [ALICE]);
  // events + RSVPs (each RSVPs to the other's event too)
  const when = new Date(Date.now() + 72 * 3600_000).toISOString();
  aliceEvent = (await one(ALICE, "select public.create_event($1, 'ALICE-EVENT-MARK', $2) as id", [pub, when])).id;
  bobEvent = (await one(BOB, "select public.create_event($1, 'BOB-EVENT-MARK', $2) as id", [pub, when])).id;
  await raw("update public.events set status = 'published'");
  await rows(ALICE, "select public.rsvp_event($1, 'going')", [bobEvent]);
  await rows(BOB, "select public.rsvp_event($1, 'interested')", [aliceEvent]);
  await rows(ALICE, "select public.add_event_to_planner($1)", [bobEvent]);
  // resources + ratings + saves
  for (const [u, tag] of [[ALICE, "ALICE"], [BOB, "BOB"]] as const) {
    await raw("insert into storage.objects (bucket_id, name, owner, metadata) values ('resources', $1, $2, '{\"size\":10,\"mimetype\":\"application/pdf\",\"eTag\":\"e\"}')", [`${u}/${tag}.pdf`, u]);
    await one(u, "select public.create_resource($1, null, 'note', null, 'public', '{}', $2, 'application/pdf', 10, 'f.pdf') as id", [`${tag}-RES-MARK`, `${u}/${tag}.pdf`]);
  }
  await raw("update public.resources set status = 'published'");
  const resOf = async (u: string) => (await raw("select id from public.resources where uploader_id = $1", [u]))[0]!.id as string;
  await rows(ALICE, "select public.rate_resource($1, 5, 'ALICE-RATING-MARK')", [await resOf(BOB)]);
  await rows(BOB, "select public.rate_resource($1, 4, 'BOB-RATING-MARK')", [await resOf(ALICE)]);
  await raw("insert into public.resource_saves (resource_id, user_id) values ($1, $2), ($3, $4)", [await resOf(BOB), ALICE, await resOf(ALICE), BOB]);
  // gamification
  const ach = (await raw("select id from public.achievements order by code limit 2")).map((r) => r.id as string);
  await raw("insert into public.user_achievements (user_id, achievement_id) values ($1, $2), ($3, $4)", [ALICE, ach[0], BOB, ach[1]]);
  const ch = (await raw("insert into public.challenges (title, description, criteria, starts_at, ends_at) values ($1::jsonb, $1::jsonb, '{\"metric\":\"xp\",\"target\":5}', now() - interval '1 day', now() + interval '2 days') returning id", [NAMES]))[0]!.id as string;
  await raw("insert into public.user_challenge_progress (user_id, challenge_id, progress) values ($1, $2, 3), ($3, $2, 9)", [ALICE, ch, BOB]);
  // career
  await raw("insert into public.cv_documents (user_id, title) values ($1, 'ALICE-CV-MARK'), ($2, 'BOB-CV-MARK')", [ALICE, BOB]);
}, 120_000);
afterAll(async () => {
  await db.close();
});

describe("export_my_data (campus extension)", () => {
  it("contains the caller's campus content, including anonymous posts and replies they wrote", async () => {
    const e = await exportOf(ALICE);
    expect(e.posts.map((p: any) => p.title)).toContain("ALICE-POST-MARK");
    expect(e.anonymous_posts.map((p: any) => p.id)).toEqual([aliceAnonQ]);
    expect(e.comments.map((c: any) => c.id)).toContain(aliceAnonReply);
    expect(e.reactions.map((r: any) => r.post_id)).toContain(bobAnonQ);
    expect(e.following.map((f: any) => f.followee_id)).toEqual([BOB]);
    expect(e.memberships.map((m: any) => m.community_id)).toContain(pub);
    expect(e.event_rsvps.map((r: any) => [r.event_id, r.status])).toEqual([[bobEvent, "going"]]);
    expect(e.event_planner_links.map((l: any) => l.event_id)).toEqual([bobEvent]);
    expect(e.events_created.map((x: any) => x.title)).toEqual(["ALICE-EVENT-MARK"]);
    expect(e.resources.map((r: any) => r.title)).toEqual(["ALICE-RES-MARK"]);
    expect(e.resource_ratings.map((r: any) => r.comment)).toEqual(["ALICE-RATING-MARK"]);
    expect(e.resource_saves).toHaveLength(1);
    expect(e.achievements).toHaveLength(1);
    expect(e.challenge_progress.map((p: any) => p.progress)).toEqual([3]);
    expect(e.leaderboard_opt_in).toBe(true);
    expect(e.follower_count).toBe(1);
    expect(e.campus_discoverable).toBe(true);
    // the pre-existing export keys still work (regression for the wrapper chain)
    expect(e.profile.id).toBe(ALICE);
    expect(Array.isArray(e.cv_documents) && Array.isArray(e.opportunity_tracking)).toBe(true);
    // control: Bob's own export shows Bob's side (so the filters are not simply returning nothing)
    const b = await exportOf(BOB);
    expect(b.leaderboard_opt_in).toBe(false);
    expect(b.anonymous_posts.map((p: any) => p.id)).toEqual([bobAnonQ]);
    expect(b.challenge_progress.map((p: any) => p.progress)).toEqual([9]);
  });

  it("nothing of the other user leaks (markers, ids, anonymous authorship)", async () => {
    const a = JSON.stringify(await exportOf(ALICE));
    const b = JSON.stringify(await exportOf(BOB));
    for (const m of ["BOB-POST-MARK", "BOB-ANON-MARK", "BOB-ANON-REPLY-MARK", "BOB-RES-MARK", "BOB-RATING-MARK", "BOB-CV-MARK"]) {
      // (Alice's own planner task copy of Bob's public event and her notifications naming Bob are Alice's data, so those markers are not checked.)
      expect(a, `alice export contains ${m}`).not.toContain(m);
    }
    for (const m of ["ALICE-POST-MARK", "ALICE-ANON-MARK", "ALICE-ANON-REPLY-MARK", "ALICE-EVENT-MARK", "ALICE-RES-MARK", "ALICE-RATING-MARK", "ALICE-CV-MARK"]) {
      expect(b, `bob export contains ${m}`).not.toContain(m);
    }
    // anonymous authorship: Alice's anonymous question/reply ids are not in Bob's export as his, and Bob's id is not in hers as an author
    expect((await exportOf(BOB)).anonymous_posts.map((p: any) => p.id)).not.toContain(aliceAnonQ);
    expect((await exportOf(BOB)).comments.map((c: any) => c.id)).not.toContain(aliceAnonReply);
    expect((await exportOf(ALICE)).comments.map((c: any) => c.id)).not.toContain(bobAnonReply);
    expect((await exportOf(ALICE)).event_rsvps.every((r: any) => r.user_id === ALICE)).toBe(true);
  });
});
