import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createTestDb } from "./harness";

// Migration 20260101005600 (security foundation: university verification, private profiles, avatar_url,
// cv-photos bucket, consent proof after deletion, privilege trims).

let db: PGlite;
const U = (k: number) => `00000000-0000-4000-8000-0000000c${String(k).padStart(4, "0")}`;
const [A, B, C, MOD, E, F] = [U(1), U(2), U(3), U(4), U(5), U(6)];
let UNI = "";
let UNI2 = "";
const AV = "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/avatars/";

const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params));
const rows = async (uid: string, sql: string, params: unknown[] = []) => (await run(uid, sql, params)).rows;
const msg = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  return "NO ERROR";
};
const status = async (id: string) => (await raw("select university_status from public.profiles where id = $1", [id]))[0]!.university_status;
const uniOf = async (id: string) => (await raw("select university_id from public.profiles where id = $1", [id]))[0]!.university_id;
const review = async (by: string, user: string, approve: boolean, note: string | null = null) =>
  rows(by, "select * from public.admin_review_university($1, $2, $3, $4)", [user, await uniOf(user), approve, note]);
const claim = (u: string, uni: string | null) => run(u, "update public.profiles set university_id = $1 where id = $2", [uni, u]);

beforeAll(async () => {
  db = await createTestDb();
  for (const [i, u] of [A, B, C, MOD, E, F].entries())
    await raw("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [u, `sf${i}@x.test`, JSON.stringify({ display_name: `U${i}` })]);
  await raw("update public.profiles set role = 'moderator' where id = $1", [MOD]);
  UNI = (await raw("select id from public.universities order by name limit 1"))[0]!.id;
  UNI2 = (await raw("select id from public.universities order by name desc limit 1"))[0]!.id;
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("S1 university verification", () => {
  it("user cannot write verification columns; choosing/changing university sets pending, clearing sets none", async () => {
    expect(await status(A)).toBe("none");
    expect(await msg(run(A, "update public.profiles set university_status = 'approved' where id = $1", [A]))).toMatch(/staff review only/);
    expect(await msg(run(A, "update public.profiles set university_reviewed_by = $1 where id = $1", [A]))).toMatch(/staff review only/);
    await claim(A, UNI);
    expect(await status(A)).toBe("pending");
    expect(await msg(run(A, "update public.profiles set university_id = $1, university_status = 'approved' where id = $2", [UNI2, A]))).toMatch(/staff review only/);
    await claim(A, null);
    expect(await status(A)).toBe("none");
    await claim(A, UNI);
  });

  it("non-staff cannot review or list; staff can, with an audit row; approved status resets on university change", async () => {
    expect(await msg(run(B, "select * from public.admin_review_university($1, $2, true, null)", [A, UNI]))).toMatch(/moderator privileges/);
    expect(await msg(run(B, "select * from public.admin_list_university_requests('pending', 25, 0)"))).toMatch(/moderator privileges/);
    expect(await msg(run(MOD, "select * from public.admin_review_university($1, $2, true, null)", [MOD, UNI]))).toMatch(/own university/);
    const list = await rows(MOD, "select id, university_id from public.admin_list_university_requests('pending', 25, 0)");
    expect(list).toContainEqual({ id: A, university_id: UNI });
    // review race: the reviewer saw another university than the current one
    expect(await msg(run(MOD, "select * from public.admin_review_university($1, $2, true, null)", [A, UNI2]))).toMatch(/university changed/);
    expect(await status(A)).toBe("pending");
    const r = (await review(MOD, A, true, " ok "))[0]!;
    expect(r).toMatchObject({ id: A, university_status: "approved", university_reviewed_by: MOD, university_review_note: "ok" });
    const log = await raw("select actor_id, metadata from public.audit_logs where action = 'university.approve' and entity_id = $1", [A]);
    expect(log).toHaveLength(1);
    expect(log[0]!.actor_id).toBe(MOD);
    expect(log[0]!.metadata.university_id).toBe(UNI);
    // B: rejected at UNI; C: approved at UNI2
    await claim(B, UNI);
    await claim(C, UNI2);
    await review(MOD, C, true);
    await review(MOD, B, false, "no proof");
    expect(await status(B)).toBe("rejected");
    await claim(B, UNI); // unchanged id: stays rejected
    expect(await status(B)).toBe("rejected");
    // staff-side direct update of university_id also resets
    await raw("update public.profiles set university_id = $1 where id = $2", [UNI, C]);
    expect(await status(C)).toBe("pending"); // C stays pending at UNI for the next test
  });

  it("reviewer identity and note are not client-readable; status and reviewed_at are", async () => {
    expect(await msg(run(A, "select university_review_note from public.profiles where id = $1", [A]))).toMatch(/permission denied/);
    expect(await msg(run(MOD, "select university_reviewed_by from public.profiles where id = $1", [A]))).toMatch(/permission denied/);
    expect((await rows(A, "select university_status, university_reviewed_at is not null as r from public.profiles where id = $1", [A]))[0]).toEqual({ university_status: "approved", r: true });
  });

  it("only approved members see 'university' resources and join the university community", async () => {
    const res = (await raw(
      "insert into public.resources (uploader_id, title, status, visibility, university_id) values ($1, 'uni only', 'published', 'university', $2) returning id",
      [C, UNI2],
    ))[0]!.id;
    const seen = async (u: string) => (await rows(u, "select id from public.resources where id = $1", [res])).length;
    await claim(B, UNI2); // B claims UNI2, pending
    expect(await status(B)).toBe("pending");
    expect(await seen(B)).toBe(0);
    expect(await seen(A)).toBe(0); // approved, other university
    await review(MOD, B, true);
    expect(await seen(B)).toBe(1); // positive control
    expect((await rows(B, "select public.can_view_resource($1) as v", [res]))[0]!.v).toBe(true);

    const comm = (await rows(C, "select public.ensure_university_community($1) as id", [UNI]))[0]!.id;
    expect(await status(C)).toBe("pending"); // C claims UNI, not approved
    expect(await msg(run(C, "select public.ensure_university_community($1, true)", [UNI]))).toMatch(/own university/);
    expect(await msg(run(C, "select public.join_community($1)", [comm]))).toMatch(/only students/);
    expect(await msg(run(C, "insert into public.memberships (community_id, user_id) values ($1, $2)", [comm, C]))).not.toBe("NO ERROR");
    // invite codes are only issued for groups, but a code row for a university community must not bypass the check
    await raw("insert into public.community_invites (community_id, code) values ($1, 'ABCDEFGHIJKLMNOPQRST')", [comm]);
    expect(await msg(run(C, "select public.join_by_code('ABCDEFGHIJKLMNOPQRST')"))).toMatch(/only students/);
    expect((await rows(A, "select public.join_by_code('ABCDEFGHIJKLMNOPQRST') as id"))[0]!.id).toBe(comm); // approved at UNI
    await raw("delete from public.community_invites where community_id = $1", [comm]);
  });

  it("university community memberships are pruned when the approved university is lost (bans kept)", async () => {
    const comm = (await rows(E, "select public.ensure_university_community($1) as id", [UNI]))[0]!.id;
    const member = async (u: string) => (await raw("select status from public.memberships where community_id = $1 and user_id = $2", [comm, u]))[0]?.status;
    await claim(E, UNI);
    await review(MOD, E, true);
    await rows(E, "select public.ensure_university_community($1, true)", [UNI]);
    expect(await member(E)).toBe("active");
    await claim(E, UNI2); // user switches university -> pending -> membership gone
    expect(await member(E)).toBeUndefined();
    await claim(E, UNI);
    await review(MOD, E, true);
    await rows(E, "select public.join_community($1)", [comm]);
    expect(await member(E)).toBe("active");
    await review(MOD, E, false, "fake"); // staff rejection also prunes
    expect(await member(E)).toBeUndefined();
    // a ban survives the prune
    await raw("insert into public.memberships (community_id, user_id, role, status) values ($1, $2, 'member', 'banned')", [comm, E]);
    await claim(E, UNI2);
    expect(await member(E)).toBe("banned");
  });

  it("publishing to a university audience needs the approved university (shares and resources)", async () => {
    await claim(F, UNI); // pending
    const card = (await raw("insert into public.flashcards (user_id, front, back) values ($1, 'f', 'b') returning id", [F]))[0]!.id;
    expect(await msg(run(F, "select public.share_flashcards('deck', array[$1]::uuid[], 'university')", [card]))).toMatch(/approved university/);
    const pub = (await rows(F, "select public.share_flashcards('deck', array[$1]::uuid[], 'public') as id", [card]))[0]!.id;
    expect(pub).toBeTruthy(); // public sharing still works
    const res = (await raw("insert into public.resources (uploader_id, title, status, visibility, university_id) values ($1, 'mine', 'published', 'public', $2) returning id", [F, UNI]))[0]!.id;
    expect(await msg(run(F, "update public.resources set visibility = 'university' where id = $1", [res]))).toMatch(/approved university/);
    await review(MOD, F, true);
    const card2 = (await raw("insert into public.flashcards (user_id, front, back) values ($1, 'f2', 'b2') returning id", [F]))[0]!.id;
    expect((await rows(F, "select public.share_flashcards('deck2', array[$1]::uuid[], 'university') as id", [card2]))[0]!.id).toBeTruthy();
    await run(F, "update public.resources set visibility = 'university' where id = $1", [res]);
    // approved at UNI but tagging another university (e.g. a course of UNI2) is refused
    expect(await msg(run(F, "update public.resources set university_id = $1 where id = $2", [UNI2, res]))).toMatch(/approved university/);
  });
});

describe("S2 private profiles", () => {
  it("users see only their own row; staff see all; new profiles are not discoverable; unverified universities hidden", async () => {
    expect(await rows(A, "select id from public.profiles where id = $1", [B])).toEqual([]);
    expect(await rows(A, "select id from public.profiles where id = $1", [A])).toHaveLength(1);
    expect((await rows(MOD, "select id from public.profiles where id = any($1)", [[A, B]])).length).toBe(2);
    expect((await raw("select campus_discoverable from public.profiles where id = $1", [A]))[0]!.campus_discoverable).toBe(false);
    // public bits still reachable through the definer RPC; C is pending at UNI
    expect((await rows(A, "select public.campus_profile($1) as p", [B]))[0]!.p).not.toBeNull();
    expect((await rows(A, "select public.campus_profile($1) as p", [C]))[0]!.p.university_id).toBeNull();
    expect((await rows(C, "select public.campus_profile($1) as p", [C]))[0]!.p.university_id).toBe(UNI); // self sees own claim
    expect((await rows(A, "select public.campus_profile($1) as p", [B]))[0]!.p.university_id).toBe(UNI2); // approved
    expect((await rows(A, "select public.get_contributor_profile($1) as p", [C]))[0]!.p.university_name).toBeNull();
    expect((await rows(A, "select public.get_contributor_profile($1) as p", [B]))[0]!.p.university_name).not.toBeNull();
  });
});

describe("S8 avatar_url", () => {
  const set = (u: string, url: string | null) => run(u, "update public.profiles set avatar_url = $1 where id = $2", [url, u]);
  it("only our own folder in the avatars bucket on a Supabase host (or empty/null)", async () => {
    for (const bad of [
      "https://evil.test/a.png",
      `https://x.test/storage/v1/object/public/avatars/${A}/a.png`,
      `https://evil.test/storage/v1/object/public/documents/${A}/a.png`,
      `http://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/avatars/${A}/a.png`,
      `${AV}${B}/a.png`,
      `${AV}${A}/../${B}/a.png`,
      `${AV}${A}/a.png?x=1`,
      `https://abcdefghijklmnopqrst.supabase.co.evil.test/storage/v1/object/public/avatars/${A}/a.png`,
    ]) expect(await msg(set(A, bad)), bad).toMatch(/check constraint/);
    await set(A, `${AV}${A}/a.png`);
    await set(A, `http://127.0.0.1:54321/storage/v1/object/public/avatars/${A}/b.png`);
    await set(A, null);
    await set(A, "");
  });
  it("a pinned storage_host is the only accepted host", async () => {
    await raw("insert into public.system_config (key, value) values ('storage_host', '\"cdn.unimate.test\"')");
    expect(await msg(set(A, `${AV}${A}/a.png`))).toMatch(/check constraint/);
    await set(A, `https://cdn.unimate.test/storage/v1/object/public/avatars/${A}/a.png`);
    await raw("delete from public.system_config where key = 'storage_host'");
  });
  it("a legacy off-bucket URL does not block other updates of that row", async () => {
    await raw("alter table public.profiles disable trigger profiles_guard_avatar_url");
    await raw("update public.profiles set avatar_url = 'https://legacy.test/x.png' where id = $1", [A]);
    await raw("alter table public.profiles enable trigger profiles_guard_avatar_url");
    await run(A, "update public.profiles set display_name = 'Legacy', avatar_url = avatar_url where id = $1", [A]);
  });
});

describe("S6 cv-photos bucket", () => {
  it("is private and owner-folder only", async () => {
    expect((await raw("select public, file_size_limit from storage.buckets where id = 'cv-photos'"))[0]).toMatchObject({ public: false, file_size_limit: 5242880 });
    await run(A, "insert into storage.objects (bucket_id, name) values ('cv-photos', $1)", [`${A}/me.jpg`]);
    expect(await msg(run(A, "insert into storage.objects (bucket_id, name) values ('cv-photos', $1)", [`${B}/x.jpg`]))).toMatch(/row-level security/);
    expect(await rows(B, "select name from storage.objects where bucket_id = 'cv-photos'")).toEqual([]);
    expect(await rows(A, "select name from storage.objects where bucket_id = 'cv-photos'")).toHaveLength(1);
  });
});

describe("S5/S7 privileges", () => {
  it("API roles lost truncate/references/trigger and anon lost sequences; no auto-grants for new objects", async () => {
    const p = (await raw(`select has_table_privilege('authenticated','public.profiles','truncate') t,
      has_table_privilege('authenticated','public.profiles','select') s,
      exists (select 1 from information_schema.role_usage_grants where grantee = 'anon' and object_schema = 'public') seq`))[0]!;
    expect(p).toEqual({ t: false, s: false, seq: false }); // s: column-level only now
    await raw("create table public.sf_probe (id int)");
    await raw("create function public.sf_probe_fn() returns int language sql as 'select 1'");
    expect((await raw(`select has_table_privilege('authenticated','public.sf_probe','select') a, has_table_privilege('anon','public.sf_probe','select') b,
      has_function_privilege('anon','public.sf_probe_fn()','execute') f`))[0]).toEqual({ a: false, b: false, f: false });
    await raw("drop function public.sf_probe_fn()");
    await raw("drop table public.sf_probe");
  });
});

describe("S10 consent proof", () => {
  it("rows survive auth user deletion with user_id null and subject_ref intact; updates/deletes still refused", async () => {
    const X = U(9);
    await raw("insert into auth.users (id, email) values ($1, 'x@x.test')", [X]);
    await asService(db, (tx) => tx.query("select public.insert_consent($1, 'marketing', 'granted', 'web', 'settings')", [X]));
    const ref = (await raw("select encode(sha256(convert_to($1::text, 'UTF8')), 'hex') h", [X]))[0]!.h;
    const before = await raw("select id, subject_ref from public.user_consents where user_id = $1", [X]);
    expect(before).toHaveLength(1);
    expect(before[0]!.subject_ref).toBe(ref);
    expect(await msg(raw("update public.user_consents set platform = 'ios' where id = $1", [before[0]!.id]))).toMatch(/append-only/);
    expect(await msg(raw("update public.user_consents set user_id = null where id = $1", [before[0]!.id]))).toMatch(/append-only/);
    expect(await msg(asService(db, (tx) => tx.query("delete from public.user_consents where id = $1", [before[0]!.id])))).toMatch(/permission denied/);
    await raw("delete from auth.users where id = $1", [X]);
    const after = await raw("select user_id, subject_ref from public.user_consents where id = $1", [before[0]!.id]);
    expect(after).toEqual([{ user_id: null, subject_ref: ref }]);
    expect(await msg(raw("update public.user_consents set platform = 'ios' where id = $1", [before[0]!.id]))).toMatch(/append-only/);
  });
});
