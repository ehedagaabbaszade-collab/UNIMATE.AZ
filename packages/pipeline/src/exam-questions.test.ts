import { FakeProvider } from "@unimate/core/src/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asOwnerAs } from "../../db/src/harness";
import { GuardedProvider, SqlAiLedger } from "./ai-guard";
import { generateExamQuestions, parseExamGenRequest, type ExamGenDeps } from "./exam-questions";
import { PipelineError } from "./errors";
import { readyDocFromText } from "./fixtures";
import { pgliteExecutor } from "./pglite-repository";
import { createEnv, generateCalls, ids, type TestEnv } from "./test-utils";

let env: TestEnv;
let ledger: SqlAiLedger;
let aliceDoc: string;
let bobDoc: string;
const ADMIN = "00000000-0000-4000-8000-0000000000d5";
const adminSql = (sql: string, params: unknown[] = []) => asOwnerAs(env.db, ADMIN, (tx) => tx.query<any>(sql, params));
const deps = (p: FakeProvider): ExamGenDeps => ({ repo: env.repo, guard: new GuardedProvider({ ledger, provider: p, sleep: async () => {} }) });
const Q = (kind: "choice" | "open", i: number) => (kind === "choice" ? { kind, text: `Sual ${i}`, options: ["a", "b", "c", "d"], correct: i % 4, points: 1 } : { kind, text: `Açıq ${i}`, options: [], correct: 0, points: 4 });

beforeAll(async () => {
  env = await createEnv();
  await env.db.query("insert into auth.users (id, email) values ($1, 'admin5@example.test')", [ADMIN]);
  await env.db.query("update public.profiles set role = 'admin' where id = $1", [ADMIN]);
  ledger = new SqlAiLedger(pgliteExecutor(env.db));
  const prov = (await adminSql("select public.admin_set_ai_provider('exam-prov', 'openai', true, null) as id")).rows[0].id;
  const model = (await adminSql("select public.admin_set_ai_model($1, 'exam-model', 'small', 150000, 600000, 15000, 8192, true, false) as id", [prov])).rows[0].id;
  await adminSql("select public.admin_set_ai_route('chat'::public.ai_task, 'free', $1, '{}', 100)", [model]);
  await adminSql("select public.admin_set_ai_budget('global', '*', 'day', 1000000000)");
  aliceDoc = await readyDocFromText(env, ids.alice, ["Fotosintez işığı kimyəvi enerjiyə çevirir."]);
  bobDoc = await readyDocFromText(env, ids.bob, ["Bob-un gizli qeydləri."]);
}, 120_000);
afterAll(async () => {
  await env.db.close();
});
beforeEach(async () => {
  await env.db.query("delete from public.usage_counters");
});

describe("teacher exam questions", () => {
  it("validates the request", () => {
    expect(() => parseExamGenRequest({ choiceCount: 3, openCount: 0 })).toThrow(PipelineError); // no topic and no document
    expect(() => parseExamGenRequest({ topic: "Fotosintez", choiceCount: 0, openCount: 0 })).toThrow(PipelineError);
    expect(parseExamGenRequest({ topic: "Fotosintez", choiceCount: 2, openCount: 1 }).difficulty).toBe("medium");
  });

  it("drafts questions WITH the key on the chat route, trims extras to the requested mix, counts one AI message", async () => {
    const p = new FakeProvider(() => JSON.stringify({ questions: [Q("choice", 1), Q("open", 1), Q("choice", 2), Q("choice", 3), Q("open", 2)] }));
    const r = await generateExamQuestions(deps(p), { userId: ids.alice, topic: "Fotosintez", choiceCount: 2, openCount: 1, difficulty: "hard" });
    expect(r.output.questions.map((q) => q.text)).toEqual(["Sual 1", "Açıq 1", "Sual 2"]);
    expect(r.output.questions[0]!.correct).toBe(1);
    const call = generateCalls(p)[0]!;
    expect(call.task).toBe("chat");
    expect(call.system).toMatch(/exactly 2 multiple-choice questions and exactly 1 open/);
    expect((await env.db.query<any>("select n from public.usage_counters where user_id = $1 and kind = 'ai_message'", [ids.alice])).rows[0].n).toBe(1);
  });

  it("uses the caller's own document as the source, and refuses someone else's without a model call", async () => {
    const p = new FakeProvider(() => JSON.stringify({ questions: [Q("choice", 1)] }));
    await generateExamQuestions(deps(p), { userId: ids.alice, documentId: aliceDoc, choiceCount: 1, openCount: 0, difficulty: "easy" });
    expect(generateCalls(p)[0]!.prompt).toContain("Fotosintez");
    await expect(generateExamQuestions(deps(p), { userId: ids.alice, documentId: bobDoc, choiceCount: 1, openCount: 0, difficulty: "easy" })).rejects.toMatchObject({ code: "not_found" });
    expect(generateCalls(p)).toHaveLength(1);
  });

  it("keeps the usable questions when some are malformed, and reads common deviations", async () => {
    const reply = [
      { type: "multiple_choice", question: "Sual A", choices: ["A) bir", "B) iki", "C) üç"], answer: "B" },
      { kind: "choice", text: "Pis", options: ["a", "b"], correct: 7 },
      { kind: "open", text: "Açıq sual", options: null },
      { kind: "choice", text: "Sual C", options: ["x", "y", "z", "w"], correct: "z", points: "2" },
    ];
    const p = new FakeProvider(() => ["```json", JSON.stringify(reply), "```"].join(String.fromCharCode(10)));
    const r = await generateExamQuestions(deps(p), { userId: ids.alice, topic: "Fotosintez", choiceCount: 5, openCount: 1, difficulty: "easy" });
    expect(r.output.questions).toEqual([
      { kind: "choice", text: "Sual A", options: ["bir", "iki", "üç"], correct: 1, points: 1 },
      { kind: "open", text: "Açıq sual", options: [], correct: 0, points: 4 },
      { kind: "choice", text: "Sual C", options: ["x", "y", "z", "w"], correct: 2, points: 2 },
    ]);
    expect(generateCalls(p)).toHaveLength(1); // no repair round-trip needed
  });

  it("fails cleanly when nothing usable comes back", async () => {
    const p = new FakeProvider(() => JSON.stringify({ questions: [{ kind: "choice", text: "x", options: ["a", "b"], correct: 9 }] }));
    await expect(generateExamQuestions(deps(p), { userId: ids.alice, topic: "Fotosintez", choiceCount: 1, openCount: 0, difficulty: "easy" })).rejects.toMatchObject({ code: "ai_invalid_output" });
  });
});
