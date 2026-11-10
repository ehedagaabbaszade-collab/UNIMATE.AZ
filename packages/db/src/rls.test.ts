import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { affected, asAnon, asService, asUser, createTestDb, ids, seedFixtures, select, vec } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await seedFixtures(db);
}, 120_000);

afterAll(async () => {
  await db.close();
});

const A = ids.alice;
const B = ids.bob;

/** Superuser read (bypasses RLS) used to prove a denied write really changed nothing. */
const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;

describe("owner-only: documents", () => {
  it("owner can read own documents and only them", async () => {
    const rows = await select(db, "authenticated", A, "select id from public.documents");
    expect(rows.map((r) => r.id)).toEqual([ids.docA]);
  });
  it("user A cannot read user B's document by id", async () => {
    expect(await select(db, "authenticated", A, "select id from public.documents where id = $1", [ids.docB])).toEqual([]);
  });
  it("user A cannot update user B's document (0 rows, row unchanged)", async () => {
    const n = await affected(db, "authenticated", A, "update public.documents set title = 'pwned' where id = $1", [ids.docB]);
    expect(n).toBe(0);
    expect((await raw("select title from public.documents where id = $1", [ids.docB]))[0]?.title).toBe("Bob doc");
  });
  it("user A cannot delete user B's document (0 rows, row still exists)", async () => {
    expect(await affected(db, "authenticated", A, "delete from public.documents where id = $1", [ids.docB])).toBe(0);
    expect(await raw("select 1 from public.documents where id = $1", [ids.docB])).toHaveLength(1);
  });
  it("user A cannot insert a document owned by B", async () => {
    await expect(
      asUser(db, A, (tx) =>
        tx.query(
          "insert into public.documents (user_id, title, storage_path, idempotency_key) values ($1, 't', $2, 'idem-forged-1')",
          [B, `${B}/forged.pdf`],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it("positive control: owner can update own title and mark upload complete", async () => {
    expect(await affected(db, "authenticated", A, "update public.documents set title = 'Alice doc v2' where id = $1", [ids.docA])).toBe(1);
    expect(await affected(db, "authenticated", A, "update public.documents set status = 'uploaded' where id = $1", [ids.docA])).toBe(1);
  });
  it("owner cannot self-set pipeline-owned status or page_count", async () => {
    await expect(asUser(db, A, (tx) => tx.query("update public.documents set status = 'ready' where id = $1", [ids.docA]))).rejects.toThrow(/pipeline/);
    await expect(asUser(db, A, (tx) => tx.query("update public.documents set page_count = 5 where id = $1", [ids.docA]))).rejects.toThrow(/immutable/);
  });
});

describe("owner-only: document_chunks", () => {
  it("owner reads own chunks only", async () => {
    const rows = await select(db, "authenticated", A, "select id from public.document_chunks order by chunk_index");
    expect(rows.map((r) => r.id)).toEqual([ids.chunkA0, ids.chunkA1]);
  });
  it("user A cannot read B's chunk", async () => {
    expect(await select(db, "authenticated", A, "select id from public.document_chunks where id = $1", [ids.chunkB0])).toEqual([]);
  });
  it("user A cannot update B's chunk", async () => {
    expect(await affected(db, "authenticated", A, "update public.document_chunks set content = 'x' where id = $1", [ids.chunkB0])).toBe(0);
    expect((await raw("select content from public.document_chunks where id = $1", [ids.chunkB0]))[0]?.content).toBe("bob chunk zero");
  });
  it("user A cannot delete B's chunk", async () => {
    expect(await affected(db, "authenticated", A, "delete from public.document_chunks where id = $1", [ids.chunkB0])).toBe(0);
    expect(await raw("select 1 from public.document_chunks where id = $1", [ids.chunkB0])).toHaveLength(1);
  });
  it("API roles cannot insert chunks (pipeline only), even into their own document", async () => {
    await expect(
      asUser(db, A, (tx) => tx.query("insert into public.document_chunks (document_id, chunk_index, content) values ($1, 99, 'x')", [ids.docA])),
    ).rejects.toThrow(/permission denied/);
  });
  it("positive control: owner can delete own chunk", async () => {
    await db.query("insert into public.document_chunks (document_id, chunk_index, content) values ($1, 50, 'temp')", [ids.docA]);
    expect(await affected(db, "authenticated", A, "delete from public.document_chunks where document_id = $1 and chunk_index = 50", [ids.docA])).toBe(1);
  });
});

describe("match_chunks", () => {
  const call = (uid: string | null, doc: string, role: "authenticated" | "anon" = "authenticated") =>
    select(db, role, uid, "select id, similarity from public.match_chunks($1::extensions.vector, $2::uuid, 5)", [vec(0), doc]);

  it("owner gets nearest chunks first", async () => {
    const rows = await call(A, ids.docA);
    expect(rows.map((r) => r.id)).toEqual([ids.chunkA0, ids.chunkA1]);
    expect(Number(rows[0]?.similarity)).toBeCloseTo(1, 5);
  });
  it("user B gets nothing for A's document", async () => {
    expect(await call(B, ids.docA)).toEqual([]);
  });
  it("anon cannot execute it", async () => {
    expect(await call(null, ids.docA, "anon")).toEqual([]);
  });
  it("is security invoker", async () => {
    const r = await raw("select prosecdef from pg_proc where proname = 'match_chunks'");
    expect(r[0]?.prosecdef).toBe(false);
  });
});

describe("owner-only: messages", () => {
  it("owner reads own messages only", async () => {
    const rows = await select(db, "authenticated", A, "select id from public.messages");
    expect(rows.map((r) => r.id)).toEqual([ids.msgA]);
  });
  it("user A cannot read B's message", async () => {
    expect(await select(db, "authenticated", A, "select id from public.messages where id = $1", [ids.msgB])).toEqual([]);
  });
  it("user A cannot update B's message", async () => {
    expect(await affected(db, "authenticated", A, "update public.messages set content = 'x' where id = $1", [ids.msgB])).toBe(0);
    expect((await raw("select content from public.messages where id = $1", [ids.msgB]))[0]?.content).toBe("bob secret question");
  });
  it("user A cannot delete B's message", async () => {
    expect(await affected(db, "authenticated", A, "delete from public.messages where id = $1", [ids.msgB])).toBe(0);
    expect(await raw("select 1 from public.messages where id = $1", [ids.msgB])).toHaveLength(1);
  });
  it("user A cannot post into B's conversation", async () => {
    await expect(
      asUser(db, A, (tx) => tx.query("insert into public.messages (conversation_id, role, content) values ($1, 'user', 'hi')", [ids.convB])),
    ).rejects.toThrow(/row-level security/);
  });
  it("positive control: owner can post into own conversation and set feedback", async () => {
    await asUser(db, A, (tx) => tx.query("insert into public.messages (conversation_id, role, content) values ($1, 'user', 'ok')", [ids.convA]));
    expect(await affected(db, "authenticated", A, "update public.messages set feedback = 1 where id = $1", [ids.msgA])).toBe(1);
  });
});

describe("owner-only: ai_usage", () => {
  it("owner sees only own usage", async () => {
    const rows = await select(db, "authenticated", A, "select id from public.ai_usage");
    expect(rows.map((r) => r.id)).toEqual([ids.usageA]);
  });
  it("user A cannot read, update or delete B's usage", async () => {
    expect(await select(db, "authenticated", A, "select id from public.ai_usage where id = $1", [ids.usageB])).toEqual([]);
    expect(await affected(db, "authenticated", A, "update public.ai_usage set input_tokens = 0 where id = $1", [ids.usageB])).toBe(0);
    expect(await affected(db, "authenticated", A, "delete from public.ai_usage where id = $1", [ids.usageB])).toBe(0);
    expect((await raw("select input_tokens from public.ai_usage where id = $1", [ids.usageB]))[0]?.input_tokens).toBe(20);
  });
  it("users cannot write their own usage either (service only)", async () => {
    expect(await affected(db, "authenticated", A, "update public.ai_usage set input_tokens = 0 where id = $1", [ids.usageA])).toBe(0);
    await expect(
      asUser(db, A, (tx) => tx.query("insert into public.ai_usage (user_id, feature) values ($1, 'chat')", [A])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("communities and posts", () => {
  it("non-member cannot read private community or its posts", async () => {
    expect(await select(db, "authenticated", B, "select id from public.posts where community_id = $1", [ids.privCommunity])).toEqual([]);
    expect(await select(db, "authenticated", B, "select id from public.communities where id = $1", [ids.privCommunity])).toEqual([]);
  });
  it("members can read private posts (positive control)", async () => {
    const carol = await select(db, "authenticated", ids.carol, "select id from public.posts where community_id = $1", [ids.privCommunity]);
    expect(carol.map((r) => r.id)).toEqual([ids.privPost]);
    expect(await select(db, "authenticated", A, "select id from public.posts where community_id = $1", [ids.privCommunity])).toHaveLength(1);
  });
  it("non-member cannot post into a private community", async () => {
    await expect(
      asUser(db, B, (tx) => tx.query("insert into public.posts (community_id, author_id, title, body) values ($1, $2, 't', 'b')", [ids.privCommunity, B])),
    ).rejects.toThrow(/row-level security/);
  });
  it("joining a private community only yields a pending membership, which grants no read access", async () => {
    // the fixture community defaults to kind 'group' (invite-only since migration 4500); this test is about plain private communities
    await db.query("update public.communities set kind = 'course' where id = $1", [ids.privCommunity]);
    await expect(
      asUser(db, B, (tx) => tx.query("insert into public.memberships (community_id, user_id, status) values ($1, $2, 'active')", [ids.privCommunity, B])),
    ).rejects.toThrow(/row-level security/);
    await asUser(db, B, (tx) => tx.query("insert into public.memberships (community_id, user_id, status) values ($1, $2, 'pending')", [ids.privCommunity, B]));
    expect(await select(db, "authenticated", B, "select id from public.posts where community_id = $1", [ids.privCommunity])).toEqual([]);
    await db.query("delete from public.memberships where community_id = $1 and user_id = $2", [ids.privCommunity, B]);
    await db.query("update public.communities set kind = 'group' where id = $1", [ids.privCommunity]);
  });
  it("anyone authenticated can read public community posts", async () => {
    expect(await select(db, "authenticated", B, "select id from public.posts where id = $1", [ids.pubPost])).toHaveLength(1);
  });
  it("a banned member cannot leave to dodge the ban", async () => {
    await db.query("insert into public.memberships (community_id, user_id, status) values ($1, $2, 'banned')", [ids.pubCommunity, B]);
    expect(await affected(db, "authenticated", B, "delete from public.memberships where community_id = $1 and user_id = $2", [ids.pubCommunity, B])).toBe(0);
    await db.query("delete from public.memberships where community_id = $1 and user_id = $2", [ids.pubCommunity, B]);
  });
});

describe("blocks", () => {
  it("a blocked user cannot see the blocker's posts, others still can", async () => {
    expect(await select(db, "authenticated", B, "select id from public.posts where id = $1", [ids.pubPost])).toHaveLength(1);
    await asUser(db, A, (tx) => tx.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [A, B]));
    expect(await select(db, "authenticated", B, "select id from public.posts where id = $1", [ids.pubPost])).toEqual([]);
    expect(await select(db, "authenticated", ids.carol, "select id from public.posts where id = $1", [ids.pubPost])).toHaveLength(1);
    // the author still sees their own post
    expect(await select(db, "authenticated", A, "select id from public.posts where id = $1", [ids.pubPost])).toHaveLength(1);
  });
  it("the blocked user cannot see the block row itself", async () => {
    expect(await select(db, "authenticated", B, "select * from public.blocks")).toEqual([]);
    expect(await select(db, "authenticated", A, "select * from public.blocks")).toHaveLength(1);
  });
  it("the blocked user cannot see the blocker's profile or follow them", async () => {
    expect(await select(db, "authenticated", B, "select id from public.profiles where id = $1", [A])).toEqual([]);
    await expect(
      asUser(db, B, (tx) => tx.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [B, A])),
    ).rejects.toThrow(/row-level security/);
  });
  it("unblocking restores visibility", async () => {
    expect(await affected(db, "authenticated", A, "delete from public.blocks where blocker_id = $1 and blocked_id = $2", [A, B])).toBe(1);
    expect(await select(db, "authenticated", B, "select id from public.posts where id = $1", [ids.pubPost])).toHaveLength(1);
  });
});

describe("role escalation", () => {
  const role = async (id: string) => (await raw("select role from public.profiles where id = $1", [id]))[0]?.role;

  it("a student cannot promote themselves to admin", async () => {
    await expect(asUser(db, A, (tx) => tx.query("update public.profiles set role = 'admin' where id = $1", [A]))).rejects.toThrow(/super_admin/);
    expect(await role(A)).toBe("student");
  });
  it("a student cannot promote themselves to moderator or super_admin", async () => {
    await expect(asUser(db, A, (tx) => tx.query("update public.profiles set role = 'moderator' where id = $1", [A]))).rejects.toThrow();
    await expect(asUser(db, A, (tx) => tx.query("update public.profiles set role = 'super_admin' where id = $1", [A]))).rejects.toThrow();
    expect(await role(A)).toBe("student");
  });
  it("a student cannot promote someone else", async () => {
    expect(await affected(db, "authenticated", A, "update public.profiles set role = 'admin' where id = $1", [B])).toBe(0);
    expect(await role(B)).toBe("student");
  });
  it("a moderator cannot self-promote", async () => {
    await expect(asUser(db, ids.mod, (tx) => tx.query("update public.profiles set role = 'admin' where id = $1", [ids.mod]))).rejects.toThrow();
    expect(await role(ids.mod)).toBe("moderator");
  });
  it("a new profile cannot be inserted with an elevated role", async () => {
    const uid = "00000000-0000-4000-8000-0000000000ee";
    await db.query("insert into auth.users (id) values ($1)", [uid]);
    await db.query("delete from public.profiles where id = $1", [uid]);
    await expect(
      asUser(db, uid, (tx) => tx.query("insert into public.profiles (id, role) values ($1, 'admin')", [uid])),
    ).rejects.toThrow(/role student/);
  });
  it("an admin can grant moderator but not admin; a super_admin can", async () => {
    await asUser(db, ids.admin, (tx) => tx.query("update public.profiles set role = 'moderator' where id = $1", [B]));
    expect(await role(B)).toBe("moderator");
    await expect(asUser(db, ids.admin, (tx) => tx.query("update public.profiles set role = 'admin' where id = $1", [B]))).rejects.toThrow(/super_admin/);
    await asUser(db, ids.superAdmin, (tx) => tx.query("update public.profiles set role = 'admin' where id = $1", [B]));
    expect(await role(B)).toBe("admin");
    await db.query("update public.profiles set role = 'student' where id = $1", [B]);
  });
  it("positive control: a student can edit their own display name", async () => {
    expect(await affected(db, "authenticated", A, "update public.profiles set display_name = 'Alice A' where id = $1", [A])).toBe(1);
  });
  it("a student cannot edit someone else's profile", async () => {
    expect(await affected(db, "authenticated", A, "update public.profiles set display_name = 'x' where id = $1", [B])).toBe(0);
  });
});

describe("anonymous questions", () => {
  let anonPost = "";

  it("a member can post an anonymous question, and the public row has no author", async () => {
    anonPost = await asUser(db, A, async (tx) => {
      const r = await tx.query<{ id: string }>("select public.create_anonymous_post($1, 'Why?', 'Anyone know?') as id", [ids.pubCommunity]);
      return r.rows[0]!.id;
    });
    const rows = await select(db, "authenticated", B, "select id, author_id, is_anonymous from public.posts where id = $1", [anonPost]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.author_id).toBeNull();
    expect(rows[0]?.is_anonymous).toBe(true);
  });
  it("no column of the post row, as seen by another user, contains the author's id", async () => {
    const rows = await select(db, "authenticated", B, "select row_to_json(p)::text as j from public.posts p where id = $1", [anonPost]);
    expect(rows[0]?.j).not.toContain(A);
  });
  it("other users cannot read the private author mapping", async () => {
    expect(await select(db, "authenticated", B, "select * from public.post_private_authors")).toEqual([]);
    expect(await select(db, "authenticated", ids.carol, "select * from public.post_private_authors")).toEqual([]);
  });
  it("the author can still see, and edit, their own anonymous post", async () => {
    expect(await select(db, "authenticated", A, "select id from public.posts where id = $1", [anonPost])).toHaveLength(1);
    expect(await select(db, "authenticated", A, "select author_id from public.post_private_authors where post_id = $1", [anonPost])).toHaveLength(1);
    expect(await affected(db, "authenticated", A, "update public.posts set body = 'edited' where id = $1", [anonPost])).toBe(1);
  });
  it("other users cannot edit or delete it", async () => {
    expect(await affected(db, "authenticated", B, "update public.posts set body = 'x' where id = $1", [anonPost])).toBe(0);
    expect(await affected(db, "authenticated", B, "delete from public.posts where id = $1", [anonPost])).toBe(0);
  });
  it("users cannot forge anonymous rows directly or write the mapping table", async () => {
    await expect(
      asUser(db, B, (tx) =>
        tx.query("insert into public.posts (community_id, author_id, is_anonymous, kind, title, body) values ($1, null, true, 'question', 't', 'b')", [ids.pubCommunity]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, B, (tx) => tx.query("insert into public.post_private_authors (post_id, author_id) values ($1, $2)", [anonPost, B])),
    ).rejects.toThrow(/permission denied/);
  });
  it("authorship cannot be rewritten after the fact", async () => {
    await expect(asUser(db, A, (tx) => tx.query("update public.posts set author_id = $2, is_anonymous = false where id = $1", [anonPost, A]))).rejects.toThrow(/immutable/);
  });
  it("a non-member cannot post anonymously into a community; anon role cannot call the function", async () => {
    await expect(asUser(db, B, (tx) => tx.query("select public.create_anonymous_post($1, 't', 'b')", [ids.privCommunity]))).rejects.toThrow(/member/);
    await expect(asAnon(db, (tx) => tx.query("select public.create_anonymous_post($1, 't', 'b')", [ids.pubCommunity]))).rejects.toThrow(/permission denied/);
  });
  it("a block does not leak the anonymous author (post stays visible)", async () => {
    await db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [A, B]);
    expect(await select(db, "authenticated", B, "select id from public.posts where id = $1", [anonPost])).toHaveLength(1);
    await db.query("delete from public.blocks");
  });
});

describe("audit_logs, processing_jobs: service_role writes only", () => {
  it("service_role can append audit logs", async () => {
    await asService(db, (tx) => tx.query("insert into public.audit_logs (actor_id, action) values ($1, 'test.event')", [ids.admin]));
    expect(await raw("select 1 from public.audit_logs")).toHaveLength(1);
  });
  it("students and moderators cannot read audit_logs", async () => {
    expect(await select(db, "authenticated", A, "select * from public.audit_logs")).toEqual([]);
    expect(await select(db, "authenticated", ids.mod, "select * from public.audit_logs")).toEqual([]);
  });
  it("admins can read audit_logs", async () => {
    expect(await select(db, "authenticated", ids.admin, "select * from public.audit_logs")).toHaveLength(1);
  });
  it("nobody but service_role can write audit_logs; and not even it can alter history", async () => {
    await expect(asUser(db, ids.admin, (tx) => tx.query("insert into public.audit_logs (action) values ('forged')"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, A, (tx) => tx.query("insert into public.audit_logs (action) values ('forged')"))).rejects.toThrow(/permission denied/);
    await expect(asService(db, (tx) => tx.query("update public.audit_logs set action = 'x'"))).rejects.toThrow(/append-only/);
    await expect(asService(db, (tx) => tx.query("delete from public.audit_logs"))).rejects.toThrow(/append-only/);
  });
  it("service_role can enqueue jobs; owners can see them but not write", async () => {
    await asService(db, (tx) =>
      tx.query("insert into public.processing_jobs (document_id, user_id, kind, idempotency_key) values ($1, $2, 'extract_text', 'job-alice-0001')", [ids.docA, A]),
    );
    expect(await select(db, "authenticated", A, "select state from public.processing_jobs")).toHaveLength(1);
    expect(await select(db, "authenticated", B, "select state from public.processing_jobs")).toEqual([]);
    await expect(
      asUser(db, A, (tx) => tx.query("insert into public.processing_jobs (document_id, user_id, kind, idempotency_key) values ($1, $2, 'embed', 'job-alice-0002')", [ids.docA, A])),
    ).rejects.toThrow(/permission denied/);
    expect(await affected(db, "authenticated", A, "update public.processing_jobs set state = 'succeeded'")).toBe(0);
    expect(await affected(db, "authenticated", A, "delete from public.processing_jobs")).toBe(0);
  });
  it("job idempotency_key is unique", async () => {
    await expect(
      asService(db, (tx) => tx.query("insert into public.processing_jobs (document_id, user_id, kind, idempotency_key) values ($1, $2, 'chunk', 'job-alice-0001')", [ids.docA, A])),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("unauthenticated access", () => {
  const tables = ["documents", "document_chunks", "messages", "ai_usage", "profiles", "posts", "communities", "audit_logs", "processing_jobs", "notifications", "subscriptions", "tasks"];
  it.each(tables)("anon reads nothing from %s", async (t) => {
    expect(await select(db, "anon", null, `select * from public.${t}`)).toEqual([]);
  });
  it.each(["documents", "messages", "posts", "ai_usage", "profiles"])("authenticated role with no subject (auth.uid() is null) reads nothing from %s", async (t) => {
    expect(await select(db, "authenticated", null, `select * from public.${t}`)).toEqual([]);
  });
  it("anon cannot insert or write", async () => {
    await expect(asAnon(db, (tx) => tx.query("insert into public.documents (user_id, title, storage_path, idempotency_key) values ($1, 't', $2, 'idem-anon-001')", [A, `${A}/x.pdf`]))).rejects.toThrow(/permission denied/);
    expect(await affected(db, "anon", null, "update public.documents set title = 'x'")).toBe(0);
    expect(await affected(db, "anon", null, "delete from public.documents")).toBe(0);
  });
  it("anon can read the public university list (needed for sign-up) but not modify it", async () => {
    await db.query("insert into public.universities (name) values ('Test University')");
    expect((await select(db, "anon", null, "select name from public.universities")).length).toBeGreaterThan(0);
    await expect(asAnon(db, (tx) => tx.query("insert into public.universities (name) values ('Evil U')"))).rejects.toThrow(/permission denied/);
    expect(await affected(db, "authenticated", A, "update public.universities set name = 'x'")).toBe(0);
  });
});

describe("storage.objects owner-folder policies (against a stubbed storage schema)", () => {
  it("the documents bucket exists and is private", async () => {
    const r = await raw("select public from storage.buckets where id = 'documents'");
    expect(r).toEqual([{ public: false }]);
  });
  it("a user can write into their own folder only", async () => {
    await asUser(db, A, (tx) => tx.query("insert into storage.objects (bucket_id, name, owner) values ('documents', $1, $2)", [`${A}/note.pdf`, A]));
    await expect(
      asUser(db, A, (tx) => tx.query("insert into storage.objects (bucket_id, name, owner) values ('documents', $1, $2)", [`${B}/evil.pdf`, A])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, A, (tx) => tx.query("insert into storage.objects (bucket_id, name, owner) values ('documents', 'loose.pdf', $1)", [A])),
    ).rejects.toThrow(/row-level security/);
  });
  it("other users cannot read, update or delete it; anon cannot read", async () => {
    expect(await select(db, "authenticated", A, "select name from storage.objects")).toHaveLength(1);
    expect(await select(db, "authenticated", B, "select name from storage.objects")).toEqual([]);
    expect(await affected(db, "authenticated", B, "update storage.objects set name = $1", [`${B}/stolen.pdf`])).toBe(0);
    expect(await affected(db, "authenticated", B, "delete from storage.objects")).toBe(0);
    expect(await select(db, "anon", null, "select name from storage.objects")).toEqual([]);
  });
});
