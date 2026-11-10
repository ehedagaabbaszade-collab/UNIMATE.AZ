import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kit, newDb } from "./helpers";

// Journey (c): community -> anonymous question -> answer -> owner reply stays anonymous -> block -> report -> moderator resolves.
let db: PGlite;
let k: ReturnType<typeof kit>;

beforeAll(async () => {
  db = await newDb();
  k = kit(db);
}, 120_000);
afterAll(async () => {
  await db.close();
});

describe("campus journey", () => {
  it("anonymity, blocks and moderation hold end to end", async () => {
    const uni = (await k.raw("select id from public.universities order by name limit 1"))[0]!.id as string;
    const [owner, asker, helper, troll, outsider] = [
      await k.user({ name: "Owner", university: uni }),
      await k.user({ name: "Asker", university: uni }),
      await k.user({ name: "Helper", university: uni }),
      await k.user({ name: "Troll", university: uni }),
      await k.user({ name: "Outsider" }),
    ];
    const mod = await k.user({ role: "moderator" });

    // community: created by owner, others join
    const c = (await k.one(owner, "select public.create_community('Calculus Club', 'course', 'public') as id")).id as string;
    for (const u of [asker, helper, troll]) await k.run(u, "select public.join_community($1)", [c]);

    // anonymous question: the asker is hidden from everyone, including the feed and the thread
    const q = (await k.one(asker, "select public.create_post($1, 'Integral help', 'How do I integrate x*e^x?', 'question', true) as id", [c])).id as string;
    for (const viewer of [owner, helper, troll]) {
      const card = await k.one(viewer, "select * from public.get_post($1)", [q]);
      expect(card).toMatchObject({ is_anonymous: true, author_id: null, author_name: null, is_mine: false });
    }
    expect((await k.one(asker, "select * from public.get_post($1)", [q])).is_mine).toBe(true);
    // denial: non-anonymous posts of other kinds cannot be anonymous; outsiders cannot post
    await k.fails(asker, "select public.create_post($1, 'x', '', 'post', true)", [c]);
    await k.fails(outsider, "select public.create_post($1, 'x', '', 'post', false)", [c]);

    // answer, then the asker replies: the reply stays anonymous (is_op, no author fields), the answer shows its author
    const answer = (await k.one(helper, "select public.create_comment($1, 'Use integration by parts', null) as id", [q])).id as string;
    const reply = (await k.one(asker, "select public.create_comment($1, 'Thanks!', $2) as id", [q, answer])).id as string;
    for (const viewer of [owner, helper, troll]) {
      const thread = await k.rows(viewer, "select * from public.post_comments($1)", [q]);
      expect(thread.find((r) => r.id === reply)).toMatchObject({ author_id: null, author_name: null, is_op: true });
      expect(thread.find((r) => r.id === answer)).toMatchObject({ author_id: helper, is_op: false });
      expect(JSON.stringify(thread)).not.toContain(asker);
    }
    // the asker was notified of the answer
    expect((await k.raw("select 1 from public.notifications where user_id = $1 and template_key = 'campus_post_reply'", [asker])).length).toBeGreaterThan(0);

    // block: the troll blocks the helper -> content hidden both ways; unblock restores
    const spam = (await k.one(troll, "select public.create_post($1, 'Buy my notes now', 'cheap cheap', 'post', false) as id", [c])).id as string;
    await k.run(helper, "select public.block_user($1)", [troll]);
    expect((await k.rows(helper, "select id from public.community_feed($1)", [c])).map((r) => r.id)).not.toContain(spam);
    expect(await k.rows(troll, "select * from public.get_post($1)", [q])).not.toEqual([]); // control: troll still sees the question thread
    await k.fails(helper, "select public.follow_user($1)", [troll]);
    await k.run(helper, "select public.unblock_user($1)", [troll]);
    expect((await k.rows(helper, "select id from public.community_feed($1)", [c])).map((r) => r.id)).toContain(spam);

    // report -> denials -> moderator resolves -> reporter notified
    const rid = (await k.one(helper, "select public.report_content('post', $1, 'spam', 'looks like an ad') as id", [spam])).id as string;
    expect((await k.fails(helper, "select public.report_content('post', $1, 'spam')", [spam])).message).toMatch(/already/);
    await k.fails(troll, "select public.report_content('post', $1, 'spam')", [spam]); // own content
    await k.fails(helper, "select public.report_content('post', $1, 'bogus')", [spam]);
    await k.fails(helper, "select public.admin_resolve_report($1, 'dismissed', 'no')", [rid]); // students cannot resolve
    await k.run(mod, "select public.admin_resolve_report($1, 'actioned', 'removed as spam')", [rid]);
    expect((await k.raw("select status from public.reports where id = $1", [rid]))[0]!.status).toBe("actioned");
    await k.fails(mod, "select public.admin_resolve_report($1, 'dismissed', 'again')", [rid]); // already resolved
    expect((await k.raw("select params from public.notifications where user_id = $1 and template_key = 'report_resolved'", [helper])).length).toBe(1);
  }, 60_000);
});
