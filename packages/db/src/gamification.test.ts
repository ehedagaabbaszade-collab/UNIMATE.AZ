import type { PGlite } from "@electric-sql/pglite";
import { levelFromXp } from "@unimate/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createTestDb, ids, seedFixtures } from "./harness";

// Migrations 20260101004000 / 004050 / 004100: level curve, achievements, challenges, leaderboard, my_progress,
// notification RPCs. Client checks run as `authenticated` with auth.uid() set; each negative has a positive control.

let db: PGlite;
let uniA: string;
let uniB: string;
beforeAll(async () => {
  db = await createTestDb({ seed: true });
  await seedFixtures(db);
  const u = (await db.query<{ id: string }>("select id from public.universities order by name limit 2")).rows;
  uniA = u[0]!.id;
  uniB = u[1]!.id;
}, 120_000);
afterAll(async () => {
  await db.close();
});

const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params));
const rpc = async (uid: string, sql: string, params: unknown[] = []) => (await run(uid, sql, params)).rows[0]!.r as any;
let n = 0;
const newUser = async (opts: { name?: string; uni?: string; optIn?: boolean; locale?: string } = {}) => {
  n++;
  const id = `00000000-0000-4000-8000-0000004${String(n).padStart(5, "0")}`;
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `gm${n}@example.test`]);
  await db.query("update public.profiles set display_name = $2, university_id = $3, leaderboard_opt_in = $4, locale = $5 where id = $1", [
    id,
    opts.name ?? `User${n}`,
    opts.uni ?? uniA,
    opts.optIn ?? false,
    opts.locale ?? "az",
  ]);
  return id;
};
const addXp = (uid: string, points: number, kind = "quiz_correct", createdAt = "now()") =>
  raw(`insert into public.xp_events (user_id, kind, points, source_key, created_at) values ($1, $2, $3, gen_random_uuid()::text, ${createdAt})`, [uid, kind, points]);
const evaluate = (uid: string) => asService(db, (tx) => tx.query<any>("select public.evaluate_achievements($1) as r", [uid])).then((r) => r.rows[0]!.r as number);
const unlocked = async (uid: string) =>
  (await raw("select a.code from public.user_achievements u join public.achievements a on a.id = u.achievement_id where u.user_id = $1 order by a.code", [uid])).map((r) => r.code as string);
const notifCount = async (uid: string, key: string) => (await raw("select count(*)::int c from public.notifications where user_id = $1 and template_key = $2", [uid, key]))[0]!.c as number;
const NAMES = JSON.stringify({ az: "a", tr: "a", en: "a", ru: "a" });

describe("level curve: SQL equals core levelFromXp", () => {
  it("matches over a table of values including every boundary up to level 12 and the cap", async () => {
    const xs = new Set<number>([0, 1, 49, 50, 51, 149, 150, 1239, 1240, 1399, 1400, 5000, 99999, 247499, 247500, 247501, 10_000_000]);
    for (let l = 1; l <= 12; l++) for (const d of [-1, 0, 1]) xs.add(Math.max(0, 25 * l * (l - 1) + d));
    for (const x of xs) {
      const sql = (await raw("select level, start_xp::int s, next_xp::int nx from public.level_from_xp($1)", [x]))[0]!;
      const js = levelFromXp(x);
      expect({ x, level: sql.level, s: sql.s, nx: sql.nx }).toEqual({ x, level: js.level, s: js.startXp, nx: js.nextXp });
    }
  });
});

describe("achievements: authz and seed", () => {
  it("starter set exists in all four languages with computable criteria", async () => {
    const rows = await raw("select code, name, description, criteria from public.achievements order by code");
    expect(rows.map((r) => r.code)).toEqual(["first_document", "first_quiz", "flashcards_10", "streak_3", "streak_30", "streak_7", "xp_100", "xp_1000"]);
    for (const r of rows)
      for (const l of ["az", "tr", "en", "ru"]) {
        expect(r.name[l]).toBeTruthy();
        expect(r.description[l]).toBeTruthy();
      }
  });

  it("students read the catalogue (positive control) but cannot write it; admin can; anon sees nothing", async () => {
    const u = await newUser();
    expect((await run(u, "select count(*)::int c from public.achievements")).rows[0]!.c).toBe(8);
    const ins = "insert into public.achievements (code, name, description, criteria, icon, active) values ($2, $1::jsonb, $1::jsonb, '{\"metric\":\"xp_total\",\"target\":5}', 'xp', false)";
    await expect(run(u, ins, [NAMES, "x_cheat"])).rejects.toThrow(/row-level security|permission denied/);
    await expect(run(u, "update public.achievements set active = false")).resolves.toMatchObject({ affectedRows: 0 });
    expect((await run(ids.admin, ins, [NAMES, "admin_made"])).affectedRows).toBe(1);
    expect((await run(u, "select count(*)::int c from public.achievements where code = 'admin_made'")).rows[0]!.c).toBe(0); // inactive hidden
    expect((await raw("select count(*)::int c from public.audit_logs where action = 'achievement.insert' and entity_id = 'admin_made'"))[0]!.c).toBe(1);
    await raw("delete from public.achievements where code = 'admin_made'");
    await expect(asAnon(db, (tx) => tx.query("select * from public.achievements"))).rejects.toThrow(/permission denied/);
  });

  it("invalid criteria are rejected by the database", async () => {
    for (const c of ['{"metric":"hacks","target":1}', '{"metric":"xp_total","target":0}', '{"metric":"xp_total","target":"5"}', "[]"]) {
      await expect(raw("insert into public.achievements (code, name, description, criteria, icon) values ('bad_one', $1::jsonb, $1::jsonb, $2::jsonb, 'xp')", [NAMES, c])).rejects.toThrow();
    }
    await expect(raw("insert into public.achievements (code, name, description, criteria, icon) values ('bad_two', '{\"az\":\"a\"}', '{\"az\":\"a\"}', '{\"metric\":\"xp_total\",\"target\":1}', 'xp')")).rejects.toThrow();
  });

  it("user_achievements: owner-only reads; no client writes; evaluate_achievements is not callable by clients", async () => {
    const a = await newUser();
    const b = await newUser();
    await addXp(a, 120);
    expect(await evaluate(a)).toBe(1);
    expect((await run(a, "select count(*)::int c from public.user_achievements")).rows[0]!.c).toBe(1); // positive control
    expect((await run(b, "select count(*)::int c from public.user_achievements")).rows[0]!.c).toBe(0);
    await expect(run(b, "insert into public.user_achievements (user_id, achievement_id) select $1, id from public.achievements limit 1", [b])).rejects.toThrow(/permission denied/);
    await expect(run(a, "delete from public.user_achievements")).rejects.toThrow(/permission denied/);
    await expect(run(a, "select public.evaluate_achievements($1)", [a])).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("select * from public.user_achievements"))).rejects.toThrow(/permission denied/);
  });
});

describe("achievement evaluation", () => {
  it("xp_total unlocks once, is idempotent and sends exactly one notification that renders in the recipient locale", async () => {
    const u = await newUser({ locale: "ru" });
    await addXp(u, 99);
    expect(await evaluate(u)).toBe(0);
    await addXp(u, 5);
    expect(await evaluate(u)).toBe(1);
    expect(await evaluate(u)).toBe(0);
    expect(await unlocked(u)).toEqual(["xp_100"]);
    expect(await notifCount(u, "achievement_unlocked")).toBe(1);
    const list = (await run(u, "select title, body from public.list_my_notifications()")).rows;
    expect(list[0]!.title).toBe("Новое достижение");
    expect(list[0]!.body).toBe("Вы получили достижение «100 XP».");
    await raw("update public.profiles set locale = 'tr' where id = $1", [u]);
    expect((await run(u, "select body from public.list_my_notifications()")).rows[0]!.body).toBe("“100 XP” başarısını kazandınız.");
  });

  it("a real quiz submit unlocks first_quiz; streak thresholds unlock on evaluation without duplicates", async () => {
    const u = await newUser();
    const quiz = (await raw("insert into public.quizzes (user_id, title, server_generated) values ($1, 'Q', true) returning id", [u]))[0]!.id;
    const qs: string[] = [];
    for (let i = 0; i < 3; i++) qs.push((await raw("insert into public.questions (quiz_id, position, kind, prompt, options, answer) values ($1, $2, 'mcq', 'p', '[\"a\",\"b\"]', 'b') returning id", [quiz, i]))[0]!.id);
    const answers = Object.fromEntries(qs.map((q) => [q, 1]));
    const r = await rpc(u, "select public.submit_quiz_attempt($1, $2::jsonb) as r", [quiz, JSON.stringify(answers)]);
    expect(r.xp_awarded).toBeGreaterThan(0);
    expect(await unlocked(u)).toEqual(["first_quiz"]);
    await raw("update public.streaks set current_streak = 3, longest_streak = 3 where user_id = $1", [u]);
    await evaluate(u);
    expect(await unlocked(u)).toEqual(["first_quiz", "streak_3"]);
    await evaluate(u);
    expect(await notifCount(u, "achievement_unlocked")).toBe(2);
  });

  it("the streak update inside review_flashcard (award_xp_internal) triggers evaluation", async () => {
    const u = await newUser();
    await raw("insert into public.streaks (user_id, current_streak, longest_streak, last_active_date) values ($1, 6, 6, (public.now_utc() at time zone 'Asia/Baku')::date - 1)", [u]);
    const fc = (await raw("insert into public.flashcards (user_id, front, back) values ($1, 'f', 'b') returning id", [u]))[0]!.id;
    const r = await rpc(u, "select public.review_flashcard($1, 'good') as r", [fc]);
    expect(r.reviewed).toBe(true);
    expect(await unlocked(u)).toEqual(["streak_3", "streak_7"]);
  });

  it("flashcards_10 counts rewarded reviews; first_document fires when a document turns ready", async () => {
    const u = await newUser();
    for (let i = 0; i < 9; i++) await addXp(u, 1, "review_completed");
    await evaluate(u);
    expect(await unlocked(u)).toEqual([]);
    await addXp(u, 1, "review_completed");
    await evaluate(u);
    expect(await unlocked(u)).toEqual(["flashcards_10"]);

    const d = (await raw("insert into public.documents (user_id, title, storage_path, idempotency_key) values ($1, 'T', $2, 'idem-gm-0001') returning id", [u, `${u}/gm.pdf`]))[0]!.id;
    expect(await unlocked(u)).toEqual(["flashcards_10"]);
    await raw("update public.documents set status = 'ready' where id = $1", [d]);
    expect(await unlocked(u)).toEqual(["first_document", "flashcards_10"]);
  });

  it("a client cannot fabricate evidence: xp_events are not client-writable", async () => {
    const u = await newUser();
    await expect(run(u, "insert into public.xp_events (user_id, kind, points) values ($1, 'x', 500)", [u])).rejects.toThrow(/permission denied|row-level/);
    expect(await unlocked(u)).toEqual([]);
  });
});

describe("challenges", () => {
  const T = JSON.stringify({ az: "Həftəlik", tr: "Haftalık", en: "Weekly", ru: "Недельное" });
  const mk = (uid: string, crit: unknown, startsOffset = "-1 day", endsOffset = "6 days") =>
    run(uid, `select public.admin_create_challenge($1::jsonb, $1::jsonb, $2::jsonb, now() + interval '${startsOffset}', now() + interval '${endsOffset}') as r`, [T, JSON.stringify(crit)]);

  it("none are seeded; students cannot create or alter them; admin can (audited)", async () => {
    expect((await raw("select count(*)::int c from public.challenges"))[0]!.c).toBe(0);
    const u = await newUser();
    await expect(mk(u, { metric: "xp", target: 100 })).rejects.toThrow(/admin privileges/);
    await expect(run(u, "insert into public.challenges (title, description, criteria, starts_at, ends_at) values ('{}','{}','{}', now(), now() + interval '1 day')")).rejects.toThrow(/permission denied/);
    const created = (await mk(ids.admin, { metric: "xp", target: 100 })).rows[0]!.r as string;
    expect(created).toMatch(/^[0-9a-f-]{36}$/);
    expect((await raw("select count(*)::int c from public.audit_logs where action = 'challenge.create' and entity_id = $1", [created]))[0]!.c).toBe(1);
    expect((await run(u, "select count(*)::int c from public.challenges")).rows[0]!.c).toBe(1); // positive control
    await expect(run(u, "select public.admin_set_challenge_active($1, false)", [created])).rejects.toThrow(/admin privileges/);
    await run(ids.admin, "select public.admin_set_challenge_active($1, false)", [created]);
    expect((await run(u, "select count(*)::int c from public.challenges")).rows[0]!.c).toBe(0);
    await raw("delete from public.challenges");
  });

  it("validates criteria, window and the active cap", async () => {
    await expect(mk(ids.admin, { metric: "cheat", target: 1 })).rejects.toThrow(/invalid/);
    await expect(mk(ids.admin, { metric: "xp", target: 0 })).rejects.toThrow(/invalid/);
    await expect(mk(ids.admin, { metric: "xp", target: 5 }, "0 days", "40 days")).rejects.toThrow(/window/);
    for (let i = 0; i < 20; i++) await mk(ids.admin, { metric: "xp", target: 5 + i });
    await expect(mk(ids.admin, { metric: "xp", target: 99 })).rejects.toThrow(/too many/);
    await raw("delete from public.challenges");
  });

  it("progress is computed server-side inside the window, capped at target, completes once with one notification", async () => {
    await raw("delete from public.challenges");
    const u = await newUser();
    const id = (await mk(ids.admin, { metric: "xp", target: 100 })).rows[0]!.r as string;
    await addXp(u, 500, "quiz_correct", "now() - interval '3 days'"); // before the window: not counted
    await addXp(u, 40);
    let p = await rpc(u, "select public.my_progress() as r");
    expect(p.challenges).toHaveLength(1);
    expect(p.challenges[0]).toMatchObject({ id, metric: "xp", target: 100, progress: 40, completed: false });
    await addXp(u, 80);
    p = await rpc(u, "select public.my_progress() as r");
    expect(p.challenges[0]).toMatchObject({ progress: 100, completed: true });
    await rpc(u, "select public.my_progress() as r");
    expect(await notifCount(u, "challenge_completed")).toBe(1);
    const o = await newUser();
    expect((await run(o, "select count(*)::int c from public.user_challenge_progress")).rows[0]!.c).toBe(0);
    expect((await run(u, "select count(*)::int c from public.user_challenge_progress")).rows[0]!.c).toBe(1);
    await expect(run(u, "update public.user_challenge_progress set progress = 0")).rejects.toThrow(/permission denied/);
    await raw("delete from public.challenges");
  });
});

describe("leaderboard (opt-in only)", () => {
  type Row = { rank: number | null; display_name: string | null; avatar_url: string | null; xp: string; is_me: boolean };
  const board = async (uid: string, scope = "global", period = "all") => (await run(uid, "select * from public.leaderboard($1, $2)", [scope, period])).rows as Row[];

  it("non-opted users never appear; opted users do; only display columns are returned", async () => {
    const hidden = await newUser({ name: "HiddenHank", optIn: false });
    const shown = await newUser({ name: "ShownSue", optIn: true });
    const viewer = await newUser({ name: "Viewer", optIn: false });
    await addXp(hidden, 900);
    await addXp(shown, 50);
    const rows = await board(viewer);
    expect(rows.map((r) => r.display_name)).toContain("ShownSue"); // positive control
    expect(rows.map((r) => r.display_name)).not.toContain("HiddenHank");
    expect(Object.keys(rows[0]!).sort()).toEqual(["avatar_url", "display_name", "is_me", "rank", "xp"]);
    expect(rows.find((r) => r.is_me)).toMatchObject({ rank: null, display_name: null });
    const mine = (await board(hidden)).filter((r) => r.is_me);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.rank).toBeNull();
    expect(Number(mine[0]!.xp)).toBe(900);
  });

  it("opting in via the RPC adds the user; opting out removes them; anon and bad args are refused", async () => {
    const u = await newUser({ name: "Toggler" });
    const v = await newUser();
    await addXp(u, 30);
    expect((await board(v)).map((r) => r.display_name)).not.toContain("Toggler");
    expect(await rpc(u, "select public.set_leaderboard_opt_in(true) as r")).toBe(true);
    expect((await board(v)).map((r) => r.display_name)).toContain("Toggler");
    expect((await board(u)).find((r) => r.is_me)!.rank).toBeGreaterThan(0);
    await rpc(u, "select public.set_leaderboard_opt_in(false) as r");
    expect((await board(v)).map((r) => r.display_name)).not.toContain("Toggler");
    await expect(run(u, "select * from public.leaderboard('galaxy', 'all')")).rejects.toThrow(/scope/);
    await expect(asAnon(db, (tx) => tx.query("select * from public.leaderboard('global', 'all')"))).rejects.toThrow(/permission denied/);
  });

  it("university scope shows only the caller's university; week excludes old XP; ties share a rank", async () => {
    const a1 = await newUser({ name: "UniA-1", uni: uniA, optIn: true });
    const a2 = await newUser({ name: "UniA-2", uni: uniA, optIn: true });
    const b1 = await newUser({ name: "UniB-1", uni: uniB, optIn: true });
    const old = await newUser({ name: "OldTimer", uni: uniA, optIn: true });
    await addXp(a1, 70);
    await addXp(a2, 70);
    await addXp(b1, 500);
    await addXp(old, 800, "quiz_correct", "now() - interval '60 days'");
    const uni = await board(a1, "university", "all");
    const names = uni.map((r) => r.display_name);
    expect(names).toContain("UniA-2");
    expect(names).not.toContain("UniB-1");
    const tied = uni.filter((r) => r.display_name === "UniA-1" || r.display_name === "UniA-2");
    expect(tied).toHaveLength(2);
    expect(tied[0]!.rank).toBe(tied[1]!.rank);
    expect((await board(a1, "university", "week")).map((r) => r.display_name)).not.toContain("OldTimer");
    expect(names).toContain("OldTimer");
    const glob = await board(a1, "global", "all");
    expect(glob[0]).toMatchObject({ display_name: "OldTimer", rank: 1 });
  });

  it("blocked users (either direction) are excluded; positive control before blocking", async () => {
    const viewer = await newUser({ optIn: true });
    const blockedByMe = await newUser({ name: "BlockedByMe", optIn: true });
    const blocksMe = await newUser({ name: "BlocksMe", optIn: true });
    await addXp(blockedByMe, 10);
    await addXp(blocksMe, 10);
    await addXp(viewer, 10);
    let names = (await board(viewer)).map((r) => r.display_name);
    expect(names).toContain("BlockedByMe");
    expect(names).toContain("BlocksMe");
    await raw("insert into public.blocks (blocker_id, blocked_id) values ($1, $2), ($3, $1)", [viewer, blockedByMe, blocksMe]);
    names = (await board(viewer)).map((r) => r.display_name);
    expect(names).not.toContain("BlockedByMe");
    expect(names).not.toContain("BlocksMe");
  });

  it("caps the list: top 50 ranks plus the caller's own row", async () => {
    const viewer = await newUser({ name: "Bottom", optIn: true });
    await addXp(viewer, 1);
    for (let i = 0; i < 52; i++) await addXp(await newUser({ name: `Cap${i}`, optIn: true }), 5000 + i);
    const rows = await board(viewer, "global", "all");
    expect(rows.filter((r) => r.is_me)).toHaveLength(1);
    expect(rows.filter((r) => !r.is_me).every((r) => (r.rank ?? 0) <= 50)).toBe(true);
    expect(rows.find((r) => r.is_me)!.rank).toBeGreaterThan(50);
    expect(rows.length).toBeLessThanOrEqual(51);
  });
});

describe("my_progress", () => {
  it("returns real values and requires authentication", async () => {
    const u = await newUser({ optIn: true });
    expect((await rpc(u, "select public.my_progress() as r")).xp).toBe(0);
    await addXp(u, 1240);
    await raw("insert into public.streaks (user_id, current_streak, longest_streak, last_active_date) values ($1, 5, 9, (public.now_utc() at time zone 'Asia/Baku')::date) on conflict (user_id) do update set current_streak = 5, longest_streak = 9, last_active_date = (public.now_utc() at time zone 'Asia/Baku')::date", [u]);
    const p = await rpc(u, "select public.my_progress() as r");
    expect(p).toMatchObject({ xp: 1240, level: 7, level_start_xp: 1050, next_level_xp: 1400, xp_into_level: 190, xp_to_next: 160, leaderboard_opt_in: true, streak: { current: 5, longest: 9 } });
    expect(p.level_progress).toBeCloseTo(190 / 350, 3);
    expect(p.achievements.unlocked).toBe(4); // xp_100, xp_1000, streak_3, streak_7
    expect(p.achievements.total).toBe(8);
    const list = await rpc(u, "select public.my_achievements() as r");
    expect(list).toHaveLength(8);
    expect(list.find((a: any) => a.code === "xp_1000").unlocked_at).toBeTruthy();
    expect(list.find((a: any) => a.code === "streak_30")).toMatchObject({ unlocked_at: null, current: 9, target: 30 });
    await expect(asAnon(db, (tx) => tx.query("select public.my_progress()"))).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.my_progress()")).rejects.toThrow(/not authenticated/);
  });

  it("a dead streak (last activity 3 days ago) reports current 0 but keeps longest", async () => {
    const u = await newUser();
    await raw("insert into public.streaks (user_id, current_streak, longest_streak, last_active_date) values ($1, 4, 4, (public.now_utc() at time zone 'Asia/Baku')::date - 3)", [u]);
    expect((await rpc(u, "select public.my_progress() as r")).streak).toEqual({ current: 0, longest: 4 });
  });
});

describe("notification RPCs", () => {
  const mkNote = (uid: string, key = "welcome") =>
    asService(db, (tx) => tx.query<any>("select public.notify_user($1, $2, '{\"name\":\"Aysel\"}'::jsonb) as r", [uid, key])).then((r) => r.rows[0]!.r as string);

  it("lists the caller's notifications rendered in their locale, counts unread, marks read", async () => {
    const a = await newUser({ locale: "en" });
    const b = await newUser({ locale: "az" });
    const na = await mkNote(a);
    const nb = await mkNote(b);
    await mkNote(a, "deletion_cancelled");
    const la = (await run(a, "select * from public.list_my_notifications()")).rows;
    expect(la).toHaveLength(2);
    expect(la.find((r) => r.id === na)!.title).toBe("Welcome to UniMate");
    expect(la.find((r) => r.id === na)!.body).toContain("Aysel");
    expect((await run(b, "select title from public.list_my_notifications()")).rows[0]!.title).toBe("UniMate-ə xoş gəldiniz");
    expect(await rpc(a, "select public.unread_notification_count() as r")).toBe(2);

    expect(await rpc(a, "select public.mark_notifications_read(array[$1::uuid]) as r", [nb])).toBe(0);
    expect((await raw("select read_at from public.notifications where id = $1", [nb]))[0]!.read_at).toBeNull();
    expect(await rpc(a, "select public.mark_notifications_read(array[$1::uuid]) as r", [na])).toBe(1);
    expect(await rpc(a, "select public.mark_notifications_read(array[$1::uuid]) as r", [na])).toBe(0);
    expect(await rpc(a, "select public.unread_notification_count() as r")).toBe(1);
    expect(await rpc(a, "select public.mark_notifications_read() as r")).toBe(1);
    expect(await rpc(a, "select public.unread_notification_count() as r")).toBe(0);
    expect(await rpc(b, "select public.unread_notification_count() as r")).toBe(1);
  });

  it("limits and pagination are clamped; oversize id lists and anon are refused", async () => {
    const u = await newUser();
    for (let i = 0; i < 3; i++) await mkNote(u);
    expect((await run(u, "select * from public.list_my_notifications(2)")).rows).toHaveLength(2);
    expect((await run(u, "select * from public.list_my_notifications(0)")).rows).toHaveLength(1);
    expect((await run(u, "select * from public.list_my_notifications(5000)")).rows).toHaveLength(3);
    expect((await run(u, "select * from public.list_my_notifications(30, now() - interval '1 day')")).rows).toHaveLength(0);
    await expect(run(u, "select public.mark_notifications_read($1::uuid[])", [Array.from({ length: 201 }, () => u)])).rejects.toThrow(/too many/);
    await expect(asAnon(db, (tx) => tx.query("select * from public.list_my_notifications()"))).rejects.toThrow(/permission denied/);
  });
});
