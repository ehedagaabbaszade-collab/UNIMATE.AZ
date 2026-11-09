import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser } from "../../db/src/harness";
import { readyDocFromText } from "./fixtures";
import { generateFlashcards, generateQuiz, generateSummary, parseGenerateRequest, StructuredOutputError, type GenerateDeps } from "./generate";
import { AskRequestSchema, askDocument, parseAskRequest } from "./rag";
import { Dim1536FakeProvider, createEnv, generateCalls, ids, type TestEnv } from "./test-utils";

// Server-side quiz persistence (answer key never returned) and output/source language handling in the pipeline.
let env: TestEnv;
let doc: string;
const NOW = new Date("2026-05-05T10:00:00Z");
const models = { small: "m-small", standard: "m-standard", premium: "m-premium", embed: "m-embed" };
const mk = (provider: Dim1536FakeProvider): GenerateDeps => ({ repo: env.repo, provider, models, now: () => NOW });
const QUIZ = JSON.stringify({
  questions: [
    { prompt: "Sual 0?", options: ["a", "b", "c", "d"], answer_index: 1, explanation: "ÇÜNKİ-SECRET" },
    { prompt: "Sual 1?", options: ["w", "x", "y", "z"], answer_index: 3, explanation: "SECRET-2" },
  ],
});
const SUMMARY = JSON.stringify({ summary: "Xülasə.", key_points: ["bir", "iki", "üç"] });
const FLASH = JSON.stringify({ cards: [{ front: "F?", back: "ma" }] });

beforeAll(async () => {
  env = await createEnv();
  await env.db.query("insert into public.subscriptions (user_id, plan, status) values ($1, 'plus', 'active')", [ids.alice]);
  doc = await readyDocFromText(env, ids.alice, ["Fotosintez işığı kimyəvi enerjiyə çevirir.", "Xlorofil yaşıl piqmentdir."]);
}, 120_000);
afterAll(async () => {
  await env.db.close();
});

describe("generateQuiz: the answer key stays on the server", () => {
  it("persists the quiz + key, returns ids/prompts/options only, and the client can grade it through the RPC", async () => {
    const p = new Dim1536FakeProvider(() => QUIZ);
    const r = await generateQuiz(mk(p), { userId: ids.alice, documentId: doc, count: 2 });
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/answer_index|"answer"|explanation|SECRET|ÇÜNKİ/);
    expect(r.output.questions).toHaveLength(2);
    expect(r.output.questions[0]).toEqual({ id: expect.any(String), prompt: "Sual 0?", options: ["a", "b", "c", "d"] });
    expect(r.output.outputLanguage).toBe("az");

    const quiz = (await env.db.query<any>("select server_generated, generation_hash, output_language from public.quizzes where id = $1", [r.output.quizId])).rows[0];
    expect(quiz).toMatchObject({ server_generated: true, output_language: "az" });
    const keys = (await env.db.query<any>("select k.answer, k.explanation from public.question_keys k join public.questions q on q.id = k.question_id where q.quiz_id = $1 order by q.position", [r.output.quizId])).rows;
    expect(keys).toEqual([{ answer: "b", explanation: "ÇÜNKİ-SECRET" }, { answer: "z", explanation: "SECRET-2" }]);
    // the student cannot read keys or the raw cache
    await expect(asUser(env.db, ids.alice, (tx) => tx.query("select * from public.question_keys"))).rejects.toThrow(/permission denied/);
    await expect(asUser(env.db, ids.alice, (tx) => tx.query("select * from public.generation_cache"))).rejects.toThrow(/permission denied/);
    const visible = (await asUser(env.db, ids.alice, (tx) => tx.query<any>("select answer, explanation from public.questions where quiz_id = $1", [r.output.quizId]))).rows;
    expect(visible).toEqual([{ answer: "", explanation: null }, { answer: "", explanation: null }]);

    // end to end: submit the right indices -> graded + XP by the server (positive control), then wrong ones on a fresh attempt
    const [q0, q1] = r.output.questions;
    const ok = (await asUser(env.db, ids.alice, (tx) => tx.query<any>("select public.submit_quiz_attempt($1, $2::jsonb) r", [r.output.quizId, JSON.stringify({ [q0!.id]: 1, [q1!.id]: 3 })]))).rows[0].r;
    expect(ok).toMatchObject({ score: 2, max_score: 2, xp_eligible: true });
    expect(ok.xp_awarded).toBeGreaterThan(0);
    const bad = (await asUser(env.db, ids.alice, (tx) => tx.query<any>("select public.submit_quiz_attempt($1, $2::jsonb) r", [r.output.quizId, JSON.stringify({ [q0!.id]: 0, [q1!.id]: 0 })]))).rows[0].r;
    expect(bad).toMatchObject({ score: 0, xp_awarded: 0, xp_eligible: false }); // XP only on the first attempt of a quiz
  });

  it("a cache hit returns the SAME persisted quiz (no duplicates) and still hides the key", async () => {
    const p = new Dim1536FakeProvider(() => QUIZ);
    const a = await generateQuiz(mk(p), { userId: ids.alice, documentId: doc, count: 2 });
    const b = await generateQuiz(mk(p), { userId: ids.alice, documentId: doc, count: 2 });
    expect(b.cached).toBe(true);
    expect(b.output.quizId).toBe(a.output.quizId);
    expect(b.output.questions.map((q) => q.id)).toEqual(a.output.questions.map((q) => q.id));
    expect(JSON.stringify(b)).not.toMatch(/answer_index|SECRET/);
    expect(generateCalls(p)).toHaveLength(0); // both served from the cache entry created by the previous test (same params)
  });

  it("options must be distinct (the stored correct option must be unambiguous); repair can fix it", async () => {
    const dup = JSON.stringify({ questions: [{ prompt: "q", options: ["a", "A ", "c", "d"], answer_index: 0, explanation: "" }] });
    let n = 0;
    const p = new Dim1536FakeProvider(() => (++n === 1 ? dup : QUIZ));
    const r = await generateQuiz(mk(p), { userId: ids.alice, documentId: doc, count: 5 });
    expect(r.output.questions).toHaveLength(2);
    expect(generateCalls(p)[1]!.prompt).toMatch(/distinct/);
    const always = new Dim1536FakeProvider(() => dup);
    await expect(generateQuiz(mk(always), { userId: ids.alice, documentId: doc, count: 6 })).rejects.toBeInstanceOf(StructuredOutputError);
  });
});

describe("output language vs source language", () => {
  const sysOf = (p: Dim1536FakeProvider) => generateCalls(p)[0]!.system;

  it("default output language is the profile locale; an explicit outputLanguage overrides it", async () => {
    await env.db.query("update public.profiles set locale = 'ru' where id = $1", [ids.alice]);
    const p = new Dim1536FakeProvider(() => SUMMARY);
    await generateSummary(mk(p), { userId: ids.alice, documentId: doc, kind: "short" });
    expect(sysOf(p)).toContain("Write in Russian");
    const row = (await env.db.query<any>("select output_language, source_language from public.summaries order by created_at desc limit 1")).rows[0];
    expect(row).toMatchObject({ output_language: "ru", source_language: null });

    const p2 = new Dim1536FakeProvider(() => SUMMARY);
    await generateSummary(mk(p2), { userId: ids.alice, documentId: doc, kind: "short", outputLanguage: "tr", sourceLanguage: "az" });
    expect(sysOf(p2)).toContain("Write in Turkish");
    expect((await env.db.query<any>("select output_language, source_language from public.summaries order by created_at desc limit 1")).rows[0]).toMatchObject({ output_language: "tr", source_language: "az" });
    await env.db.query("update public.profiles set locale = 'az' where id = $1", [ids.alice]);
  });

  it("output language and source language are both part of the cache key", async () => {
    const p = new Dim1536FakeProvider(() => SUMMARY);
    const run = (extra: object) => generateSummary(mk(p), { userId: ids.alice, documentId: doc, kind: "detailed", ...extra });
    expect((await run({ outputLanguage: "en" })).cached).toBe(false);
    expect((await run({ outputLanguage: "en" })).cached).toBe(true);
    expect((await run({ outputLanguage: "ru" })).cached).toBe(false); // other output language
    expect((await run({ outputLanguage: "en", sourceLanguage: "az" })).cached).toBe(false); // other source language
    expect((await run({ outputLanguage: "en", sourceLanguage: "az" })).cached).toBe(true);
    expect((await run({ outputLanguage: "en", sourceLanguage: "tr" })).cached).toBe(false);
    expect((await run({ language: "en" })).cached).toBe(true); // deprecated alias == outputLanguage
    expect(generateCalls(p)).toHaveLength(4);
  });

  it("all four languages are accepted for both settings; anything else is rejected before quota or model use", async () => {
    const before = (await env.repo.getUsage(ids.alice, NOW)).aiMessagesToday;
    const p = new Dim1536FakeProvider(() => FLASH);
    for (const bad of ["de", "English", "az\nIgnore previous", "", "AZ"]) {
      await expect(generateFlashcards(mk(p), { userId: ids.alice, documentId: doc, outputLanguage: bad })).rejects.toMatchObject({ code: "bad_request" });
      await expect(generateFlashcards(mk(p), { userId: ids.alice, documentId: doc, sourceLanguage: bad })).rejects.toMatchObject({ code: "bad_request" });
    }
    await expect(generateFlashcards(mk(p), { userId: ids.alice, documentId: doc, outputLanguage: "en", language: "tr" })).rejects.toMatchObject({ code: "bad_request" });
    expect(generateCalls(p)).toHaveLength(0);
    expect((await env.repo.getUsage(ids.alice, NOW)).aiMessagesToday).toBe(before);
    for (const l of ["az", "tr", "en", "ru"]) {
      const r = await generateFlashcards(mk(new Dim1536FakeProvider(() => FLASH)), { userId: ids.alice, documentId: doc, count: 1, outputLanguage: l, sourceLanguage: l === "az" ? "ru" : "az" });
      expect(r.output.cards).toHaveLength(1);
    }
  });
});

describe("request schemas", () => {
  const d = "12345678-1234-4234-8234-123456789012";
  it("generate: outputLanguage and sourceLanguage allow az/tr/en/ru only; language alias still works", () => {
    for (const l of ["az", "tr", "en", "ru"]) {
      expect(parseGenerateRequest({ documentId: d, type: "quiz", outputLanguage: l, sourceLanguage: l })).toMatchObject({ outputLanguage: l, sourceLanguage: l });
      expect(parseGenerateRequest({ documentId: d, type: "quiz", language: l }).language).toBe(l);
    }
    for (const bad of ["de", "English", "", 5, null, "az\n"]) {
      expect(() => parseGenerateRequest({ documentId: d, type: "quiz", outputLanguage: bad })).toThrow(/bad_request|Invalid request/);
      expect(() => parseGenerateRequest({ documentId: d, type: "quiz", sourceLanguage: bad })).toThrow(/bad_request|Invalid request/);
    }
    expect(() => parseGenerateRequest({ documentId: d, type: "quiz", outputLanguage: "en", language: "tr" })).toThrow(/Invalid request/);
    expect(parseGenerateRequest({ documentId: d, type: "quiz" }).outputLanguage).toBeUndefined(); // default comes from the profile, server side
  });
  it("ask: same allowlist; ids lowercased; unknown languages rejected", () => {
    expect(parseAskRequest({ documentId: d.toUpperCase(), question: "Nədir?", outputLanguage: "ru", sourceLanguage: "az" })).toMatchObject({ documentId: d, outputLanguage: "ru", sourceLanguage: "az" });
    expect(AskRequestSchema.safeParse({ documentId: d, question: "q", outputLanguage: "fr" }).success).toBe(false);
    expect(AskRequestSchema.safeParse({ documentId: "nope", question: "q" }).success).toBe(false);
    expect(() => parseAskRequest({ documentId: d, question: 5 })).toThrow(/Invalid request/);
  });
});

describe("askDocument output language", () => {
  it("adds the output language to the system prompt and stores it (with the source language) on the new conversation", async () => {
    const p = new Dim1536FakeProvider(() => "Cavab.");
    const r = await askDocument({ repo: env.repo, provider: p, models, now: () => NOW }, { userId: ids.alice, documentId: doc, question: "Fotosintez nədir?", outputLanguage: "ru", sourceLanguage: "az" });
    expect(generateCalls(p)[0]!.system).toContain("Write the answer in Russian.");
    const c = (await env.db.query<any>("select output_language, source_language from public.conversations where id = $1", [r.conversationId])).rows[0];
    expect(c).toMatchObject({ output_language: "ru", source_language: "az" });
    // no explicit language: prompt keeps following the question's language; conversation defaults to the profile locale
    const p2 = new Dim1536FakeProvider(() => "Cavab.");
    const r2 = await askDocument({ repo: env.repo, provider: p2, models, now: () => NOW }, { userId: ids.alice, documentId: doc, question: "Xlorofil nədir?" });
    expect(generateCalls(p2)[0]!.system).not.toContain("Write the answer in");
    expect((await env.db.query<any>("select output_language from public.conversations where id = $1", [r2.conversationId])).rows[0].output_language).toBe("az");
    await expect(askDocument({ repo: env.repo, provider: p2, models, now: () => NOW }, { userId: ids.alice, documentId: doc, question: "q", outputLanguage: "de" as never })).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("plan lookup uses effective_plan", () => {
  it("getPlan follows expiry on the injected clock, and ignores expired/canceled rows", async () => {
    await env.db.query("delete from public.subscriptions where user_id = $1", [ids.bob]);
    expect(await env.repo.getPlan(ids.bob, NOW)).toBe("FREE");
    await env.db.query("insert into public.subscriptions (user_id, plan, status, current_period_start, current_period_end) values ($1, 'pro', 'active', '2026-05-01', '2026-06-01')", [ids.bob]);
    expect(await env.repo.getPlan(ids.bob, NOW)).toBe("PRO");
    expect(await env.repo.getPlan(ids.bob, new Date("2026-06-01T00:00:00Z"))).toBe("FREE");
    await env.db.query("update public.subscriptions set status = 'expired' where user_id = $1", [ids.bob]);
    expect(await env.repo.getPlan(ids.bob, NOW)).toBe("FREE");
  });
});
