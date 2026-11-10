import type { PGlite } from "@electric-sql/pglite";
import { levelFromXp } from "@unimate/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser } from "../../packages/db/src/harness";
import { MIME, MemoryStorage, baseDeps, buildDocx } from "../../packages/pipeline/src/fixtures";
import { generateQuiz } from "../../packages/pipeline/src/generate";
import { pgliteRepository } from "../../packages/pipeline/src/pglite-repository";
import { processDocument } from "../../packages/pipeline/src/process";
import { NOT_GROUNDED_LABEL, askDocument } from "../../packages/pipeline/src/rag";
import { Dim1536FakeProvider } from "../../packages/pipeline/src/test-utils";
import { LOCALES, kit, newDb, type Locale } from "./helpers";

// Journey (a): profile -> upload row -> pipeline processing -> RAG with validated citations -> server-persisted quiz
// (key unreadable) -> submit_quiz_attempt -> XP/level/achievements -> notification rendered in the user's locale.
let db: PGlite;
let k: ReturnType<typeof kit>;
let admin: string;
const models = { small: "m-small", standard: "m-standard", premium: "m-premium", embed: "m-embed" };
const QUIZ = JSON.stringify({
  questions: [
    { prompt: "Sual 0?", options: ["a", "b", "c", "d"], answer_index: 1, explanation: "KEY-EXPLANATION-0" },
    { prompt: "Sual 1?", options: ["w", "x", "y", "z"], answer_index: 3, explanation: "KEY-EXPLANATION-1" },
  ],
});

beforeAll(async () => {
  db = await newDb();
  k = kit(db);
  admin = await k.user({ role: "admin" });
}, 120_000);
afterAll(async () => {
  await db.close();
});

describe.each(LOCALES)("study journey (%s)", (locale: Locale) => {
  it("runs end to end with every contract enforced", async () => {
    const repo = pgliteRepository(db);
    const env = { db, repo };
    const uid = await k.user({ locale });
    const other = await k.user({ locale });

    // profile: the user edits their own row; locale is validated by the database
    await k.run(uid, "update public.profiles set display_name = $2 where id = $1", [uid, `Tələbə ${locale}`]);
    expect(await k.one(uid, "select display_name, locale from public.profiles where id = $1", [uid])).toMatchObject({ locale });
    await k.fails(uid, "update public.profiles set locale = 'de' where id = $1", [uid]);

    // upload row (what the client inserts after the storage upload) + bytes in storage
    const path = `${uid}/lecture-${locale}.docx`;
    const docId = (
      await k.one(uid, "insert into public.documents (user_id, title, original_filename, storage_path, mime_type, idempotency_key) values ($1, 'Biologiya', 'lecture.docx', $2, $3, $4) returning id", [uid, path, MIME.docx, `idem-journey-${uid}`])
    ).id as string;
    const storage = new MemoryStorage();
    storage.files.set(path, await buildDocx(["Mitoxondri hüceyrənin enerji stansiyasıdır. ATP istehsal edir.", "Ribosomlar zülal sintez edir."]));
    // denial: another student cannot see the document row
    expect(await k.rows(other, "select id from public.documents where id = $1", [docId])).toEqual([]);

    // process through the pipeline (FakeProvider with 1536-dim vectors)
    expect(await processDocument(baseDeps(env, storage), docId)).toMatchObject({ pages: 1 });
    expect((await k.one(uid, "select status from public.documents where id = $1", [docId])).status).toBe("ready");
    expect((await k.rows(uid, "select id from public.document_chunks where document_id = $1", [docId])).length).toBeGreaterThan(0);

    // RAG: a valid citation survives, a hallucinated one is stripped
    const fake = "11111111-1111-4111-8111-111111111111";
    const idInPrompt = (p: string) => [...p.matchAll(/^\[([0-9a-f-]{36})\] \(page/gm)].map((m) => m[1]!)[0];
    const ragProvider = new Dim1536FakeProvider((req) => `Mitoxondri enerji istehsal edir [${idInPrompt(req.prompt)}]. Uydurma iddia [${fake}].`);
    const ans = await askDocument({ repo, provider: ragProvider, models }, { userId: uid, documentId: docId, question: "Mitoxondri nədir?", outputLanguage: locale });
    expect(ans.grounded).toBe(true);
    expect(ans.citations).toHaveLength(1);
    expect(ans.rejectedCitationIds).toContain(fake);
    expect(ans.answer).not.toContain(fake);
    const ungrounded = await askDocument(
      { repo, provider: new Dim1536FakeProvider(() => `Yalan [${fake}].`), models },
      { userId: uid, documentId: docId, question: "Ribosom?" },
    );
    expect(ungrounded.grounded).toBe(false);
    expect(ungrounded.answer.startsWith(NOT_GROUNDED_LABEL)).toBe(true);
    // denial: another student cannot ask about this document
    await expect(askDocument({ repo, provider: ragProvider, models }, { userId: other, documentId: docId, question: "x?" })).rejects.toMatchObject({ code: "not_found" });

    // FREE has no quiz; the admin grants PLUS (audited RPC), then the quiz is generated and persisted server-side
    await expect(generateQuiz({ repo, provider: new Dim1536FakeProvider(() => QUIZ), models }, { userId: uid, documentId: docId, count: 2 })).rejects.toMatchObject({ reason: "feature_not_in_plan" });
    await k.run(admin, "select public.admin_grant_plan($1, 'plus', now() + interval '30 days', 'journey grant')", [uid]);
    const quiz = await generateQuiz({ repo, provider: new Dim1536FakeProvider(() => QUIZ), models }, { userId: uid, documentId: docId, count: 2 });
    expect(JSON.stringify(quiz)).not.toMatch(/answer_index|KEY-EXPLANATION|"answer"/);
    const quizId = quiz.output.quizId;
    const [q0, q1] = quiz.output.questions;

    // the key is unreadable for the student
    await expect(asUser(db, uid, (tx) => tx.query("select * from public.question_keys"))).rejects.toThrow(/permission denied/);
    expect(await k.rows(uid, "select answer, explanation from public.questions where quiz_id = $1", [quizId])).toEqual([
      { answer: "", explanation: null },
      { answer: "", explanation: null },
    ]);
    // denial: a student cannot forge an attempt row
    await k.fails(uid, "insert into public.attempts (quiz_id, user_id, score, max_score) values ($1, $2, 2, 2)", [quizId, uid]);

    // grading, XP, level, achievements
    const answers = JSON.stringify({ [q0!.id]: 1, [q1!.id]: 3 });
    const r = (await k.one(uid, "select public.submit_quiz_attempt($1, $2::jsonb) as r", [quizId, answers])).r;
    expect(r).toMatchObject({ score: 2, max_score: 2, xp_eligible: true, duplicate: false });
    expect(r.xp_awarded).toBeGreaterThan(0);
    const again = (await k.one(uid, "select public.submit_quiz_attempt($1, $2::jsonb) as r", [quizId, answers])).r;
    expect(again.xp_awarded).toBe(0); // XP only on the first attempt
    const progress = (await k.one(uid, "select public.my_progress() as r")).r;
    expect(progress.xp).toBe(r.xp_awarded);
    expect(progress.level).toBe(levelFromXp(progress.xp).level);
    const codes = (await k.raw("select a.code from public.user_achievements u join public.achievements a on a.id = u.achievement_id where u.user_id = $1 order by 1", [uid])).map((x) => x.code);
    expect(codes).toEqual(["first_document", "first_quiz"]);

    // notifications: rendered in the account locale, from the database template
    const tpl = (await k.raw("select title from public.notification_templates where key = 'achievement_unlocked' and locale = $1", [locale]))[0]!;
    const list = await k.rows(uid, "select title, body, kind from public.list_my_notifications(50)");
    const ach = list.filter((n) => n.kind === "achievement");
    expect(ach).toHaveLength(2);
    for (const n of ach) expect(n.title).toBe(tpl.title);
    // denial: another student's notification list does not contain mine
    expect((await k.rows(other, "select title from public.list_my_notifications(50)")).filter((n) => n.title === tpl.title)).toEqual([]);
  }, 60_000);
});

describe("notification copy differs per locale", () => {
  it("achievement titles are distinct across az/tr/en/ru", async () => {
    const t = await k.raw("select distinct title from public.notification_templates where key = 'achievement_unlocked'");
    expect(t.length).toBe(4);
  });
});
