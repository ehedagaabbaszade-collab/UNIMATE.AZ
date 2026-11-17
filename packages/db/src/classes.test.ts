import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb } from "./harness";

// Migration 20260101005300 (teacher classes on campus study groups). Client calls run as `authenticated` with
// auth.uid() set; every negative result has a positive control. T = teacher (group owner), S1/S2 = students,
// X = outsider (not a member).

let db: PGlite;
const U = (k: number) => `00000000-0000-4000-8000-00000000c${String(k).padStart(3, "0")}`;
const [T, S1, S2, X] = [U(1), U(2), U(3), U(4)];
const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params));
const rows = async (uid: string, sql: string, params: unknown[] = []) => (await run(uid, sql, params)).rows;
const one = async (uid: string, sql: string, params: unknown[] = []) => (await rows(uid, sql, params))[0]!;
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
const notifs = async (uid: string, key: string) => (await raw("select params from public.notifications where user_id = $1 and template_key = $2", [uid, key])) as Record<string, any>[];

const QUESTIONS = [
  { id: "q1", kind: "choice", text: "2 + 2?", options: ["3", "4", "5"], correct: 1, points: 2 },
  { id: "q2", kind: "choice", text: "Capital of Azerbaijan?", options: ["Baku", "Ganja"], correct: 0, points: 3 },
  { id: "q3", kind: "open", text: "Explain photosynthesis", options: [], correct: 0, points: 5 },
];
let cls = "";
let exam = "";

beforeAll(async () => {
  db = await createTestDb({ seed: false });
  for (const [i, u] of [T, S1, S2, X].entries()) await raw("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [u, `c${i}@example.test`, JSON.stringify({ display_name: `Person${i}` })]);
  cls = (await one(T, "select public.create_community('Physics 101', 'group') as id")).id;
  const code = (await one(T, "select public.get_invite_code($1) as c", [cls])).c;
  for (const s of [S1, S2]) await run(s, "select public.join_by_code($1)", [code]);
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("privileges", () => {
  it("the new tables are RPC-only: no client can read them (positive control: the RPC works)", async () => {
    for (const t of ["class_exams", "class_exam_keys", "class_exam_attempts", "class_assignments", "assignment_submissions"]) {
      await fails(T, `select * from public.${t}`);
      await fails(S1, `select * from public.${t}`);
    }
    expect(await rows(T, "select * from public.list_class_exams($1)", [cls])).toEqual([]);
    await expect(asAnon(db, (tx) => tx.query("select * from public.list_class_exams($1)", [cls]))).rejects.toThrow(/permission denied/);
    await fails(T, "select public.class_assert_teacher($1)", [cls]); // internal helper
  });
});

describe("online exams", () => {
  it("only the teacher publishes; invalid questions are rejected; students are notified", async () => {
    await fails(S1, "select public.publish_class_exam($1, 'Quiz', '', 20, $2::jsonb)", [cls, JSON.stringify(QUESTIONS)]);
    await fails(X, "select public.publish_class_exam($1, 'Quiz', '', 20, $2::jsonb)", [cls, JSON.stringify(QUESTIONS)]);
    await fails(T, "select public.publish_class_exam($1, 'Quiz', '', 20, $2::jsonb)", [cls, JSON.stringify([{ ...QUESTIONS[0], correct: 9 }])]);
    await fails(T, "select public.publish_class_exam($1, 'Quiz', '', 20, $2::jsonb)", [cls, JSON.stringify([QUESTIONS[0], QUESTIONS[0]])]); // duplicate id
    await fails(T, "select public.publish_class_exam($1, 'Quiz', '', 0, $2::jsonb)", [cls, JSON.stringify(QUESTIONS)]);
    exam = (await one(T, "select public.publish_class_exam($1, 'Midterm', 'Physics', 20, $2::jsonb) as id", [cls, JSON.stringify(QUESTIONS)])).id;
    expect(await notifs(S1, "class_exam_published")).toEqual([{ params: { title: "Midterm" } }]);
    expect(await notifs(T, "class_exam_published")).toEqual([]);
  });

  it("students see the exam but never the key; outsiders see nothing", async () => {
    const list = await rows(S1, "select * from public.list_class_exams($1)", [cls]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: "Midterm", question_count: 3, my_status: "not_started", attempt_count: null });
    expect(Number(list[0]!.max_score)).toBe(10);
    await fails(X, "select * from public.list_class_exams($1)", [cls]);
    await fails(S1, "select public.class_exam_key($1)", [exam]);
    await fails(S1, "select * from public.class_exam_results($1)", [exam]);
    const key = (await one(T, "select public.class_exam_key($1) as k", [exam])).k;
    expect(key.keys).toEqual({ q1: 1, q2: 0 });
    expect(key.questions).toHaveLength(3);
  });

  it("start returns questions without the key; one attempt; the teacher cannot sit it", async () => {
    const s = (await one(S1, "select public.start_class_exam($1) as r", [exam])).r;
    expect(s.questions).toHaveLength(3);
    expect(JSON.stringify(s.questions)).not.toContain("correct");
    const again = (await one(S1, "select public.start_class_exam($1) as r", [exam])).r; // resume, same attempt
    expect(again.attempt_id).toBe(s.attempt_id);
    await fails(T, "select public.start_class_exam($1)", [exam]);
    await fails(X, "select public.start_class_exam($1)", [exam]);
    await fails(S2, "select public.submit_class_exam($1, '{}'::jsonb)", [s.attempt_id]); // someone else's attempt

    await one(S1, "select public.submit_class_exam($1, $2::jsonb, false) as r", [s.attempt_id, JSON.stringify({ q1: 0 })]); // autosave
    const r = (await one(S1, "select public.submit_class_exam($1, $2::jsonb) as r", [s.attempt_id, JSON.stringify({ q1: 1, q2: 1, q3: "Light energy becomes chemical energy", junk: 1 })])).r;
    expect(r).toMatchObject({ score: 2, max_score: 10, late: false, pending_open: true });
    await fails(S1, "select public.submit_class_exam($1, '{}'::jsonb)", [s.attempt_id]);
    await fails(S1, "select public.start_class_exam($1)", [exam]);
    const mine = (await rows(S1, "select * from public.list_class_exams($1)", [cls]))[0]!;
    expect(mine).toMatchObject({ my_status: "submitted", my_pending_open: true });
    expect(Number(mine.my_score)).toBe(2);
  });

  it("the teacher grades open answers within the question's points; the total follows", async () => {
    const res = await rows(T, "select * from public.class_exam_results($1)", [exam]);
    expect(res).toHaveLength(1);
    expect(res[0]!.answers).toEqual({ q1: 1, q2: 1, q3: "Light energy becomes chemical energy" }); // junk key dropped
    await fails(T, "select public.grade_class_exam_open($1, 'q3', 9)", [res[0]!.attempt_id]);
    await fails(T, "select public.grade_class_exam_open($1, 'q1', 1)", [res[0]!.attempt_id]); // not an open question
    await fails(S1, "select public.grade_class_exam_open($1, 'q3', 5)", [res[0]!.attempt_id]);
    await run(T, "select public.grade_class_exam_open($1, 'q3', 4)", [res[0]!.attempt_id]);
    expect(Number((await one(T, "select total from public.class_exam_results($1)", [exam])).total)).toBe(6);
    const mine = (await rows(S1, "select * from public.list_class_exams($1)", [cls]))[0]!;
    expect(mine.my_pending_open).toBe(false);
    expect(Number(mine.my_score)).toBe(6);
    expect((await rows(T, "select attempt_count from public.list_class_exams($1)", [cls]))[0]!.attempt_count).toBe(1);
  });

  it("answers sent after the deadline (+30 s grace) do not count; the autosaved ones do", async () => {
    const s = (await one(S2, "select public.start_class_exam($1) as r", [exam])).r;
    await one(S2, "select public.submit_class_exam($1, $2::jsonb, false) as r", [s.attempt_id, JSON.stringify({ q2: 0 })]);
    await raw("update public.class_exam_attempts set deadline_at = now() - interval '5 minutes' where id = $1", [s.attempt_id]);
    const r = (await one(S2, "select public.submit_class_exam($1, $2::jsonb) as r", [s.attempt_id, JSON.stringify({ q1: 1, q2: 0 })])).r;
    expect(r).toMatchObject({ late: true, score: 3 });
  });

  it("an attempt that ran out of time without a final submit is scored from its saved answers", async () => {
    const e2 = (await one(T, "select public.publish_class_exam($1, 'Pop quiz', '', 5, $2::jsonb) as id", [cls, JSON.stringify(QUESTIONS)])).id;
    const s = (await one(S1, "select public.start_class_exam($1) as r", [e2])).r;
    await one(S1, "select public.submit_class_exam($1, $2::jsonb, false) as r", [s.attempt_id, JSON.stringify({ q1: 1, q2: 0 })]);
    await raw("update public.class_exam_attempts set deadline_at = now() - interval '1 minute' where id = $1", [s.attempt_id]);
    const mine = (await rows(S1, "select * from public.list_class_exams($1)", [cls])).find((r) => r.id === e2)!;
    expect(mine.my_status).toBe("submitted");
    expect(Number(mine.my_score)).toBe(5);
    expect(Number((await one(T, "select total from public.class_exam_results($1)", [e2])).total)).toBe(5);
    await run(T, "select public.delete_class_exam($1)", [e2]);
  });

  it("rejects a question with a missing or fractional key or points, and the author can never sit their exam", async () => {
    const { correct: _c, ...noKey } = QUESTIONS[0]!;
    expect(await fails(T, "select public.publish_class_exam($1, 'X', '', 5, $2::jsonb)", [cls, JSON.stringify([noKey])])).toMatch(/invalid/);
    expect(await fails(T, "select public.publish_class_exam($1, 'X', '', 5, $2::jsonb)", [cls, JSON.stringify([{ ...QUESTIONS[0], correct: 1.5 }])])).toMatch(/invalid/);
    const { points: _p, ...noPoints } = QUESTIONS[2]!;
    expect(await fails(T, "select public.publish_class_exam($1, 'X', '', 5, $2::jsonb)", [cls, JSON.stringify([noPoints])])).toMatch(/invalid/);
    const own = (await one(T, "select public.publish_class_exam($1, 'Own', '', 5, $2::jsonb) as id", [cls, JSON.stringify(QUESTIONS)])).id;
    // the author becomes a plain member (someone else owns the class): still cannot take it
    await raw("update public.memberships set role = 'member' where community_id = $1 and user_id = $2", [cls, T]);
    await raw("insert into public.memberships (community_id, user_id, role) values ($1, $2, 'owner')", [cls, X]);
    expect(await fails(T, "select public.start_class_exam($1)", [own])).toMatch(/teachers cannot take/);
    await raw("update public.memberships set role = 'owner' where community_id = $1 and user_id = $2", [cls, T]);
    await raw("delete from public.memberships where community_id = $1 and user_id = $2", [cls, X]);
    await run(T, "select public.delete_class_exam($1)", [own]);
  });

  it("closed exams cannot be started; a student who leaves sees nothing; only the teacher deletes", async () => {
    const closed = (await one(T, "select public.publish_class_exam($1, 'Old', '', 10, $2::jsonb, now() - interval '2 days', now() - interval '1 day') as id", [cls, JSON.stringify(QUESTIONS)])).id;
    expect(await fails(S1, "select public.start_class_exam($1)", [closed])).toMatch(/not open/);
    await run(S2, "select public.leave_community($1)", [cls]);
    await fails(S2, "select * from public.list_class_exams($1)", [cls]);
    await fails(S1, "select public.delete_class_exam($1)", [closed]);
    expect((await one(T, "select public.delete_class_exam($1) as ok", [closed])).ok).toBe(true);
  });
});

describe("assignments", () => {
  let task = "";
  it("teacher posts; students hand in text or an own-folder file, only until graded", async () => {
    await fails(S1, "select public.create_class_assignment($1, 'Essay')", [cls]);
    task = (await one(T, "select public.create_class_assignment($1, 'Lab report', 'Two pages', now() + interval '1 day') as id", [cls])).id;
    expect(await notifs(S1, "class_assignment_posted")).toEqual([{ params: { title: "Lab report" } }]);
    await fails(S1, "select public.submit_assignment($1, '')", [task]); // nothing handed in
    await fails(S1, "select public.submit_assignment($1, 'x', $2)", [task, `${S2}/${task}/a.pdf`]); // someone else's folder
    await fails(S1, "select public.submit_assignment($1, 'x', $2)", [task, `${S1}/${task}/../a.pdf`]);
    await fails(T, "select public.submit_assignment($1, 'mine')", [task]); // the teacher
    await fails(X, "select public.submit_assignment($1, 'mine')", [task]);
    await run(S1, "select public.submit_assignment($1, 'draft')", [task]);
    await run(S1, "select public.submit_assignment($1, 'with file', $2, 'report.pdf')", [task, `${S1}/${task}/report.pdf`]);
    const id = (await one(S1, "select public.submit_assignment($1, 'final') as id", [task])).id; // text edit keeps the file
    const list = await rows(T, "select * from public.assignment_submissions_list($1)", [task]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, body: "final", file_name: "report.pdf", late: false, grade: null });
    await fails(S1, "select * from public.assignment_submissions_list($1)", [task]);

    await fails(S1, "select public.grade_assignment($1, 90)", [id]);
    await fails(T, "select public.grade_assignment($1, 101)", [id]);
    await run(T, "select public.grade_assignment($1, 92, 'Good work')", [id]);
    expect(await notifs(S1, "class_assignment_graded")).toEqual([{ params: { title: "Lab report", grade: "92" } }]);
    await fails(S1, "select public.submit_assignment($1, 'changed')", [task]);
    const mine = (await rows(S1, "select * from public.list_class_assignments($1)", [cls]))[0]!;
    expect(mine).toMatchObject({ my_body: "final", my_feedback: "Good work", submission_count: null });
    expect(Number(mine.my_grade)).toBe(92);
    expect((await rows(T, "select submission_count from public.list_class_assignments($1)", [cls]))[0]!.submission_count).toBe(1);
  });

  it("submission files: own folder of a class assignment only; handed-in files are locked; the teacher reads them", async () => {
    const path = `${S1}/${task}/report.pdf`;
    await run(S1, "insert into storage.objects (bucket_id, name, owner) values ('submissions', $1, $2)", [path, S1]);
    await fails(S1, "insert into storage.objects (bucket_id, name, owner) values ('submissions', $1, $2)", [`${T}/${task}/x.pdf`, S1]);
    await fails(S1, "insert into storage.objects (bucket_id, name, owner) values ('submissions', $1, $2)", [`${S1}/not-an-assignment/x.pdf`, S1]);
    await fails(X, "insert into storage.objects (bucket_id, name, owner) values ('submissions', $1, $2)", [`${X}/${task}/x.pdf`, X]); // not in the class
    // the handed-in file (referenced by the graded submission) cannot be overwritten or deleted; another own file can
    await run(S1, "insert into storage.objects (bucket_id, name, owner) values ('submissions', $1, $2)", [`${S1}/${task}/scratch.pdf`, S1]);
    expect((await run(S1, "delete from storage.objects where bucket_id = 'submissions' and name = $1", [path])).affectedRows).toBe(0);
    expect((await run(S1, "update storage.objects set metadata = '{}'::jsonb where bucket_id = 'submissions' and name = $1", [path])).affectedRows).toBe(0);
    expect((await run(S1, "delete from storage.objects where bucket_id = 'submissions' and name = $1", [`${S1}/${task}/scratch.pdf`])).affectedRows).toBe(1);
    const seen = async (uid: string) => (await rows(uid, "select name from storage.objects where bucket_id = 'submissions'")).map((r) => r.name);
    expect(await seen(S1)).toEqual([path]);
    expect(await seen(T)).toEqual([path]);
    expect(await seen(X)).toEqual([]);
    expect((await raw("select public from storage.buckets where id = 'submissions'"))[0]!.public).toBe(false);
  });

  it("account export includes the caller's own class work only", async () => {
    const e = (await one(S1, "select public.export_my_data() as d")).d;
    expect(e.assignment_submissions).toHaveLength(1);
    expect(e.class_exam_attempts).toHaveLength(1);
    expect(e.class_exams_created).toEqual([]);
    const t = (await one(T, "select public.export_my_data() as d")).d;
    expect(t.class_exams_created.length).toBeGreaterThan(0);
    expect(t.assignment_submissions).toEqual([]);
  });

  it("deleting an assignment removes its submissions", async () => {
    expect((await one(T, "select public.delete_class_assignment($1) as ok", [task])).ok).toBe(true);
    expect((await raw("select count(*)::int n from public.assignment_submissions"))[0]!.n).toBe(0);
  });
});
