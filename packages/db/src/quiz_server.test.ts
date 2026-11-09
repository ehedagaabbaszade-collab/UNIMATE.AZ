import type { PGlite } from "@electric-sql/pglite";
import { awardXp, scheduleReview, type ReviewGrade } from "@unimate/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { affected, asAnon, asService, asUser, createTestDb, select } from "./harness";

// Migration 20260101003500: server-side quiz grading, atomic XP, server-validated flashcard review.
// All client-facing checks run as the `authenticated` role with auth.uid() set; positive controls prove the
// negative results are not an artefact of a broken setup.

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb({ seed: true });
}, 120_000);
afterAll(async () => {
  await db.close();
});

const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params));
let n = 0;
const newUser = async () => {
  n++;
  const id = `00000000-0000-4000-8000-0000003${String(n).padStart(5, "0")}`;
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `qs${n}@example.test`]);
  return id;
};
const setClock = (iso: string) => raw("insert into app_private.clock_override (at) values ($1) on conflict (singleton) do update set at = excluded.at", [iso]);
const clearClock = () => raw("delete from app_private.clock_override");

interface Quiz {
  id: string;
  mcq: string[]; // 3 mcq questions, correct option index 1
  tf: string;
  short: string;
}
/** Quiz created as the pipeline would (trusted insert; the trigger moves answer/explanation into question_keys). */
const mkQuiz = async (owner: string, serverGenerated = true): Promise<Quiz> => {
  const quiz = (await raw("insert into public.quizzes (user_id, title, server_generated) values ($1, 'Q', $2) returning id", [owner, serverGenerated]))[0]!.id as string;
  const q = async (pos: number, kind: string, options: string | null, answer: string) =>
    (await raw("insert into public.questions (quiz_id, position, kind, prompt, options, answer, explanation) values ($1, $2, $3::public.question_kind, $4, $5::jsonb, $6, 'SECRET-EXPLANATION') returning id", [quiz, pos, kind, `p${pos}`, options, answer]))[0]!.id as string;
  const mcq = [
    await q(0, "mcq", '["a","b","c","d"]', "b"),
    await q(1, "mcq", '["w","x","y","z"]', "x"),
    await q(2, "mcq", '["1","2","3","4"]', "2"),
  ];
  const tf = await q(3, "true_false", null, "true");
  const short = await q(4, "short_answer", null, "model answer");
  return { id: quiz, mcq, tf, short };
};
const correct = (z: Quiz) => ({ [z.mcq[0]!]: 1, [z.mcq[1]!]: 1, [z.mcq[2]!]: 1, [z.tf]: true, [z.short]: "my essay" });
const submit = async (uid: string, quiz: string, answers: unknown, attempt: string | null = null) =>
  (await run(uid, "select public.submit_quiz_attempt($1, $2::jsonb, $3) as r", [quiz, JSON.stringify(answers), attempt])).rows[0]!.r as Record<string, any>;
const uuid = (k: number) => `e0000000-0000-4000-8000-${String(k).padStart(12, "0")}`;

describe("answer key is not readable by students", () => {
  it("question_keys: denied for owner, other student and anon; service_role can read (positive control)", async () => {
    const a = await newUser();
    const b = await newUser();
    const z = await mkQuiz(a);
    expect((await raw("select count(*)::int c from public.question_keys where question_id = any($1::uuid[])", [[...z.mcq, z.tf, z.short]]))[0]!.c).toBe(5);
    for (const uid of [a, b]) {
      expect(await select(db, "authenticated", uid, "select answer, explanation from public.question_keys")).toEqual([]);
      await expect(run(uid, "select answer from public.question_keys")).rejects.toThrow(/permission denied/);
    }
    await expect(asAnon(db, (tx) => tx.query("select * from public.question_keys"))).rejects.toThrow(/permission denied/);
    const svc = await asService(db, (tx) => tx.query<any>("select answer from public.question_keys where question_id = $1", [z.mcq[0]]));
    expect(svc.rows[0]!.answer).toBe("b");
  });

  it("questions: owner reads prompts/options (positive control) but answer and explanation are blank", async () => {
    const a = await newUser();
    const z = await mkQuiz(a);
    const rows = await select(db, "authenticated", a, "select * from public.questions where quiz_id = $1 order by position", [z.id]);
    expect(rows.length).toBe(5);
    expect(rows[0]).toMatchObject({ prompt: "p0", answer: "", explanation: null });
    expect(JSON.stringify(rows)).not.toContain("SECRET-EXPLANATION");
    // a raw UPDATE of the answer by trusted code is also diverted into the key table
    await raw("update public.questions set answer = 'c' where id = $1", [z.mcq[0]]);
    expect((await raw("select answer from public.questions where id = $1", [z.mcq[0]]))[0]!.answer).toBe("");
    expect((await raw("select answer from public.question_keys where question_id = $1", [z.mcq[0]]))[0]!.answer).toBe("c");
  });

  it("export_my_data does not carry the key", async () => {
    const a = await newUser();
    await mkQuiz(a);
    const j = (await run(a, "select public.export_my_data() as j")).rows[0]!.j;
    expect(j.quizzes[0].questions.length).toBe(5);
    expect(JSON.stringify(j)).not.toContain("SECRET-EXPLANATION");
    expect(j.quizzes[0].questions.every((q: any) => q.answer === "")).toBe(true);
  });

  it("generation_cache (raw quiz output with answer_index) is not readable by owners; service can read", async () => {
    const a = await newUser();
    const doc = (await raw("insert into public.documents (user_id, title, storage_path, idempotency_key) values ($1, 't', $2, $3) returning id", [a, `${a}/c.pdf`, `idem-cache-${a}`]))[0]!.id;
    const pv = (await raw("insert into public.prompt_versions (name, version, template, is_active) values ($1, 1, 't', true) returning id", [`pv-${a}`]))[0]!.id;
    await raw("insert into public.generation_cache (user_id, document_id, prompt_version_id, params_hash, output) values ($1, $2, $3, 'hash-12345678', '{\"answer_index\":1}')", [a, doc, pv]);
    expect(await select(db, "authenticated", a, "select * from public.generation_cache")).toEqual([]);
    expect((await select(db, "service_role", null, "select * from public.generation_cache")).length).toBe(1);
  });

  it("students cannot write questions, attempts or server-only quiz fields", async () => {
    const a = await newUser();
    const z = await mkQuiz(a);
    expect(await affected(db, "authenticated", a, "insert into public.questions (quiz_id, position, kind, prompt, options, answer) values ($1, 9, 'mcq', 'mine', '[\"a\"]', 'a')", [z.id])).toBe(0);
    expect(await affected(db, "authenticated", a, "update public.questions set prompt = 'x' where id = $1", [z.mcq[0]])).toBe(0);
    expect(await affected(db, "authenticated", a, "insert into public.attempts (quiz_id, user_id, score, max_score) values ($1, $2, 99, 99)", [z.id, a])).toBe(0);
    // positive control: owner may still create a plain quiz, but server_generated is forced to false
    const ins = await run(a, "insert into public.quizzes (user_id, title, server_generated, generation_hash) values ($1, 'mine', true, 'abcdefgh1') returning server_generated, generation_hash", [a]);
    expect(ins.rows[0]).toMatchObject({ server_generated: false, generation_hash: null });
    expect(await affected(db, "authenticated", a, "update public.quizzes set server_generated = true where id = $1", [z.id])).toBe(1);
    expect((await raw("select server_generated from public.quizzes where id = $1", [z.id]))[0]!.server_generated).toBe(true); // unchanged (was already true)
    expect((await raw("insert into public.quizzes (user_id, title) values ($1, 'x') returning id", [a])).length).toBe(1);
  });
});

describe("submit_quiz_attempt", () => {
  it("grades on the server, writes the attempt with server timestamps, awards XP matching core awardXp", async () => {
    const a = await newUser();
    const z = await mkQuiz(a);
    await setClock("2027-01-10T08:00:00Z");
    try {
      const r = await submit(a, z.id, correct(z));
      expect(r).toMatchObject({ score: 4, max_score: 4, ungraded: 1, xp_eligible: true, duplicate: false });
      // 4 correct answers: core sequence with the streak alive after the first award of the day
      let earned = 0;
      for (let i = 0; i < 4; i++) earned += awardXp({ type: "quiz_answer", correct: true }, { earnedToday: earned, streakDays: i === 0 ? 0 : 1 });
      expect(r.xp_awarded).toBe(earned);
      expect((await raw("select coalesce(sum(points),0)::int s from public.xp_events where user_id = $1", [a]))[0]!.s).toBe(earned);
      const at = (await raw("select score, max_score, started_at, completed_at, user_id from public.attempts where id = $1", [r.attempt_id]))[0]!;
      expect(at).toMatchObject({ score: 4, max_score: 4, user_id: a });
      expect(new Date(at.started_at).toISOString()).toBe("2027-01-10T08:00:00.000Z"); // server clock, not client
      expect(new Date(at.completed_at).toISOString()).toBe("2027-01-10T08:00:00.000Z");
      // the response reveals the key only after grading
      expect(r.results[0]).toMatchObject({ correct: true, correct_answer: "b", correct_option: 1, explanation: "SECRET-EXPLANATION" });
      // owner can read the attempt (positive control)
      expect((await select(db, "authenticated", a, "select score from public.attempts where id = $1", [r.attempt_id]))[0]).toMatchObject({ score: 4 });
    } finally {
      await clearClock();
    }
  });

  it("wrong answers: score 0 and 1 XP each (quiz_incorrect); unanswered questions earn nothing", async () => {
    const a = await newUser();
    const z = await mkQuiz(a);
    const r = await submit(a, z.id, { [z.mcq[0]!]: 0, [z.mcq[1]!]: 3, [z.tf]: false });
    expect(r).toMatchObject({ score: 0, max_score: 4, xp_awarded: 3 }); // third mcq unanswered -> no XP
    expect(r.results.find((x: any) => x.question_id === z.mcq[2])).toMatchObject({ answered: false, correct: false });
  });

  it("is idempotent per attempt id: no re-grade, no second award, one attempts row", async () => {
    const a = await newUser();
    const z = await mkQuiz(a);
    const id = uuid(1 + n);
    const first = await submit(a, z.id, correct(z), id);
    const xpBefore = (await raw("select count(*)::int c from public.xp_events where user_id = $1", [a]))[0]!.c;
    const again = await submit(a, z.id, { [z.mcq[0]!]: 3 }, id); // different (worse) answers, same attempt id
    expect(again).toMatchObject({ duplicate: true, score: first.score, xp_awarded: first.xp_awarded });
    expect((await raw("select count(*)::int c from public.xp_events where user_id = $1", [a]))[0]!.c).toBe(xpBefore);
    expect((await raw("select count(*)::int c from public.attempts where id = $1", [id]))[0]!.c).toBe(1);
    // a new attempt id on the same day grades again but earns no further XP for the same questions
    const second = await submit(a, z.id, correct(z));
    expect(second).toMatchObject({ score: 4, xp_awarded: 0 });
  });

  it("XP is paid only on the first attempt of a quiz: day 1 wrong, day 2 perfect retake earns nothing", async () => {
    const a = await newUser();
    const z = await mkQuiz(a);
    try {
      await setClock("2027-05-01T10:00:00Z");
      expect((await submit(a, z.id, { [z.mcq[0]!]: 0 })).xp_awarded).toBe(1);
      await setClock("2027-05-02T10:00:00Z"); // new Baku day: source keys reset, but the key was revealed by attempt 1
      const r = await submit(a, z.id, correct(z));
      expect(r).toMatchObject({ score: 4, xp_awarded: 0, xp_eligible: false });
    } finally {
      await clearClock();
    }
  });

  it("refuses foreign quizzes and foreign attempt ids; rejects malformed input and anon", async () => {
    const a = await newUser();
    const b = await newUser();
    const z = await mkQuiz(a);
    await expect(submit(b, z.id, correct(z))).rejects.toThrow(/quiz not found/);
    const id = uuid(500 + n);
    await submit(a, z.id, correct(z), id);
    const zb = await mkQuiz(b);
    await expect(submit(b, zb.id, {}, id)).rejects.toThrow(/attempt not found/);
    await expect(run(a, "select public.submit_quiz_attempt($1, '[1]'::jsonb)", [z.id])).rejects.toThrow(/answers object/);
    await expect(run(a, "select public.submit_quiz_attempt($1, null)", [z.id])).rejects.toThrow(/answers object/);
    await expect(asAnon(db, (tx) => tx.query("select public.submit_quiz_attempt($1, '{}'::jsonb)", [z.id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query("select public.submit_quiz_attempt($1, '{}'::jsonb)", [z.id]))).rejects.toThrow(/not authenticated/);
  });

  it("malformed mcq answers (string, out of range, negative) are simply wrong", async () => {
    const a = await newUser();
    const z = await mkQuiz(a);
    const r = await submit(a, z.id, { [z.mcq[0]!]: "1", [z.mcq[1]!]: 99, [z.mcq[2]!]: -1, [z.tf]: "TRUE " });
    expect(r.score).toBe(1); // only the true/false (case/space tolerant)
  });

  it("student-made quizzes (server_generated = false) are graded but not XP-eligible", async () => {
    const a = await newUser();
    const z = await mkQuiz(a, false);
    const r = await submit(a, z.id, correct(z));
    expect(r).toMatchObject({ score: 4, xp_awarded: 0, xp_eligible: false });
    expect((await raw("select count(*)::int c from public.xp_events where user_id = $1", [a]))[0]!.c).toBe(0);
  });

  it("open-ended questions get no automatic score or XP", async () => {
    const a = await newUser();
    const quiz = (await raw("insert into public.quizzes (user_id, title, server_generated) values ($1, 'open', true) returning id", [a]))[0]!.id;
    const qid = (await raw("insert into public.questions (quiz_id, position, kind, prompt, answer) values ($1, 0, 'short_answer', 'explain', 'model') returning id", [quiz]))[0]!.id;
    const r = await submit(a, quiz, { [qid]: "model" });
    expect(r).toMatchObject({ score: 0, max_score: 0, ungraded: 1, xp_awarded: 0 });
    expect((await raw("select count(*)::int c from public.xp_events where user_id = $1", [a]))[0]!.c).toBe(0);
    expect(r.results[0].correct).toBeNull();
  });

  it("a quiz without questions is refused", async () => {
    const a = await newUser();
    const quiz = (await raw("insert into public.quizzes (user_id, title, server_generated) values ($1, 'empty', true) returning id", [a]))[0]!.id;
    await expect(submit(a, quiz, {})).rejects.toThrow(/no questions/);
  });

  it("award_xp is not client-callable any more (quiz correctness claims impossible)", async () => {
    const a = await newUser();
    const z = await mkQuiz(a);
    await expect(run(a, "select public.award_xp('quiz_correct', $1, 1000)", [z.mcq[0]])).rejects.toThrow(/permission denied/);
    await expect(run(a, "select public.award_xp_internal($1, 'quiz_correct', $2)", [a, z.mcq[0]])).rejects.toThrow(/permission denied/);
    expect((await raw("select count(*)::int c from public.xp_events where user_id = $1", [a]))[0]!.c).toBe(0);
  });
});

describe("review_flashcard", () => {
  const NOW = "2027-02-01T10:00:00Z";
  const card = async (u: string, o: { due?: string; ease?: number; interval?: number; reps?: number } = {}) =>
    (await raw("insert into public.flashcards (user_id, front, back, due_at, ease, interval_days, repetitions) values ($1, 'f', 'b', $2, $3, $4, $5) returning id", [u, o.due ?? "2027-01-01T00:00:00Z", o.ease ?? 2.5, o.interval ?? 0, o.reps ?? 0]))[0]!.id as string;
  const review = async (u: string, id: string, grade: string) => (await run(u, "select public.review_flashcard($1, $2) as r", [id, grade])).rows[0]!.r as Record<string, any>;
  beforeAll(async () => {
    await setClock(NOW);
  });
  afterAll(async () => {
    await clearClock();
  });

  const cases: [ReviewGrade, number, number, number][] = [];
  for (const g of ["again", "hard", "good", "easy"] as ReviewGrade[])
    for (const [reps, interval, ease] of [[0, 0, 2.5], [1, 1, 2.5], [2, 3, 2.5], [5, 20, 1.3], [4, 10, 2.15], [6, 100, 5]] as const) cases.push([g, reps, interval, ease]);

  it.each(cases)("schedule matches core scheduleReview: %s reps=%i interval=%i ease=%d", async (grade, reps, interval, ease) => {
    const u = await newUser();
    const id = await card(u, { reps, interval, ease });
    const r = await review(u, id, grade);
    const exp = scheduleReview({ ease, intervalDays: interval, repetitions: reps }, grade, new Date(NOW));
    expect(r).toMatchObject({ reviewed: true, interval_days: exp.intervalDays, repetitions: exp.repetitions });
    expect(Number(r.ease)).toBeCloseTo(exp.ease, 2);
    const row = (await raw("select due_at, ease, interval_days from public.flashcards where id = $1", [id]))[0]!;
    expect(new Date(row.due_at).getTime()).toBe(exp.dueAt.getTime());
    expect(r.awarded).toBe(awardXp({ type: "review_completed" }, { earnedToday: 0, streakDays: 0 }));
  });

  it("a card that is not due changes nothing and earns nothing; due card pays once per day", async () => {
    const u = await newUser();
    const future = await card(u, { due: "2027-02-05T00:00:00Z", reps: 3, interval: 5 });
    expect(await review(u, future, "easy")).toMatchObject({ reviewed: false, awarded: 0, reason: "not_due" });
    expect((await raw("select repetitions, interval_days from public.flashcards where id = $1", [future]))[0]).toMatchObject({ repetitions: 3, interval_days: 5 });
    expect((await raw("select count(*)::int c from public.xp_events where user_id = $1", [u]))[0]!.c).toBe(0);

    const due = await card(u);
    expect((await review(u, due, "again")).awarded).toBe(25);
    await setClock("2027-02-01T10:11:00Z"); // 'again' makes the card due again after 10 minutes
    expect(await review(u, due, "good")).toMatchObject({ reviewed: true, awarded: 0, reason: "duplicate" });
    await setClock(NOW);
  });

  it("another user's card is refused; bad grade rejected; anon denied", async () => {
    const a = await newUser();
    const b = await newUser();
    const id = await card(a);
    await expect(review(b, id, "good")).rejects.toThrow(/reference not found/);
    await expect(review(a, id, "perfect")).rejects.toThrow(/grade must be/);
    await expect(asAnon(db, (tx) => tx.query("select public.review_flashcard($1, 'good')", [id]))).rejects.toThrow(/permission denied/);
  });

  it("clients cannot rewind the schedule (due_at / ease / interval / repetitions), but can edit text", async () => {
    const u = await newUser();
    const id = await card(u, { due: "2027-03-01T00:00:00Z", reps: 4, interval: 9 });
    for (const set of ["due_at = now()", "ease = 5", "interval_days = 0", "repetitions = 0"])
      expect(await affected(db, "authenticated", u, `update public.flashcards set ${set} where id = $1`, [id])).toBe(0);
    expect(await affected(db, "authenticated", u, "update public.flashcards set front = 'edited' where id = $1", [id])).toBe(1);
    expect(await review(u, id, "easy")).toMatchObject({ reviewed: false, reason: "not_due" });
  });

  it("per-day cap: after 100 rewarded reviews the SRS still advances but no XP is paid", async () => {
    const u = await newUser();
    await raw("insert into public.xp_events (user_id, kind, points, source_key, created_at) select $1, 'review_completed', 1, 'seed-' || g, $2::timestamptz from generate_series(1, 100) g", [u, NOW]);
    const id = await card(u);
    expect(await review(u, id, "good")).toMatchObject({ reviewed: true, awarded: 0, reason: "daily_review_cap", interval_days: 1 });
    expect((await raw("select repetitions from public.flashcards where id = $1", [id]))[0]!.repetitions).toBe(1);
    // next Baku day the cap resets (time travel)
    await setClock("2027-02-02T10:00:00Z");
    const id2 = await card(u);
    expect((await review(u, id2, "good")).awarded).toBeGreaterThan(0);
    await setClock(NOW);
  });
});

describe("XP atomicity and caps (award_xp_internal)", () => {
  // PGlite is a single connection: transactions fired with Promise.all are queued, not truly parallel. These tests
  // therefore prove the STATEMENT logic (lock-first ordering, read-after-write inside one statement, unique source key),
  // not contention between real backends. The advisory lock itself is asserted structurally below.
  const mkCards = async (u: string, k: number) => {
    const ids: string[] = [];
    for (let i = 0; i < k; i++) ids.push((await raw("insert into public.flashcards (user_id, front, back) values ($1, 'f', 'b') returning id", [u]))[0]!.id);
    return ids;
  };

  it("the function takes a per-user per-Baku-day advisory xact lock before reading earned XP", async () => {
    const def = (await raw("select pg_get_functiondef('public.award_xp_internal(uuid,text,uuid,timestamptz)'::regprocedure) d"))[0]!.d as string;
    const lock = def.indexOf("pg_advisory_xact_lock");
    expect(lock).toBeGreaterThan(0);
    expect(def.slice(lock, lock + 120)).toMatch(/xp:.*Asia|v_today/);
    expect(lock).toBeLessThan(def.indexOf("sum(e.points)")); // lock first, then read earned XP
    expect(def.indexOf("sum(e.points)")).toBeGreaterThan(0);
    expect(def).toMatch(/on conflict \(user_id, kind, source_key\)/);
  });

  it("one statement awarding 40 cards stays at the 300 cap and tracks core step by step", async () => {
    const u = await newUser();
    const cards = await mkCards(u, 40);
    const r = await raw("select public.award_xp_internal($1, 'review_completed', c.id) as r from unnest($2::uuid[]) with ordinality c(id, o) order by o", [u, cards]);
    let earned = 0;
    r.forEach((row, i) => {
      const exp = awardXp({ type: "review_completed" }, { earnedToday: earned, streakDays: i === 0 ? 0 : 1 });
      expect(row.r.awarded, `award #${i}`).toBe(exp);
      earned += exp;
    });
    expect(earned).toBe(300);
    expect((await raw("select sum(points)::int s from public.xp_events where user_id = $1", [u]))[0]!.s).toBe(300);
  });

  it("Promise.all of 30 service transactions for one user never exceeds the daily cap", async () => {
    const u = await newUser();
    const cards = await mkCards(u, 30);
    const res = await Promise.all(cards.map((c) => asService(db, (tx) => tx.query<any>("select public.award_xp_internal($1, 'review_completed', $2) as r", [u, c]))));
    const total = res.reduce((s, x) => s + (x.rows[0]!.r.awarded as number), 0);
    expect(total).toBe(300);
    expect((await raw("select sum(points)::int s from public.xp_events where user_id = $1", [u]))[0]!.s).toBe(300);
    expect((await raw("select current_streak from public.streaks where user_id = $1", [u]))[0]!.current_streak).toBe(1);
  });

  it("the same reference fired 10 times concurrently pays exactly once", async () => {
    const u = await newUser();
    const [c] = await mkCards(u, 1);
    const res = await Promise.all(Array.from({ length: 10 }, () => asService(db, (tx) => tx.query<any>("select public.award_xp_internal($1, 'review_completed', $2) as r", [u, c]))));
    expect(res.filter((x) => x.rows[0]!.r.awarded > 0).length).toBe(1);
    expect(res.filter((x) => x.rows[0]!.r.reason === "duplicate").length).toBe(9);
    expect((await raw("select count(*)::int c from public.xp_events where user_id = $1", [u]))[0]!.c).toBe(1);
  });

  it("time travel: a new Baku day resets the cap and continues the streak", async () => {
    const u = await newUser();
    const cards = await mkCards(u, 40);
    try {
      await setClock("2027-04-01T10:00:00Z");
      for (const c of cards.slice(0, 39)) await raw("select public.award_xp_internal($1, 'review_completed', $2)", [u, c]);
      expect((await raw("select sum(points)::int s from public.xp_events where user_id = $1", [u]))[0]!.s).toBe(300);
      await setClock("2027-04-02T10:00:00Z");
      const r = (await raw("select public.award_xp_internal($1, 'review_completed', $2) as r", [u, cards[39]]))[0]!.r;
      expect(r).toMatchObject({ awarded: awardXp({ type: "review_completed" }, { earnedToday: 0, streakDays: 1 }), streak: 2 });
    } finally {
      await clearClock();
    }
  });
});
