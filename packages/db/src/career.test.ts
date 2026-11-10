import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb } from "./harness";

// Migrations 20260101004300 + 20260101004310 (UNIMATE CAREER). Everything client-side runs as `authenticated` with
// auth.uid() set; every negative result has a positive control. No listing exists unless a test creates it.

let db: PGlite;
const U = (k: number) => `00000000-0000-4000-8000-00000000e${String(k).padStart(3, "0")}`;
const [ADMIN, MOD, S1, S2] = [U(1), U(2), U(3), U(4)];

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
const setClock = (iso: string) => raw("insert into app_private.clock_override (at) values ($1) on conflict (singleton) do update set at = excluded.at", [iso]);
const clearClock = () => raw("delete from app_private.clock_override");

const today = async () => (await raw("select public.career_today()::text as d"))[0]!.d as string;
const plusDays = async (n: number) => (await raw("select (public.career_today() + $1::int)::text as d", [n]))[0]!.d as string;

const org = async (uid: string, name: string, extra: { website?: string | null; verified?: boolean | null } = {}) =>
  (await rows(uid, "select public.admin_upsert_organization(null, $1, 'About us', $2, null, $3) as id", [name, extra.website ?? "https://example.org", extra.verified ?? null]))[0]!.id as string;
interface Opp {
  org: string;
  kind?: string;
  title?: string;
  location?: string | null;
  remote?: boolean;
  deadline?: string | null;
  url?: string | null;
  skills?: string[];
  languages?: string[];
  description?: string | null;
}
const opp = async (uid: string, o: Opp) =>
  (
    await rows(uid, "select public.admin_upsert_opportunity(null, $1, $2, $3, $4, null, $5, $6, $7, $8, $9, $10, 'source: test') as id", [
      o.org, o.kind ?? "internship", o.title ?? "Data intern", o.description ?? null, o.location ?? null, o.remote ?? false,
      o.deadline === undefined ? await plusDays(30) : o.deadline, o.url === undefined ? "https://example.org/apply" : o.url, o.skills ?? [], o.languages ?? ["az"],
    ])
  )[0]!.id as string;
const setStatus = (uid: string, id: string, status: string) => rows(uid, "select public.admin_set_opportunity_status($1, $2) as ok", [id, status]);
const publish = (id: string) => setStatus(MOD, id, "published");
const search = (uid: string, args: Record<string, unknown> = {}) =>
  rows(uid, "select * from public.search_opportunities($1, $2, $3, $4, $5, $6, coalesce($7, 'deadline'), coalesce($8, 20), coalesce($9, 0), coalesce($10, false))", [
    args.q ?? null, args.kind ?? null, args.location ?? null, args.remote ?? null, args.before ?? null, args.skills ?? null, args.sort ?? null, args.limit ?? null, args.offset ?? null, args.expired ?? null,
  ]);

beforeAll(async () => {
  db = await createTestDb({ seed: false });
  for (const [i, u] of [ADMIN, MOD, S1, S2].entries()) await raw("insert into auth.users (id, email) values ($1, $2)", [u, `c${i}@example.test`]);
  await raw("update public.profiles set role = 'admin' where id = $1", [ADMIN]);
  await raw("update public.profiles set role = 'moderator' where id = $1", [MOD]);
}, 120_000);
afterAll(async () => {
  await clearClock();
  await db.close();
});

describe("no seed data", () => {
  it("starts with no organizations and no listings", async () => {
    expect((await raw("select count(*)::int as n from public.opportunities"))[0]!.n).toBe(0);
    expect((await raw("select count(*)::int as n from public.organizations"))[0]!.n).toBe(0);
    expect(await search(S1)).toEqual([]);
  });
});

describe("admin RPC authorisation and audit", () => {
  it("students cannot call any admin RPC (positive control: a moderator can)", async () => {
    await fails(S1, "select public.admin_upsert_organization(null, 'Nope Inc')");
    const o = await org(MOD, "Authz Org");
    expect(o).toMatch(/^[0-9a-f-]{36}$/);
    await fails(S1, "select public.admin_upsert_opportunity(null, $1, 'internship', 't', null, null, null, false, null, 'https://example.org/a')", [o]);
    const id = await opp(MOD, { org: o });
    await fails(S1, "select public.admin_set_opportunity_status($1, 'published')", [id]);
    await fails(S1, "select public.admin_delete_opportunity($1, 'because reasons')", [id]);
    expect((await publish(id))[0]!.ok).toBe(true);
  });
  it("only an admin may set the verified flag; moderators cannot", async () => {
    await fails(MOD, "select public.admin_upsert_organization(null, 'Verified Co', null, null, null, true)");
    const id = await org(ADMIN, "Verified Co 2", { verified: true });
    expect((await raw("select verified from public.organizations where id = $1", [id]))[0]!.verified).toBe(true);
    // a moderator editing without touching the flag keeps it
    await rows(MOD, "select public.admin_upsert_organization($1, 'Verified Co 2 (edited)', 'd', 'https://example.org', null, null)", [id]);
    expect((await raw("select verified from public.organizations where id = $1", [id]))[0]!.verified).toBe(true);
    await fails(MOD, "select public.admin_upsert_organization($1, 'x', null, null, null, false)", [id]);
  });
  it("writes audit rows for create, update, status and delete (with the actor and a reason)", async () => {
    const o = await org(MOD, "Audit Org");
    const id = await opp(MOD, { org: o, title: "Audited" });
    await publish(id);
    await rows(MOD, "select public.admin_upsert_opportunity($1, $2, 'internship', 'Audited v2', null, null, null, false, null, 'https://example.org/a2', '{}', '{}', null)", [id, o]);
    await fails(MOD, "select public.admin_delete_opportunity($1, 'x')", [id]); // reason too short
    expect((await rows(MOD, "select public.admin_delete_opportunity($1, 'duplicate listing') as ok", [id]))[0]!.ok).toBe(true);
    const a = await raw("select action, actor_id, metadata from public.audit_logs where entity_id = $1 order by created_at, id", [id]);
    expect(a.map((r) => r.action)).toEqual(["career.opportunity.create", "career.opportunity.status", "career.opportunity.update", "career.opportunity.delete"]);
    expect(a.every((r) => r.actor_id === MOD)).toBe(true);
    expect(a[3]!.metadata.reason).toBe("duplicate listing");
    expect((await rows(MOD, "select public.admin_delete_opportunity($1, 'duplicate listing') as ok", [id]))[0]!.ok).toBe(false); // already gone
  });
});

describe("validation", () => {
  let o: string;
  beforeAll(async () => {
    o = await org(MOD, "Validation Org");
  });
  const create = (over: Partial<Record<"kind" | "title" | "deadline" | "url" | "skills" | "languages", unknown>> = {}) =>
    rows(MOD, "select public.admin_upsert_opportunity(null, $1, $2, $3, null, null, null, false, $4, $5, $6, $7) as id", [
      o, over.kind ?? "hackathon", over.title ?? "Valid title", over.deadline ?? null, over.url ?? "https://example.org/x", over.skills ?? [], over.languages ?? [],
    ]);
  it("accepts a valid listing (positive control) and rejects bad input", async () => {
    expect((await create())[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    for (const url of ["http://example.org/x", "javascript:alert(1)", "https://localhost/x", "https://127.0.0.1/x", "ftp://example.org", "https://user:pw@example.org/", "https://exa mple.org", "example.org"])
      await fails(MOD, "select public.admin_upsert_opportunity(null, $1, 'hackathon', 'T', null, null, null, false, null, $2)", [o, url]);
    await fails(MOD, "select public.admin_upsert_opportunity(null, $1, 'hackathon', 'T', null, null, null, false, null, null)", [o]);
    await expect(create({ kind: "full_time" })).rejects.toThrow(/invalid kind/);
    await expect(create({ title: "   " })).rejects.toThrow(/title/);
    await expect(create({ languages: ["de"] })).rejects.toThrow(/languages/);
    await expect(create({ skills: Array.from({ length: 31 }, (_, i) => `s${i}`) })).rejects.toThrow(/skills/);
    await expect(create({ skills: ["x".repeat(51)] })).rejects.toThrow(/skills/);
  });
  it("applies deadline sanity", async () => {
    await expect(create({ deadline: await plusDays(-1) })).rejects.toThrow(/in the past/);
    await expect(create({ deadline: await plusDays(1200) })).rejects.toThrow(/three years/);
    expect((await create({ deadline: await today() }))[0]!.id).toBeTruthy(); // today is fine
    expect((await create({ deadline: await plusDays(1000) }))[0]!.id).toBeTruthy();
  });
  it("rejects invalid organization input and unknown organizations", async () => {
    await fails(MOD, "select public.admin_upsert_organization(null, 'Bad Web', null, 'http://insecure.example.org')");
    await fails(MOD, "select public.admin_upsert_organization(null, '   ')");
    await fails(MOD, "select public.admin_upsert_organization(null, 'Bad Logo', null, null, '../etc/passwd')");
    await fails(MOD, "select public.admin_upsert_organization($1, 'Ghost')", ["00000000-0000-4000-8000-0000000000aa"]);
    await fails(MOD, "select public.admin_upsert_opportunity(null, $1, 'hackathon', 'T', null, null, null, false, null, 'https://example.org/x')", ["00000000-0000-4000-8000-0000000000aa"]);
    await org(MOD, "Dup Name Co");
    await expect(org(MOD, "  DUP  name co ")).rejects.toThrow(); // unique after normalisation
  });
  it("the table CHECKs hold even for the owner role (defence in depth)", async () => {
    await expect(raw("insert into public.opportunities (organization_id, kind, title, apply_url) values ($1, 'internship', 't', 'http://x.org')", [o])).rejects.toThrow();
    await expect(raw("insert into public.opportunities (organization_id, kind, title, apply_url, status) values ($1, 'internship', 't', 'https://x.org', 'published')", [o])).rejects.toThrow(); // published needs published_at
  });
});

describe("visibility (RLS)", () => {
  it("students see only published listings; organizations only once they have one; staff see drafts", async () => {
    const o = await org(MOD, "Visibility Org");
    const id = await opp(MOD, { org: o, title: "Hidden draft" });
    expect(await rows(S1, "select id from public.opportunities where id = $1", [id])).toEqual([]);
    expect(await rows(S1, "select id from public.organizations where id = $1", [o])).toEqual([]);
    expect((await search(S1, { q: "hidden draft" })).length).toBe(0);
    expect((await rows(S1, "select public.get_opportunity($1) as j", [id]))[0]!.j).toBeNull();
    expect((await rows(MOD, "select id from public.opportunities where id = $1", [id])).length).toBe(1); // positive control
    expect((await rows(MOD, "select id from public.organizations where id = $1", [o])).length).toBe(1);

    await publish(id);
    expect((await rows(S1, "select id from public.opportunities where id = $1", [id])).length).toBe(1);
    expect((await rows(S1, "select id from public.organizations where id = $1", [o])).length).toBe(1);
    const j = (await rows(S1, "select public.get_opportunity($1) as j", [id]))[0]!.j;
    expect(j.title).toBe("Hidden draft");
    expect(j.organization.name).toBe("Visibility Org");

    await setStatus(MOD, id, "archived");
    expect(await rows(S1, "select id from public.opportunities where id = $1", [id])).toEqual([]);
    await setStatus(MOD, id, "draft");
    expect((await raw("select published_at from public.opportunities where id = $1", [id]))[0]!.published_at).toBeNull();
  });
  it("students cannot write organizations or opportunities directly", async () => {
    const o = await org(MOD, "Direct Write Org");
    const id = await opp(MOD, { org: o, title: "Direct write" });
    await publish(id);
    await fails(S1, "insert into public.opportunities (organization_id, kind, title, apply_url) values ($1, 'internship', 't', 'https://x.org')", [o]);
    await fails(S1, "insert into public.organizations (name) values ('mine')");
    await fails(S1, "update public.opportunities set title = 'pwned' where id = $1", [id]);
    await fails(S1, "delete from public.opportunities where id = $1", [id]);
    await fails(MOD, "update public.opportunities set title = 'pwned' where id = $1", [id]); // staff also go through the audited RPCs
    expect((await raw("select title from public.opportunities where id = $1", [id]))[0]!.title).toBe("Direct write");
  });
  it("anon cannot read or search", async () => {
    await expect(db.query("set role anon; select 1 from public.opportunities").finally(() => db.query("reset role"))).rejects.toThrow();
  });
  it("publishing a listing whose deadline has passed is refused", async () => {
    const o = await org(MOD, "Late Org");
    const id = await opp(MOD, { org: o, title: "Soon gone", deadline: await plusDays(2) });
    await setClock(new Date(Date.now() + 5 * 86_400_000).toISOString());
    try {
      await fails(MOD, "select public.admin_set_opportunity_status($1, 'published')", [id]);
    } finally {
      await clearClock();
    }
    expect((await publish(id))[0]!.ok).toBe(true); // positive control with the real clock
  });
});

describe("search_opportunities", () => {
  let oAz: string, oEn: string;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    await raw("update public.opportunities set status = 'archived' where status = 'published'"); // isolate from earlier suites
    oAz = await org(MOD, "Azərbaycan Texnologiya Mərkəzi");
    oEn = await org(MOD, "Globex Ltd");
    ids.net = await opp(MOD, { org: oAz, kind: "internship", title: "Şəbəkə mühəndisi təcrübəçi", location: "Bakı", deadline: await plusDays(10), skills: ["Python", "Şəbəkə"], languages: ["az", "en"] });
    ids.remote = await opp(MOD, { org: oEn, kind: "junior_job", title: "Junior web developer", location: "Remote / İstanbul", remote: true, deadline: await plusDays(40), skills: ["JavaScript", "SQL"] });
    ids.nodl = await opp(MOD, { org: oEn, kind: "scholarship", title: "Global scholarship", deadline: null, skills: [] });
    ids.hack = await opp(MOD, { org: oEn, kind: "hackathon", title: "Campus hackathon 100% fun_", deadline: await plusDays(3), skills: ["python"] });
    ids.draft = await opp(MOD, { org: oEn, kind: "competition", title: "Draft competition" });
    ids.arch = await opp(MOD, { org: oEn, kind: "exchange", title: "Archived exchange", deadline: await plusDays(5) });
    for (const k of ["net", "remote", "nodl", "hack", "arch"]) await publish(ids[k]!);
    await setStatus(MOD, ids.arch!, "archived");
  });
  const titles = async (args: Record<string, unknown>) => (await search(S1, args)).map((r) => r.title as string);

  it("returns only published, unexpired listings; default order is soonest deadline first, no-deadline last", async () => {
    expect(await titles({})).toEqual(["Campus hackathon 100% fun_", "Şəbəkə mühəndisi təcrübəçi", "Junior web developer", "Global scholarship"]);
  });
  it("az/tr-aware normalisation in query, organization name and location", async () => {
    expect(await titles({ q: "sebeke" })).toEqual(["Şəbəkə mühəndisi təcrübəçi"]);
    expect(await titles({ q: "ŞƏBƏKƏ MÜHƏNDİSİ" })).toEqual(["Şəbəkə mühəndisi təcrübəçi"]);
    expect(await titles({ q: "azerbaycan texnologiya" })).toEqual(["Şəbəkə mühəndisi təcrübəçi"]); // organization name
    expect(await titles({ location: "baki" })).toEqual(["Şəbəkə mühəndisi təcrübəçi"]);
    expect(await titles({ location: "ISTANBUL" })).toEqual(["Junior web developer"]);
    expect(await titles({ q: "nothing matches this" })).toEqual([]);
  });
  it("treats LIKE wildcards in the query literally", async () => {
    expect(await titles({ q: "100%" })).toEqual(["Campus hackathon 100% fun_"]);
    expect(await titles({ q: "%" })).toEqual(["Campus hackathon 100% fun_"]);
    expect(await titles({ q: "_" })).toEqual(["Campus hackathon 100% fun_"]);
  });
  it("filters by kind, remote, deadline_before, skills; skills match across diacritics/case", async () => {
    expect(await titles({ kind: "junior_job" })).toEqual(["Junior web developer"]);
    expect(await titles({ remote: true })).toEqual(["Junior web developer"]);
    expect((await titles({ remote: false })).length).toBe(4); // false = no filter
    expect(await titles({ before: await plusDays(10) })).toEqual(["Campus hackathon 100% fun_", "Şəbəkə mühəndisi təcrübəçi"]);
    expect(await titles({ skills: ["PYTHON"] })).toEqual(["Campus hackathon 100% fun_", "Şəbəkə mühəndisi təcrübəçi"]);
    expect(await titles({ skills: ["sebeke"] })).toEqual(["Şəbəkə mühəndisi təcrübəçi"]);
    expect(await titles({ skills: ["sql", "cobol"] })).toEqual(["Junior web developer"]);
    await fails(S1, "select * from public.search_opportunities(null, 'full_time')");
  });
  it("hides expired listings by default and shows them on request", async () => {
    await setClock(new Date(Date.now() + 5 * 86_400_000).toISOString());
    try {
      expect(await titles({})).not.toContain("Campus hackathon 100% fun_"); // deadline +3d is now past
      expect(await titles({})).toContain("Şəbəkə mühəndisi təcrübəçi");
      expect(await titles({ expired: true })).toContain("Campus hackathon 100% fun_");
      expect(await titles({ before: await plusDays(10), expired: false })).not.toContain("Campus hackathon 100% fun_");
    } finally {
      await clearClock();
    }
    expect(await titles({})).toContain("Campus hackathon 100% fun_");
  });
  it("sorts newest-first, paginates and caps limits; rejects unknown sort", async () => {
    const all = await titles({ sort: "newest" });
    expect(all.length).toBe(4);
    expect(all[0]).toBe("Campus hackathon 100% fun_"); // published last among the visible ones
    const p1 = await titles({ sort: "deadline", limit: 2, offset: 0 });
    const p2 = await titles({ sort: "deadline", limit: 2, offset: 2 });
    expect([...p1, ...p2]).toEqual(await titles({}));
    expect((await titles({ limit: 0 })).length).toBe(1); // clamped to >= 1
    await fails(S1, "select * from public.search_opportunities(null, null, null, null, null, null, 'random')");
  });
  it("reports the caller's own tracking status per row, never someone else's", async () => {
    await rows(S1, "select public.track_opportunity($1, 'applied')", [ids.net]);
    expect((await search(S1, { q: "sebeke" }))[0]!.tracked_status).toBe("applied");
    expect((await search(S2, { q: "sebeke" }))[0]!.tracked_status).toBeNull();
  });
});

describe("opportunity_tracking (self-tracking only)", () => {
  let o: string, id: string, id2: string;
  beforeAll(async () => {
    o = await org(MOD, "Tracking Org");
    id = await opp(MOD, { org: o, title: "Trackable", deadline: await plusDays(20), skills: ["Excel"] });
    id2 = await opp(MOD, { org: o, title: "Never published" });
    await publish(id);
  });
  it("tracks a published listing, is idempotent, and keeps notes", async () => {
    const a = (await rows(S1, "select public.track_opportunity($1, 'saved', 'my note') as id", [id]))[0]!.id;
    const b = (await rows(S1, "select public.track_opportunity($1, 'applied') as id", [id]))[0]!.id;
    expect(b).toBe(a);
    const t = (await rows(S1, "select status, notes, applied_at, snapshot_title from public.opportunity_tracking where user_id = $1 and opportunity_id = $2", [S1, id]))[0]!;
    expect(t).toMatchObject({ status: "applied", notes: "my note", snapshot_title: "Trackable" });
    expect(t.applied_at).not.toBeNull();
    expect((await rows(S1, "select count(*)::int as n from public.opportunity_tracking where opportunity_id = $1", [id]))[0]!.n).toBe(1);
  });
  it("cannot track drafts or unknown listings, or use an invalid status", async () => {
    await fails(S1, "select public.track_opportunity($1)", [id2]);
    await fails(S1, "select public.track_opportunity($1)", ["00000000-0000-4000-8000-0000000000aa"]);
    await fails(S1, "select public.track_opportunity($1, 'hired')", [id]);
    await fails(S1, "select public.track_opportunity($1, 'saved', $2)", [id, "x".repeat(2001)]);
  });
  it("is private to its owner: others read, update and delete nothing (positive control: the owner can)", async () => {
    expect((await rows(S1, "select id from public.opportunity_tracking")).length).toBeGreaterThan(0);
    expect(await rows(S2, "select id from public.opportunity_tracking")).toEqual([]);
    expect(await rows(S2, "update public.opportunity_tracking set status = 'offer' where opportunity_id = $1 returning id", [id])).toEqual([]);
    expect(await rows(S2, "delete from public.opportunity_tracking where opportunity_id = $1 returning id", [id])).toEqual([]);
    expect((await rows(S2, "select * from public.my_opportunity_tracking()"))).toEqual([]);
    expect((await rows(S1, "update public.opportunity_tracking set status = 'interview', notes = 'call on Monday' where opportunity_id = $1 returning id", [id])).length).toBe(1);
  });
  it("users can only change status and notes; they cannot insert rows or edit snapshots/identity", async () => {
    await fails(S1, "insert into public.opportunity_tracking (user_id, opportunity_id, snapshot_title, snapshot_organization, snapshot_kind) values ($1, $2, 't', 'o', 'internship')", [S2, id]);
    await fails(S1, "update public.opportunity_tracking set snapshot_title = 'forged' where user_id = $1", [S1]);
    await fails(S1, "update public.opportunity_tracking set user_id = $2 where user_id = $1", [S1, S2]);
    await fails(S1, "update public.opportunity_tracking set status = 'hired' where user_id = $1", [S1]);
  });
  it("the board shows live data, then the snapshot when a listing is archived or deleted", async () => {
    let b = (await rows(S1, "select * from public.my_opportunity_tracking() where title = 'Trackable'"))[0]!;
    expect(b).toMatchObject({ listing_state: "published", organization: "Tracking Org", status: "interview", notes: "call on Monday" });
    expect(b.skills).toEqual(["Excel"]);
    await setStatus(MOD, id, "archived");
    b = (await rows(S1, "select * from public.my_opportunity_tracking() where title = 'Trackable'"))[0]!;
    expect(b.listing_state).toBe("unavailable");
    expect(b.skills).toEqual([]);
    await rows(MOD, "select public.admin_delete_opportunity($1, 'taken down by the organisation')", [id]);
    b = (await rows(S1, "select * from public.my_opportunity_tracking() where title = 'Trackable'"))[0]!;
    expect(b).toMatchObject({ listing_state: "removed", opportunity_id: null, notes: "call on Monday", organization: "Tracking Org" });
    expect((await rows(S1, "delete from public.opportunity_tracking where id = $1 returning id", [b.id])).length).toBe(1); // owner can remove it
  });
});

describe("cv_documents", () => {
  const cvData = JSON.stringify({ personal: { fullName: "Test Student" }, skills: ["SQL"] });
  const insert = (uid: string, owner: string, data: string = cvData, extra = "") =>
    rows(uid, `insert into public.cv_documents (user_id, title, language, template, data) values ($1, 'My CV', 'az', 'classic', $2::jsonb) ${extra} returning id`, [owner, data]);

  it("owner CRUD works and other users see and touch nothing", async () => {
    const id = (await insert(S1, S1))[0]!.id;
    expect((await rows(S1, "select id from public.cv_documents where id = $1", [id])).length).toBe(1);
    expect((await rows(S1, "update public.cv_documents set title = 'Renamed', template = 'modern', language = 'en' where id = $1 returning id", [id])).length).toBe(1);
    expect(await rows(S2, "select id from public.cv_documents where id = $1", [id])).toEqual([]);
    expect(await rows(S2, "update public.cv_documents set title = 'stolen' where id = $1 returning id", [id])).toEqual([]);
    expect(await rows(S2, "delete from public.cv_documents where id = $1 returning id", [id])).toEqual([]);
    expect(await rows(MOD, "select id from public.cv_documents where id = $1", [id])).toEqual([]); // not even staff
    expect((await raw("select title, template from public.cv_documents where id = $1", [id]))[0]).toMatchObject({ title: "Renamed", template: "modern" });
    expect((await rows(S1, "delete from public.cv_documents where id = $1 returning id", [id])).length).toBe(1);
  });
  it("cannot insert for someone else or move a CV to another user", async () => {
    await fails(S1, "insert into public.cv_documents (user_id, data) values ($1, '{}')", [S2]);
    const id = (await insert(S1, S1))[0]!.id;
    await fails(S1, "update public.cv_documents set user_id = $2 where id = $1", [id, S2]);
    await rows(S1, "delete from public.cv_documents where id = $1", [id]);
  });
  it("rejects malformed structure, oversize data, bad language/template", async () => {
    await fails(S1, "insert into public.cv_documents (user_id, data) values ($1, '[]')", [S1]);
    await fails(S1, "insert into public.cv_documents (user_id, data) values ($1, '{\"hack\": 1}')", [S1]);
    await fails(S1, "insert into public.cv_documents (user_id, data) values ($1, '{\"skills\": \"SQL\"}')", [S1]);
    await fails(S1, "insert into public.cv_documents (user_id, data) values ($1, '{\"personal\": []}')", [S1]);
    await fails(S1, "insert into public.cv_documents (user_id, data) values ($1, $2::jsonb)", [S1, JSON.stringify({ summary: "x".repeat(61_000) })]);
    await fails(S1, "insert into public.cv_documents (user_id, language, data) values ($1, 'de', '{}')", [S1]);
    await fails(S1, "insert into public.cv_documents (user_id, template, data) values ($1, 'Bad Template!', '{}')", [S1]);
    await fails(S1, "insert into public.cv_documents (user_id, title, data) values ($1, '  ', '{}')", [S1]);
    expect((await insert(S1, S1, JSON.stringify({ summary: "x".repeat(50_000) })))[0]!.id).toBeTruthy(); // positive control: big but under the cap
    await raw("delete from public.cv_documents where user_id = $1", [S1]);
  });
  it("limits an account to 5 CVs", async () => {
    for (let i = 0; i < 5; i++) await insert(S2, S2);
    expect(await fails(S2, "insert into public.cv_documents (user_id, data) values ($1, '{}')", [S2])).toMatch(/at most 5/);
    await raw("delete from public.cv_documents where user_id = $1", [S2]);
  });
});

describe("career_ai_cache and export", () => {
  it("is invisible to API roles", async () => {
    await fails(S1, "select * from public.career_ai_cache");
    await fails(S1, "insert into public.career_ai_cache (user_id, task, params_hash, output) values ($1, 'cv_feedback', 'abcdefgh', '{}')", [S1]);
    await expect(db.query("set role anon; select 1 from public.career_ai_cache").finally(() => db.query("reset role"))).rejects.toThrow();
  });
  it("service_role can use it (positive control) and rejects unknown tasks", async () => {
    await raw("set role service_role");
    try {
      await raw("insert into public.career_ai_cache (user_id, task, params_hash, output) values ($1, 'cv_feedback', 'abcdefgh', '{\"a\":1}')", [S1]);
      expect((await raw("select output from public.career_ai_cache where user_id = $1", [S1]))[0]!.output).toEqual({ a: 1 });
      await expect(raw("insert into public.career_ai_cache (user_id, task, params_hash, output) values ($1, 'chat', 'abcdefgh', '{}')", [S1])).rejects.toThrow();
    } finally {
      await raw("reset role");
    }
  });
  it("export_my_data includes the caller's CVs and tracking only", async () => {
    await rows(S1, "insert into public.cv_documents (user_id, title, data) values ($1, 'Exported CV', '{}')", [S1]);
    const e = (await rows(S1, "select public.export_my_data() as j"))[0]!.j;
    expect(e.cv_documents.map((c: any) => c.title)).toEqual(["Exported CV"]);
    expect(Array.isArray(e.opportunity_tracking)).toBe(true);
    expect(e.profile.id).toBe(S1); // the pre-existing export still works
    const other = (await rows(S2, "select public.export_my_data() as j"))[0]!.j;
    expect(other.cv_documents).toEqual([]);
  });
  it("deleting an account cascades CVs, tracking and cache", async () => {
    const victim = U(9);
    await raw("insert into auth.users (id, email) values ($1, 'victim@example.test')", [victim]);
    await rows(victim, "insert into public.cv_documents (user_id, data) values ($1, '{}')", [victim]);
    await raw("delete from public.profiles where id = $1", [victim]);
    expect((await raw("select count(*)::int as n from public.cv_documents where user_id = $1", [victim]))[0]!.n).toBe(0);
  });
});

describe("AI task routing for career", () => {
  it("the new tasks exist in the enum but have no route until an admin sets one", async () => {
    const t = (await raw("select unnest(enum_range(null::public.ai_task))::text as t")).map((r) => r.t);
    expect(t).toEqual(expect.arrayContaining(["cv_feedback", "interview_prep"]));
    expect((await raw("select count(*)::int as n from public.ai_task_routes where task in ('cv_feedback', 'interview_prep')"))[0]!.n).toBe(0);
    const cfg = (await raw("select public.ai_load_config() as c"))[0]!.c;
    expect((cfg.routes ?? []).filter((r: any) => r.task === "cv_feedback")).toEqual([]);
  });
  it("an admin can route them; non-admins cannot", async () => {
    const prov = (await rows(ADMIN, "select public.admin_set_ai_provider('career-test', 'openai', true, null) as id"))[0]!.id;
    const model = (await rows(ADMIN, "select public.admin_set_ai_model($1, 'm-small', 'small', 100000, 400000, 10000, 4096, true, true) as id", [prov]))[0]!.id;
    await fails(S1, "select public.admin_set_ai_route('cv_feedback'::public.ai_task, 'free', $1, '{}', 10)", [model]);
    await rows(ADMIN, "select public.admin_set_ai_route('cv_feedback'::public.ai_task, 'free', $1, '{}', 10)", [model]);
    await rows(ADMIN, "select public.admin_set_ai_route('interview_prep'::public.ai_task, 'free', $1, '{}', 10)", [model]);
    const cfg = (await raw("select public.ai_load_config() as c"))[0]!.c;
    expect(cfg.routes.map((r: any) => r.task).sort()).toEqual(["cv_feedback", "interview_prep"]);
  });
});
