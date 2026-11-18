import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb } from "./harness";

// Migration 20260101005500 (legal consents + 16+ age check).

let db: PGlite;
let n = 0;
const uid = () => `00000000-0000-4000-8000-0000000b${String(++n).padStart(4, "0")}`;
const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const run = (u: string, sql: string, params: unknown[] = []) => asUser(db, u, (tx) => tx.query<Record<string, any>>(sql, params));
const msg = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  return "NO ERROR";
};
const bakuDate = async (offsetYears: number, offsetDays = 0) =>
  (await raw(`select ((now() at time zone 'Asia/Baku')::date - interval '${offsetYears} years' + interval '${offsetDays} days')::date::text as d`))[0]!.d as string;
const REQ = ["terms", "privacy_notice", "ai_disclaimer"];
const signup = (id: string, meta: Record<string, unknown>, app: Record<string, unknown> = { provider: "email" }) =>
  db.query("insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3, $4)", [
    id, `${id}@x.test`, JSON.stringify(meta), JSON.stringify(app),
  ]);
const ledger = (id: string) => raw("select * from public.user_consents where user_id = $1 order by id", [id]);

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

describe("signup enforcement", () => {
  it("valid signup creates profile, user_private, server-versioned ledger; ignores client version/hash", async () => {
    const id = uid();
    await signup(id, { display_name: " Ann ", birth_date: await bakuDate(20), consents: REQ, platform: "ios", version: "9.9", document_hash: "evil" });
    expect((await raw("select display_name from public.profiles where id = $1", [id]))[0]!.display_name).toBe("Ann");
    expect(await raw("select 1 from public.user_private where user_id = $1", [id])).toHaveLength(1);
    const rows = await ledger(id);
    expect(rows.map((r) => r.consent_type)).toEqual(REQ);
    expect(rows.every((r) => r.action === "granted" && r.context === "signup" && r.platform === "ios" && r.document_version === "0.1" && r.document_hash === "draft-0.1")).toBe(true);
    expect(rows.map((r) => r.document_slug)).toEqual(["terms", "privacy", "ai-disclaimer"]);
  });
  it("marketing only when ticked; unknown platform falls back", async () => {
    const a = uid();
    const b = uid();
    await signup(a, { birth_date: await bakuDate(20), consents: [...REQ, "marketing"], platform: "toaster" });
    await signup(b, { birth_date: await bakuDate(20), consents: REQ });
    const ra = await ledger(a);
    expect(ra).toHaveLength(4);
    expect(ra[3]).toMatchObject({ consent_type: "marketing", document_hash: null, platform: "unknown" });
    expect(await ledger(b)).toHaveLength(3);
  });
  it("age boundaries", async () => {
    expect(await msg(signup(uid(), { birth_date: await bakuDate(16, 1), consents: REQ }))).toContain("UNDERAGE");
    await signup(uid(), { birth_date: await bakuDate(16), consents: REQ });
    expect(await msg(signup(uid(), { birth_date: await bakuDate(0, 1), consents: REQ }))).toContain("UNDERAGE");
  });
  it("missing or invalid data rejected", async () => {
    const ok = await bakuDate(20);
    expect(await msg(signup(uid(), { consents: REQ }))).toContain("BIRTH_DATE_REQUIRED");
    expect(await msg(signup(uid(), { birth_date: "2009-02-30", consents: REQ }))).toContain("BIRTH_DATE_REQUIRED");
    expect(await msg(signup(uid(), { birth_date: ok }))).toContain("CONSENT_REQUIRED");
    expect(await msg(signup(uid(), { birth_date: ok, consents: ["terms", "privacy_notice"] }))).toContain("CONSENT_REQUIRED");
    expect(await msg(signup(uid(), { birth_date: ok, consents: "terms" }))).toContain("CONSENT_REQUIRED");
  });
  it("users without provider or consent_exempt keep the old path", async () => {
    const a = uid();
    const b = uid();
    await signup(a, { display_name: "Old" }, {});
    await signup(b, { display_name: "Admin made" }, { provider: "email", consent_exempt: "true" });
    expect(await raw("select 1 from public.profiles where id in ($1, $2)", [a, b])).toHaveLength(2);
    expect(await ledger(a)).toHaveLength(0);
    expect(await ledger(b)).toHaveLength(0);
  });
});

describe("access control", () => {
  it("own rows only; no client writes; ledger immutable", async () => {
    const a = uid();
    const b = uid();
    await signup(a, { birth_date: await bakuDate(20), consents: REQ });
    await signup(b, { birth_date: await bakuDate(20), consents: REQ });
    expect((await run(a, "select * from public.user_consents")).rows.every((r) => r.user_id === a)).toBe(true);
    expect((await run(a, "select * from public.user_consents")).rows).toHaveLength(3);
    expect((await run(a, "select * from public.user_private")).rows).toHaveLength(1);
    expect(await msg(run(a, "insert into public.user_consents (user_id, consent_type, action, platform, context) values ($1, 'marketing', 'granted', 'web', 'settings')", [a]))).toMatch(/permission denied/);
    expect(await msg(run(a, "update public.user_consents set action = 'withdrawn'"))).toMatch(/permission denied/);
    expect(await msg(run(a, "delete from public.user_consents"))).toMatch(/permission denied/);
    expect(await msg(run(a, "update public.user_private set birth_date = '2000-01-01'"))).toMatch(/permission denied/);
    expect(await msg(db.query("update public.user_consents set action = 'withdrawn' where user_id = $1", [a]))).toContain("append-only");
    expect((await run(a, "select * from public.legal_documents")).rows.length).toBeGreaterThanOrEqual(3);
    expect(await msg(run(a, "insert into public.legal_documents (slug, version, content_hash) values ('x','1','h')"))).toMatch(/permission denied/);
  });
  it("deleting the auth user cascades", async () => {
    const a = uid();
    await signup(a, { birth_date: await bakuDate(20), consents: REQ });
    await db.query("delete from auth.users where id = $1", [a]);
    expect(await ledger(a)).toHaveLength(0);
    expect(await raw("select 1 from public.user_private where user_id = $1", [a])).toHaveLength(0);
  });
});

describe("RPCs", () => {
  it("record_consents / withdraw_consent", async () => {
    const a = uid();
    await signup(a, { birth_date: await bakuDate(20), consents: REQ });
    await run(a, "select public.record_consents(array['marketing'], 'web', 'settings')");
    expect((await ledger(a)).at(-1)).toMatchObject({ consent_type: "marketing", action: "granted", context: "settings", document_hash: null });
    await run(a, "select public.withdraw_consent('marketing')");
    expect((await ledger(a)).at(-1)).toMatchObject({ consent_type: "marketing", action: "withdrawn" });
    expect(await msg(run(a, "select public.withdraw_consent('terms')"))).toContain("REQUIRED_CONSENT");
    expect(await msg(run(a, "select public.record_consents(array['terms'], 'web', 'signup')"))).toContain("INVALID_CONTEXT");
    expect(await msg(run(a, "select public.record_consents(array['terms'], 'pc', 'settings')"))).toContain("INVALID_PLATFORM");
    expect(await msg(run(a, "select public.record_consents(array['nope'], 'web', 'settings')"))).toContain("INVALID_CONSENT_TYPE");
    expect(await msg(asUser(db, null, (tx) => tx.query("select public.withdraw_consent('marketing')")))).toContain("AUTH_REQUIRED");
  });
  it("set_birth_date", async () => {
    const a = uid();
    await signup(a, { display_name: "legacy" }, {});
    expect((await run(a, "select * from public.legal_profile_status()")).rows[0]!.has_birth_date).toBe(false);
    expect(await msg(run(a, "select public.set_birth_date($1)", [await bakuDate(0, 1)]))).toContain("INVALID_BIRTH_DATE");
    expect(await msg(run(a, "select public.set_birth_date('1850-01-01')"))).toContain("INVALID_BIRTH_DATE");
    expect(await msg(run(a, "select public.set_birth_date($1)", [await bakuDate(16, 1)]))).toContain("UNDERAGE");
    await run(a, "select public.set_birth_date($1)", [await bakuDate(16)]);
    expect((await run(a, "select * from public.legal_profile_status()")).rows[0]!.has_birth_date).toBe(true);
    expect(await msg(run(a, "select public.set_birth_date($1)", [await bakuDate(30)]))).toContain("BIRTH_DATE_LOCKED");
  });
  it("legal_consent_status flags needs_action after a new reconsent version", async () => {
    const a = uid();
    await signup(a, { birth_date: await bakuDate(20), consents: REQ });
    const st = async () => Object.fromEntries((await run(a, "select * from public.legal_consent_status()")).rows.map((r) => [r.consent_type, r]));
    let s = await st();
    expect(Object.values(s).map((r: any) => r.needs_action)).toEqual([false, false, false, false]);
    expect(s.marketing).toMatchObject({ required: false, granted: false });
    expect(s.terms).toMatchObject({ required: true, current_version: "0.1", accepted_version: "0.1", granted: true });
    await db.query("insert into public.legal_documents (slug, version, content_hash) values ('terms', '0.2', 'h2')");
    s = await st();
    expect(s.terms).toMatchObject({ current_version: "0.2", accepted_version: "0.1", needs_action: true });
    expect(s.privacy_notice.needs_action).toBe(false);
    await run(a, "select public.record_consents(array['terms'], 'web', 'reconsent')");
    expect((await st()).terms).toMatchObject({ accepted_version: "0.2", needs_action: false });
    await db.query("insert into public.legal_documents (slug, version, content_hash, requires_reconsent) values ('privacy', '0.2', 'h', false)");
    expect((await st()).privacy_notice.needs_action).toBe(false);
  });
});
