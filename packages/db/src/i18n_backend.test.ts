import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { affected, asAnon, asUser, createTestDb, ids, seedFixtures, select } from "./harness";

// Migration 20260101003300 (+ 3600 language columns): locales, notification templates, system content, rendering.
// NOTE: the seeded copy needs native-speaker review (see the migration header); these tests check structure only.
let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
  await seedFixtures(db);
}, 120_000);
afterAll(async () => {
  await db.close();
});

const LOCALES = ["az", "tr", "en", "ru"];
const KEYS = ["welcome", "document_ready", "deletion_requested", "deletion_cancelled", "plan_expiring", "plan_expired", "report_resolved", "achievement_unlocked", "challenge_completed"];
const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params));
let n = 0;
const newUser = async (locale?: string) => {
  n++;
  const id = `00000000-0000-4000-8000-0000005${String(n).padStart(5, "0")}`;
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `i18n${n}@example.test`]);
  if (locale) await db.query("update public.profiles set locale = $2 where id = $1", [id, locale]);
  return id;
};

describe("profiles.locale", () => {
  it("defaults to az; accepts az/tr/en/ru; rejects anything else; users can switch their own", async () => {
    const u = await newUser();
    expect((await raw("select locale from public.profiles where id = $1", [u]))[0]!.locale).toBe("az");
    for (const l of LOCALES) {
      expect((await run(u, "update public.profiles set locale = $2 where id = $1", [u, l])).affectedRows).toBe(1);
      expect((await raw("select locale from public.profiles where id = $1", [u]))[0]!.locale).toBe(l);
    }
    await expect(run(u, "update public.profiles set locale = 'de' where id = $1", [u])).rejects.toThrow(/profiles_locale_check/);
    await expect(run(u, "update public.profiles set locale = 'RU' where id = $1", [u])).rejects.toThrow(/profiles_locale_check/);
  });
});

describe("profiles.locale_set_at (migration 20260101003900)", () => {
  const setAt = async (u: string) => (await raw("select locale_set_at from public.profiles where id = $1", [u]))[0]!.locale_set_at;
  it("is null for a new profile, and stamped by the database whenever locale is written", async () => {
    const u = await newUser();
    expect(await setAt(u)).toBeNull();
    await run(u, "update public.profiles set display_name = 'x' where id = $1", [u]);
    expect(await setAt(u)).toBeNull(); // unrelated updates do not count as a language choice
    await run(u, "update public.profiles set locale = 'az' where id = $1", [u]); // re-choosing the default is still a choice
    expect(await setAt(u)).not.toBeNull();
  });
  it("ignores a client-supplied value when locale is written", async () => {
    const u = await newUser();
    await run(u, "update public.profiles set locale = 'ru', locale_set_at = '2000-01-01' where id = $1", [u]);
    expect(new Date(await setAt(u)).getFullYear()).toBeGreaterThan(2020);
  });
});

describe("notification_templates seeds", () => {
  it("every event has all four locales, non-empty copy, and identical placeholders across locales", async () => {
    const rows = await raw("select key, locale, title, body from public.notification_templates order by key, locale");
    expect([...new Set(rows.map((r) => r.key))].sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      const per = rows.filter((r) => r.key === key);
      expect(per.map((r) => r.locale).sort(), key).toEqual([...LOCALES].sort());
      const ph = (s: string) => [...new Set((s.match(/\{\w+\}/g) ?? []))].sort().join(",");
      const sets = new Set(per.map((r) => ph(`${r.title} ${r.body}`)));
      expect(sets.size, `placeholders of ${key}`).toBe(1);
      for (const r of per) {
        expect(r.title.trim().length).toBeGreaterThan(3);
        expect((r.body as string).trim().length).toBeGreaterThan(10);
      }
    }
    // locale-specific characters are really there (not pasted English)
    const t = (k: string, l: string) => rows.find((r) => r.key === k && r.locale === l)!.title as string;
    expect(t("plan_expired", "az")).toMatch(/[əıöüçşğ]/i);
    expect(t("plan_expired", "tr")).toMatch(/[ıöüçşğ]/i);
    expect(t("plan_expired", "ru")).toMatch(/[а-я]/i);
  });
  it("uniqueness on (key, locale); templates are readable by signed-in users, not anon, and not writable by them", async () => {
    await expect(db.query("insert into public.notification_templates (key, locale, title) values ('welcome', 'az', 'dup')")).rejects.toThrow(/duplicate key/);
    const u = await newUser();
    expect((await select(db, "authenticated", u, "select key from public.notification_templates")).length).toBe(KEYS.length * 4);
    expect(await select(db, "anon", null, "select key from public.notification_templates")).toEqual([]);
    expect(await affected(db, "authenticated", u, "insert into public.notification_templates (key, locale, title) values ('x', 'az', 't')")).toBe(0);
    expect(await affected(db, "authenticated", u, "update public.notification_templates set title = 'hacked'")).toBe(0);
    expect(await affected(db, "authenticated", u, "delete from public.notification_templates")).toBe(0);
    expect(await affected(db, "authenticated", ids.admin, "update public.notification_templates set title = 'hacked'")).toBe(0); // admins write through the RPC only
  });
});

describe("render_notification (recipient locale, az fallback)", () => {
  it("renders deletion_requested per recipient locale with params substituted", async () => {
    const out: Record<string, any> = {};
    for (const l of LOCALES) {
      const u = await newUser(l);
      await run(u, "select public.request_account_deletion()");
      const nid = (await select(db, "authenticated", u, "select id from public.notifications"))[0]!.id;
      out[l] = (await run(u, "select public.render_notification($1) r", [nid])).rows[0]!.r;
      expect(out[l].locale).toBe(l);
      expect(out[l].body).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(out[l].body + out[l].title).not.toMatch(/[{}]/);
    }
    expect(new Set(Object.values(out).map((o: any) => o.title)).size).toBe(4); // four different texts
    expect(out.en.title).toBe("Account deletion requested");
    expect(out.ru.title).toMatch(/удален/i);
  });

  it("cancel produces its own notification; the view shows only the caller's rows", async () => {
    const u = await newUser("tr");
    const w = await newUser("en");
    await run(u, "select public.request_account_deletion()");
    expect((await run(u, "select public.cancel_account_deletion() ok")).rows[0]!.ok).toBe(true);
    await run(w, "select public.request_account_deletion()");
    const mine = await select(db, "authenticated", u, "select template_key, title, locale from public.notifications_rendered order by created_at, template_key");
    expect(mine.map((r) => r.template_key).sort()).toEqual(["deletion_cancelled", "deletion_requested"]);
    expect(mine.every((r) => r.locale === "tr")).toBe(true);
    expect(await select(db, "anon", null, "select * from public.notifications_rendered")).toEqual([]);
    const theirs = await select(db, "authenticated", w, "select title from public.notifications_rendered");
    expect(theirs.length).toBe(1);
    // render_notification of someone else's id yields nothing
    const nid = (await raw("select id from public.notifications where user_id = $1 limit 1", [u]))[0]!.id;
    expect((await run(w, "select public.render_notification($1) r", [nid])).rows[0]!.r).toBeNull();
  });

  it("falls back to az when the locale has no template, and to the stored legacy title when there is no template", async () => {
    const u = await newUser("tr");
    await raw("delete from public.notification_templates where key = 'report_resolved' and locale = 'tr'");
    const nid = (await raw("select public.notify_user($1, 'report_resolved') id", [u]))[0]!.id;
    expect((await run(u, "select public.render_notification($1) r", [nid])).rows[0]!.r).toMatchObject({ locale: "az", title: "Şikayətinizə baxıldı" });
    await raw("insert into public.notification_templates (key, locale, title, body) values ('report_resolved', 'tr', 'Şikâyetiniz incelendi', 'x')");
    expect((await run(u, "select public.render_notification($1) r", [nid])).rows[0]!.r).toMatchObject({ locale: "tr" });
    const legacy = (await raw("insert into public.notifications (user_id, kind, title, body) values ($1, 'x', 'Old title', 'Old body') returning id", [u]))[0]!.id;
    expect((await run(u, "select public.render_notification($1) r", [legacy])).rows[0]!.r).toMatchObject({ title: "Old title", body: "Old body" });
  });

  it("users cannot create notifications or change their template/params; they can still mark them read", async () => {
    const u = await newUser();
    await run(u, "select public.request_account_deletion()");
    expect(await affected(db, "authenticated", u, "insert into public.notifications (user_id, kind, template_key) values ($1, 'x', 'welcome')", [u])).toBe(0);
    expect(await affected(db, "authenticated", u, "update public.notifications set template_key = 'welcome' where user_id = $1", [u])).toBe(0);
    expect(await affected(db, "authenticated", u, "update public.notifications set params = '{}'::jsonb where user_id = $1", [u])).toBe(0);
    expect(await affected(db, "authenticated", u, "update public.notifications set read_at = now() where user_id = $1", [u])).toBe(1);
    await expect(run(u, "select public.notify_user($1, 'welcome')", [u])).rejects.toThrow(/permission denied/);
    await expect(raw("select public.notify_user($1, 'no_such_template')", [u])).rejects.toThrow(/unknown notification template/);
  });
});

describe("admin_set_notification_template", () => {
  it("admin edits are audited and take effect; students and moderators are denied; bad input rejected", async () => {
    const u = await newUser("en");
    await expect(run(ids.alice, "select public.admin_set_notification_template('welcome','en','T','B','typo fix')")).rejects.toThrow(/admin privileges/);
    await expect(run(ids.mod, "select public.admin_set_notification_template('welcome','en','T','B','typo fix')")).rejects.toThrow(/admin privileges/);
    await expect(run(ids.admin, "select public.admin_set_notification_template('welcome','de','T','B','typo fix')")).rejects.toThrow(/valid key, locale/);
    await expect(run(ids.admin, "select public.admin_set_notification_template('Bad Key','en','T','B','typo fix')")).rejects.toThrow(/valid key, locale/);
    await run(ids.admin, "select public.admin_set_notification_template('welcome','en','Welcome aboard','Hi {name}, enjoy!','copy edit')");
    const nid = (await raw("select public.notify_user($1, 'welcome', '{\"name\":\"Aysel\"}'::jsonb) id", [u]))[0]!.id;
    expect((await run(u, "select public.render_notification($1) r", [nid])).rows[0]!.r).toMatchObject({ title: "Welcome aboard", body: "Hi Aysel, enjoy!" });
    const a = await raw("select actor_id, metadata from public.audit_logs where action = 'notification_template.set' and entity_id = 'welcome:en'");
    expect(a.length).toBe(1);
    expect(a[0]).toMatchObject({ actor_id: ids.admin });
  });
});

describe("system_content (public read, audited admin writes, revertible)", () => {
  it("anyone can read; nobody writes directly; admin RPC versions, audits and reverts", async () => {
    const u = await newUser();
    await expect(run(u, "select public.admin_set_system_content('terms.intro','az','{\"t\":1}'::jsonb,'first draft')")).rejects.toThrow(/admin privileges/);
    expect(await run(ids.admin, "select public.admin_set_system_content('terms.intro','az','{\"t\":\"v1\"}'::jsonb,'first draft') v")).toMatchObject({ rows: [{ v: 1 }] });
    expect((await run(ids.superAdmin, "select public.admin_set_system_content('terms.intro','az','{\"t\":\"v2\"}'::jsonb,'second draft') v")).rows[0]!.v).toBe(2);
    await run(ids.admin, "select public.admin_set_system_content('terms.intro','ru','{\"t\":\"ru\"}'::jsonb,'russian')");
    // public read, including anon (positive control)
    expect((await select(db, "anon", null, "select body from public.system_content where key = 'terms.intro' and locale = 'az'"))[0]!.body).toEqual({ t: "v2" });
    expect((await select(db, "authenticated", u, "select locale from public.system_content where key = 'terms.intro' order by locale")).map((r) => r.locale)).toEqual(["az", "ru"]);
    // direct writes denied for students AND admins (RPC only)
    for (const who of [u, ids.admin]) {
      expect(await affected(db, "authenticated", who, "insert into public.system_content (key, locale, body) values ('x','az','{}')")).toBe(0);
      expect(await affected(db, "authenticated", who, "update public.system_content set body = '{}'")).toBe(0);
      expect(await affected(db, "authenticated", who, "delete from public.system_content")).toBe(0);
    }
    expect(await affected(db, "anon", null, "update public.system_content set body = '{}'")).toBe(0);
    // history is admin-only
    expect(await select(db, "authenticated", u, "select * from public.system_content_versions")).toEqual([]);
    expect((await select(db, "authenticated", ids.admin, "select version from public.system_content_versions where key = 'terms.intro' and locale = 'az' order by version")).map((r) => r.version)).toEqual([1, 2]);
    // revert -> a NEW version with the old body
    expect((await run(ids.admin, "select public.admin_revert_system_content('terms.intro','az',1,'bad edit') v")).rows[0]!.v).toBe(3);
    expect((await raw("select body, version from public.system_content where key = 'terms.intro' and locale = 'az'"))[0]).toMatchObject({ body: { t: "v1" }, version: 3 });
    await expect(run(ids.admin, "select public.admin_revert_system_content('terms.intro','az',99,'nope')")).rejects.toThrow(/version not found/);
    await expect(run(u, "select public.admin_revert_system_content('terms.intro','az',1,'nope')")).rejects.toThrow(/admin privileges/);
    const audit = await raw("select metadata from public.audit_logs where action = 'content.set' and entity_id = 'terms.intro:az' order by id");
    expect(audit.length).toBe(3);
    expect(audit[2]!.metadata).toMatchObject({ from_version: 2, to_version: 3 });
    // content edits never touch the AI config versions
    expect((await raw("select count(*)::int c from public.config_versions"))[0]!.c).toBe(0);
  });
  it("validates key, locale, size and reason", async () => {
    await expect(run(ids.admin, "select public.admin_set_system_content('Bad Key','az','{}'::jsonb,'reason ok')")).rejects.toThrow(/valid key/);
    await expect(run(ids.admin, "select public.admin_set_system_content('k','de','{}'::jsonb,'reason ok')")).rejects.toThrow(/valid key/);
    await expect(run(ids.admin, "select public.admin_set_system_content('k','az','{}'::jsonb,'x')")).rejects.toThrow(/valid key/);
    await expect(asAnon(db, (tx) => tx.query("select public.admin_set_system_content('k','az','{}'::jsonb,'reason ok')"))).rejects.toThrow(/permission denied/);
  });
});

describe("output_language / source_language columns", () => {
  it("default output language is the owner's profile locale; source is nullable; both validated", async () => {
    for (const l of LOCALES) {
      const u = await newUser(l);
      const q = (await raw("insert into public.quizzes (user_id, title) values ($1, 'q') returning output_language, source_language", [u]))[0]!;
      expect(q).toMatchObject({ output_language: l, source_language: null });
      expect((await raw("insert into public.flashcards (user_id, front, back) values ($1, 'f', 'b') returning output_language", [u]))[0]!.output_language).toBe(l);
      expect((await raw("insert into public.conversations (user_id) values ($1) returning output_language", [u]))[0]!.output_language).toBe(l);
    }
    const u = await newUser("ru");
    const explicit = (await raw("insert into public.quizzes (user_id, title, output_language, source_language) values ($1, 'q', 'en', 'az') returning output_language, source_language", [u]))[0]!;
    expect(explicit).toMatchObject({ output_language: "en", source_language: "az" }); // independent of the ru profile
    await expect(db.query("insert into public.quizzes (user_id, title, output_language) values ($1, 'q', 'de')", [u])).rejects.toThrow(/output_language_check/);
    await expect(db.query("insert into public.quizzes (user_id, title, source_language) values ($1, 'q', 'xx')", [u])).rejects.toThrow(/source_language_check/);
  });
});
