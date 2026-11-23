import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { affected, asService, asUser, createTestDb, ids, seedFixtures, select } from "./harness";

const supabaseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../supabase");

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
const C = ids.carol;
const MOD = ids.mod; // site moderator
const ADMIN = ids.admin;
const SUPER = ids.superAdmin;

const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
/** Authenticated write that must be rejected with an error matching re. */
const denied = (uid: string, sql: string, params: unknown[], re: RegExp) =>
  expect(asUser(db, uid, (tx) => tx.query(sql, params))).rejects.toThrow(re);
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query(sql, params));
const newUser = async (n: number) => {
  const id = `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `u${n}@example.test`]);
  return id;
};
const uuid = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("RLS on every table", () => {
  it("relrowsecurity is true for every table in public", async () => {
    const t = await raw(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    );
    expect(t).toEqual([]);
    expect((await raw("select count(*)::int n from pg_tables where schemaname = 'public'"))[0]?.n).toBeGreaterThan(0);
  });
});

describe("B1: community moderator cannot escalate", () => {
  const COM = uuid("c", 1);
  let dave = "";

  beforeAll(async () => {
    dave = await newUser(1);
    await db.query("insert into public.communities (id, name, slug, created_by) values ($1, 'B1', 'b1-com', $2)", [COM, A]);
    await db.query("insert into public.memberships (community_id, user_id, role) values ($1, $2, 'moderator'), ($1, $3, 'member'), ($1, $4, 'member')", [COM, C, B, dave]);
  });

  const role = async (u: string) => (await raw("select role, status from public.memberships where community_id = $1 and user_id = $2", [COM, u]))[0];

  it("mod cannot promote self to owner", async () => {
    await denied(C, "update public.memberships set role = 'owner' where community_id = $1 and user_id = $2", [COM, C], /owner membership/);
    expect((await role(C))?.role).toBe("moderator");
  });
  it("mod cannot ban or demote the owner", async () => {
    await denied(C, "update public.memberships set status = 'banned' where community_id = $1 and user_id = $2", [COM, A], /owner membership/);
    await denied(C, "update public.memberships set role = 'member' where community_id = $1 and user_id = $2", [COM, A], /owner membership/);
    expect(await role(A)).toEqual({ role: "owner", status: "active" });
  });
  it("mod cannot delete the owner membership", async () => {
    expect(await affected(db, "authenticated", C, "delete from public.memberships where community_id = $1 and user_id = $2", [COM, A])).toBe(0);
    expect(await role(A)).toBeDefined();
  });
  it("mod cannot rewrite memberships.user_id", async () => {
    await denied(C, "update public.memberships set user_id = $3 where community_id = $1 and user_id = $2", [COM, B, MOD], /immutable/);
    expect(await role(B)).toBeDefined();
  });
  it("mod cannot grab created_by nor delete the community", async () => {
    await denied(C, "update public.communities set created_by = $2 where id = $1", [COM, C], /created_by is immutable/);
    expect(await affected(db, "authenticated", C, "delete from public.communities where id = $1", [COM])).toBe(0);
    expect(await raw("select 1 from public.communities where id = $1", [COM])).toHaveLength(1);
  });
  it("mod cannot promote members or touch other moderators", async () => {
    await denied(C, "update public.memberships set role = 'moderator' where community_id = $1 and user_id = $2", [COM, B], /only the community owner/);
    expect((await role(B))?.role).toBe("member");
  });
  it("positive control: mod can ban and remove plain members", async () => {
    expect(await affected(db, "authenticated", C, "update public.memberships set status = 'banned' where community_id = $1 and user_id = $2", [COM, dave])).toBe(1);
    expect(await affected(db, "authenticated", C, "delete from public.memberships where community_id = $1 and user_id = $2", [COM, dave])).toBe(1);
  });
  it("positive control: owner can promote a member; mods can remove only members", async () => {
    expect(await affected(db, "authenticated", A, "update public.memberships set role = 'moderator' where community_id = $1 and user_id = $2", [COM, B])).toBe(1);
    expect(await affected(db, "authenticated", C, "delete from public.memberships where community_id = $1 and user_id = $2", [COM, B])).toBe(0);
    expect(await affected(db, "authenticated", A, "update public.memberships set role = 'member' where community_id = $1 and user_id = $2", [COM, B])).toBe(1);
  });
  it("owner cannot leave without transferring; members can leave", async () => {
    expect(await affected(db, "authenticated", A, "delete from public.memberships where community_id = $1 and user_id = $2", [COM, A])).toBe(0);
    expect(await affected(db, "authenticated", B, "delete from public.memberships where community_id = $1 and user_id = $2", [COM, B])).toBe(1);
  });
  it("ownership transfer: non-owners are refused; owner transfers; old owner loses delete rights; new owner can delete", async () => {
    await expect(run(B, "select public.transfer_community_ownership($1, $2)", [COM, B])).rejects.toThrow(/only the community owner/);
    await expect(run(A, "select public.transfer_community_ownership($1, $2)", [COM, B])).rejects.toThrow(/active member/);
    await run(A, "select public.transfer_community_ownership($1, $2)", [COM, C]);
    expect(await role(C)).toEqual({ role: "owner", status: "active" });
    expect((await role(A))?.role).toBe("moderator");
    expect(await affected(db, "authenticated", A, "delete from public.communities where id = $1", [COM])).toBe(0);
    expect(await affected(db, "authenticated", C, "delete from public.communities where id = $1", [COM])).toBe(1);
  });
});

describe("S1 + S7: account deletion", () => {
  it("deleting an auth user with audit rows, communities and anonymous posts succeeds", async () => {
    const x = await newUser(10);
    const com = uuid("c", 10);
    await run(x, "insert into public.communities (id, name, slug, created_by) values ($1, 'S1', 's1-com', $2)", [com, x]);
    await db.query("insert into public.memberships (community_id, user_id) values ($1, $2)", [com, B]);
    await asService(db, (tx) => tx.query("insert into public.audit_logs (actor_id, action) values ($1, 's1.test')", [x]));
    const anon = (await run(x, "select public.create_anonymous_post($1, 'Q?', 'body') as id", [com])).rows[0] as { id: string };
    const aAnon = (await run(A, "select public.create_anonymous_post($1, 'Q2?', 'body') as id", [ids.pubCommunity])).rows[0] as { id: string };
    expect(await select(db, "authenticated", x, "select id from public.posts where id = $1", [anon.id])).toHaveLength(1);

    await db.query("delete from auth.users where id = $1", [x]);

    expect((await raw("select actor_id from public.audit_logs where action = 's1.test'"))[0]?.actor_id).toBeNull();
    expect((await raw("select created_by from public.communities where id = $1", [com]))[0]?.created_by).toBeNull();
    // S7: the deleted author's anonymous post is gone; another author's anonymous post survives (control)
    expect(await raw("select 1 from public.posts where id = $1", [anon.id])).toHaveLength(0);
    expect(await raw("select 1 from public.posts where id = $1", [aAnon.id])).toHaveLength(1);
  });
  it("audit_logs stays append-only otherwise (no re-attaching an actor, no other edits)", async () => {
    await expect(asService(db, (tx) => tx.query("update public.audit_logs set actor_id = $1 where action = 's1.test'", [A]))).rejects.toThrow(/append-only/);
    await expect(asService(db, (tx) => tx.query("update public.audit_logs set action = 'x' where action = 's1.test'"))).rejects.toThrow(/append-only/);
  });
});

describe("S2 + S3: posts and comments", () => {
  const P1 = uuid("a", 1);
  const P2 = uuid("a", 2);
  const C1 = uuid("b", 1);
  const C2 = uuid("b", 2);
  const C3 = uuid("b", 3);

  beforeAll(async () => {
    await db.query(
      "insert into public.posts (id, community_id, author_id, title, body) values ($1, $3, $4, 'p1', 'b'), ($2, $3, $4, 'p2', 'b')",
      [P1, P2, ids.pubCommunity, C],
    );
    await db.query(
      "insert into public.comments (id, post_id, author_id, body) values ($1, $4, $6, 'c1'), ($2, $5, $6, 'c2'), ($3, $4, $6, 'c3')",
      [C1, C2, C3, P1, P2, C],
    );
  });

  it("author cannot undo a moderator's post removal; moderator can restore", async () => {
    expect(await affected(db, "authenticated", MOD, "update public.posts set deleted_at = now() where id = $1", [P1])).toBe(1);
    await denied(C, "update public.posts set deleted_at = null where id = $1", [P1], /only moderators may restore/);
    expect((await raw("select deleted_at from public.posts where id = $1", [P1]))[0]?.deleted_at).not.toBeNull();
    expect(await affected(db, "authenticated", MOD, "update public.posts set deleted_at = null where id = $1", [P1])).toBe(1);
  });
  it("author cannot undo a moderator's comment removal; moderator can restore", async () => {
    expect(await affected(db, "authenticated", MOD, "update public.comments set deleted_at = now() where id = $1", [C1])).toBe(1);
    await denied(C, "update public.comments set deleted_at = null where id = $1", [C1], /only moderators may restore/);
    expect(await affected(db, "authenticated", MOD, "update public.comments set deleted_at = null where id = $1", [C1])).toBe(1);
  });
  it("comment post_id, parent_id and author_id are immutable; body edits work (positive control)", async () => {
    await denied(C, "update public.comments set post_id = $2 where id = $1", [C1, P2], /immutable/);
    await denied(C, "update public.comments set parent_id = $2 where id = $1", [C1, C2], /immutable/);
    await denied(C, "update public.comments set author_id = $2 where id = $1", [C1, B], /immutable/);
    expect(await affected(db, "authenticated", C, "update public.comments set body = 'edited' where id = $1", [C1])).toBe(1);
  });
  it("a reply's parent must belong to the same post; same-post parent works (positive control)", async () => {
    await denied(C, "insert into public.comments (post_id, parent_id, author_id, body) values ($1, $2, $3, 'x')", [P1, C2, C], /row-level security/);
    expect(await affected(db, "authenticated", C, "insert into public.comments (post_id, parent_id, author_id, body) values ($1, $2, $3, 'ok')", [P1, C3, C])).toBe(1);
  });
});

describe("S4: events and resources", () => {
  const R1 = uuid("d", 1);
  const R2 = uuid("d", 2);
  const E1 = uuid("e", 1);
  const E2 = uuid("e", 2);
  const OTHER = uuid("c", 40);

  beforeAll(async () => {
    await db.query("insert into public.communities (id, name, slug, created_by) values ($1, 'Other', 'other-com', $2)", [OTHER, A]);
    await db.query(
      "insert into public.resources (id, uploader_id, title, status, visibility) values ($1, $3, 'r1', 'published', 'public'), ($2, $3, 'r2', 'pending', 'public')",
      [R1, R2, C],
    );
    await db.query(
      "insert into public.events (id, created_by, community_id, title, starts_at, status) values ($1, $3, $4, 'e1', now(), 'published'), ($2, $3, $4, 'e2', now(), 'published')",
      [E1, E2, C, ids.pubCommunity],
    );
  });
  const status = async (t: string, id: string) => (await raw(`select status from public.${t} where id = $1`, [id]))[0]?.status;

  it("a non-mod edit of a published resource resets it to pending; a pending edit stays pending; a mod edit keeps it published", async () => {
    expect(await affected(db, "authenticated", MOD, "update public.resources set title = 'by mod' where id = $1", [R1])).toBe(1);
    expect(await status("resources", R1)).toBe("published");
    expect(await affected(db, "authenticated", C, "update public.resources set title = 'edited' where id = $1", [R1])).toBe(1);
    expect(await status("resources", R1)).toBe("pending");
    expect(await affected(db, "authenticated", C, "update public.resources set title = 'edited' where id = $1", [R2])).toBe(1);
    expect(await status("resources", R2)).toBe("pending");
    await denied(C, "update public.resources set status = 'published' where id = $1", [R1], /only moderators/);
  });
  it("a non-mod edit of a published event resets it to pending; a no-op update does not", async () => {
    expect(await affected(db, "authenticated", C, "update public.events set title = title where id = $1", [E2])).toBe(1);
    expect(await status("events", E2)).toBe("published");
    expect(await affected(db, "authenticated", C, "update public.events set title = 'edited' where id = $1", [E1])).toBe(1);
    expect(await status("events", E1)).toBe("pending");
  });
  it("events cannot be moved into a community the creator is not in; moving into one they are in works", async () => {
    await denied(C, "update public.events set community_id = $2 where id = $1", [E1, OTHER], /row-level security/);
    expect(await affected(db, "authenticated", C, "update public.events set community_id = $2 where id = $1", [E1, ids.privCommunity])).toBe(1);
  });
  it("uploader_id and created_by are immutable", async () => {
    await denied(C, "update public.resources set uploader_id = $2 where id = $1", [R1, B], /immutable/);
    await denied(C, "update public.events set created_by = $2 where id = $1", [E1, B], /immutable/);
    expect((await raw("select uploader_id from public.resources where id = $1", [R1]))[0]?.uploader_id).toBe(C);
  });
});

describe("S5: documents", () => {
  const ins = (key: string, status: string, extra = "", p = `${A}/${key}.pdf`) =>
    run(A, `insert into public.documents (user_id, title, storage_path, idempotency_key, status ${extra ? ", " + extra.split("=")[0] : ""}) values ($1, 't', $2, $3, $4 ${extra ? ", " + extra.split("=")[1] : ""})`, [A, p, key, status]);

  it("insert must be pending_upload with no page_count or error", async () => {
    await expect(ins("s5-key-0001", "uploaded")).rejects.toThrow(/row-level security/);
    await expect(ins("s5-key-0002", "pending_upload", "page_count=3")).rejects.toThrow(/row-level security/);
    await expect(ins("s5-key-0003", "pending_upload", "error='boom'")).rejects.toThrow(/row-level security/);
  });
  it("storage_path with '..' segments is rejected; normal path works (positive control)", async () => {
    await expect(ins("s5-key-0004", "pending_upload", "", `${A}/../${B}/x.pdf`)).rejects.toThrow(/check constraint/);
    await ins("s5-key-0005", "pending_upload", "size_bytes=100");
  });
  it("size_bytes, mime_type and error are frozen after upload", async () => {
    const id = (await raw("select id from public.documents where idempotency_key = 's5-key-0005'"))[0]?.id;
    expect(await affected(db, "authenticated", A, "update public.documents set status = 'uploaded', size_bytes = 200, mime_type = 'text/plain' where id = $1", [id])).toBe(1);
    await denied(A, "update public.documents set size_bytes = 5 where id = $1", [id], /immutable/);
    await denied(A, "update public.documents set mime_type = 'application/pdf' where id = $1", [id], /immutable/);
    await denied(A, "update public.documents set error = 'x' where id = $1", [id], /immutable/);
  });
});

describe("S6: messages", () => {
  const msg = (extra: string) => run(A, `insert into public.messages (conversation_id, role, content ${extra ? ", " + extra.split("=")[0] : ""}) values ($1, $2, 'x' ${extra ? ", " + extra.split("=")[1] : ""})`, [ids.convA, extra.startsWith("role=") ? "assistant" : "user"]);

  it("users cannot forge assistant messages or model/token metadata", async () => {
    await denied(A, "insert into public.messages (conversation_id, role, content) values ($1, 'assistant', 'x')", [ids.convA], /row-level security/);
    await denied(A, "insert into public.messages (conversation_id, role, content, model) values ($1, 'user', 'x', 'gpt')", [ids.convA], /row-level security/);
    await denied(A, "insert into public.messages (conversation_id, role, content, input_tokens) values ($1, 'user', 'x', 1)", [ids.convA], /row-level security/);
    await denied(A, "insert into public.messages (conversation_id, role, content, output_tokens) values ($1, 'user', 'x', 1)", [ids.convA], /row-level security/);
    void msg;
  });
  it("users can only update feedback; content is untouchable", async () => {
    expect(await affected(db, "authenticated", A, "update public.messages set content = 'tampered' where id = $1", [ids.msgA])).toBe(0);
    expect(await affected(db, "authenticated", A, "update public.messages set role = 'assistant' where id = $1", [ids.msgA])).toBe(0);
    expect((await raw("select content from public.messages where id = $1", [ids.msgA]))[0]?.content).toBe("alice secret question");
    expect(await affected(db, "authenticated", A, "update public.messages set feedback = -1 where id = $1", [ids.msgA])).toBe(1);
  });
  it("positive control: a plain user message can be posted", async () => {
    expect(await affected(db, "authenticated", A, "insert into public.messages (conversation_id, role, content) values ($1, 'user', 'hello')", [ids.convA])).toBe(1);
  });
});

describe("S8: reports and takedowns", () => {
  const PUBRES = uuid("d", 20);
  const PRIVRES = uuid("d", 21);
  const COMMENT = uuid("b", 20);

  beforeAll(async () => {
    await db.query(
      "insert into public.resources (id, uploader_id, title, status, visibility) values ($1, $3, 'pub', 'published', 'public'), ($2, $3, 'priv', 'pending', 'private')",
      [PUBRES, PRIVRES, C],
    );
    await db.query("insert into public.comments (id, post_id, author_id, body) values ($1, $2, $3, 'secret comment')", [COMMENT, ids.privPost, A]);
  });
  const report = (uid: string, col: string, target: string, extra = "") =>
    run(uid, `insert into public.reports (reporter_id, ${col}, reason ${extra ? ", " + extra.split("=")[0] : ""}) values ($1, $2, 'bad stuff' ${extra ? ", " + extra.split("=")[1] : ""})`, [uid, target]);

  it("positive control: a viewer can report a visible post, comment-free target and resource", async () => {
    await report(B, "post_id", ids.pubPost);
    await report(B, "resource_id", PUBRES);
  });
  it("duplicate open report by the same reporter on the same target is rejected", async () => {
    await expect(report(B, "post_id", ids.pubPost)).rejects.toThrow(/duplicate key/);
  });
  it("handled_by must be null on insert", async () => {
    await expect(report(B, "post_id", ids.pubPost, `handled_by='${MOD}'`)).rejects.toThrow(/row-level security/);
  });
  it("cannot report targets the reporter cannot view", async () => {
    await expect(report(B, "post_id", ids.privPost)).rejects.toThrow(/row-level security/);
    await expect(report(B, "comment_id", COMMENT)).rejects.toThrow(/row-level security/);
    await expect(report(B, "resource_id", PRIVRES)).rejects.toThrow(/row-level security/);
  });
  it("takedowns: viewable resource works once; resolved_by must be null; invisible resource refused", async () => {
    const td = (res: string, extra = "") =>
      run(B, `insert into public.takedown_requests (resource_id, requester_id, reason ${extra ? ", " + extra.split("=")[0] : ""}) values ($1, $2, 'this infringes copyright' ${extra ? ", " + extra.split("=")[1] : ""})`, [res, B]);
    await expect(td(PUBRES, `resolved_by='${MOD}'`)).rejects.toThrow(/row-level security/);
    await expect(td(PRIVRES)).rejects.toThrow(/row-level security/);
    await td(PUBRES);
    // the first report auto-hides the resource (migration 4200), so the repeat is refused by RLS before the unique index
    await expect(td(PUBRES)).rejects.toThrow(/duplicate key|row-level security/);
  });
});

describe("S9: resources.storage_path", () => {
  const ins = (p: string | null, n: number) =>
    run(A, "insert into public.resources (uploader_id, title, storage_path) values ($1, $2, $3)", [A, `s9-${n}`, p]);
  it("must start with uploader_id/ and not traverse", async () => {
    await expect(ins(`${B}/x.pdf`, 1)).rejects.toThrow(/check constraint|invalid storage path|not been uploaded/);
    await expect(ins("loose.pdf", 2)).rejects.toThrow(/check constraint|invalid storage path|not been uploaded/);
    await expect(ins(`${A}/../${B}/x.pdf`, 3)).rejects.toThrow(/check constraint|invalid storage path|not been uploaded/);
  });
  it("positive control: own folder and null path are accepted", async () => {
    // direct inserts must point at an object that really exists in the caller's folder (bound by trigger, migration 4510)
    await db.query("insert into storage.objects (bucket_id, name, owner, metadata) values ('resources', $1, $2, '{\"size\":10,\"mimetype\":\"application/pdf\"}')", [`${A}/x.pdf`, A]);
    await ins(`${A}/x.pdf`, 4);
    await expect(ins(`${A}/missing.pdf`, 6)).rejects.toThrow(/not been uploaded/);
    await ins(null, 5);
  });
});

describe("nits", () => {
  it("notifications: users may update read_at only", async () => {
    const id = uuid("f", 1);
    await asService(db, (tx) => tx.query("insert into public.notifications (id, user_id, kind, title) values ($1, $2, 'k', 'orig')", [id, A]));
    expect(await affected(db, "authenticated", A, "update public.notifications set title = 'pwned' where id = $1", [id])).toBe(0);
    expect((await raw("select title from public.notifications where id = $1", [id]))[0]?.title).toBe("orig");
    expect(await affected(db, "authenticated", A, "update public.notifications set read_at = now() where id = $1", [id])).toBe(1);
  });
  // 20260101005600: any https URL is no longer enough, it must be our storage avatars bucket.
  it("avatar_url must point at the avatars bucket", async () => {
    await denied(A, "update public.profiles set avatar_url = 'http://x.test/a.png' where id = $1", [A], /check constraint/);
    await denied(A, "update public.profiles set avatar_url = 'javascript:alert(1)' where id = $1", [A], /check constraint/);
    await denied(A, "update public.profiles set avatar_url = 'https://x.test/a.png' where id = $1", [A], /check constraint/);
    await denied(A, "update public.profiles set avatar_url = 'https://x.test/storage/v1/object/public/avatars/' || $1 || '/a.png' where id = $1", [A], /check constraint/);
    expect(await affected(db, "authenticated", A, "update public.profiles set avatar_url = 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/avatars/' || $1 || '/a.png' where id = $1", [A])).toBe(1);
  });
  it("admins cannot edit super_admin profiles; they can edit students; a super_admin can edit themself", async () => {
    expect(await affected(db, "authenticated", ADMIN, "update public.profiles set display_name = 'hax' where id = $1", [SUPER])).toBe(0);
    expect((await raw("select display_name from public.profiles where id = $1", [SUPER]))[0]?.display_name).toBe("superadmin");
    expect(await affected(db, "authenticated", ADMIN, "update public.profiles set display_name = 'edited by admin' where id = $1", [C])).toBe(1);
    expect(await affected(db, "authenticated", SUPER, "update public.profiles set display_name = 'superadmin' where id = $1", [SUPER])).toBe(1);
  });
  it("bucket upsert also resets file_size_limit and allowed_mime_types", async () => {
    const sql = readFileSync(path.join(supabaseDir, "migrations/20260101001600_product_gaps.sql"), "utf8");
    const upsert = sql.slice(sql.indexOf("insert into storage.buckets"), sql.indexOf(";", sql.indexOf("on conflict")) + 1);
    const before = (await raw("select file_size_limit, allowed_mime_types from storage.buckets where id = 'documents'"))[0];
    await db.query("update storage.buckets set file_size_limit = 1, allowed_mime_types = array['text/html'], public = true where id = 'documents'");
    await db.exec(upsert);
    const after = (await raw("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'documents'"))[0];
    expect(after).toEqual({ public: false, ...before });
  });
  it("seed_universities migration mirrors seed.sql and is idempotent", async () => {
    const seed = readFileSync(path.join(supabaseDir, "seed.sql"), "utf8");
    const names = [...seed.matchAll(/^\s*\('([^']+)'\)/gm)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThanOrEqual(10);
    const have = (await raw("select name from public.universities")).map((r) => r.name);
    expect(have).toEqual(expect.arrayContaining(names));
    const before = (await raw("select count(*)::int n from public.universities"))[0]?.n;
    await db.exec(readFileSync(path.join(supabaseDir, "migrations/20260101001300_seed_universities.sql"), "utf8"));
    expect((await raw("select count(*)::int n from public.universities"))[0]?.n).toBe(before);
  });
});

describe("B3: storage_path is '<owner uuid>/<flat safe file name>'", () => {
  const doc = (p: string, n: number) =>
    raw("insert into public.documents (user_id, title, storage_path, idempotency_key) values ($1, 't', $2, $3)", [A, p, `b3-doc-key-${n}`]);
  const res = (p: string, n: number) =>
    raw("insert into public.resources (uploader_id, title, storage_path) values ($1, $2, $3)", [A, `b3-${n}`, p]);
  const bad = [
    (u: string) => `${u}/sub/x.pdf`,
    (u: string) => `${u}/x/../y.pdf`,
    (u: string) => `${u}/..hidden.pdf`,
    (u: string) => `${u}/a..b.pdf`,
    (u: string) => `${u}/`,
    (u: string) => `${u}/x\n.pdf`,
    (u: string) => `${u}/x\u0000.pdf`,
    (u: string) => `${u}/ə.pdf`,
    (u: string) => `${u}/x%2e%2e.pdf`,
    (u: string) => `${u}/x;rm.pdf`,
    (u: string) => `${u.toUpperCase()}/x.pdf`,
    (u: string) => ` ${u}/x.pdf`,
  ];
  it.each(bad.map((f, i) => [i, f] as const))("documents reject unsafe path #%i", async (i, f) => {
    await expect(doc(f(A), 100 + i)).rejects.toThrow(/check constraint|invalid byte|null/i);
  });
  it.each(bad.map((f, i) => [i, f] as const))("resources reject unsafe path #%i", async (i, f) => {
    await expect(res(f(A), 100 + i)).rejects.toThrow(/check constraint|invalid byte|null/i);
  });
  it("positive control: flat names with space, dot, underscore, hyphen are accepted", async () => {
    await doc(`${A}/My Notes_v2-final.1.pdf`, 1);
    await res(`${A}/lecture 3.pdf`, 1);
  });
});
