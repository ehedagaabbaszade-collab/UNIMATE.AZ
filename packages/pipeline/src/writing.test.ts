import { FakeProvider } from "@unimate/core/src/testing";
import type { GenerateRequest } from "@unimate/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asOwnerAs } from "../../db/src/harness";
import { GuardedProvider, SqlAiLedger } from "./ai-guard";
import { PipelineError } from "./errors";
import { pgliteExecutor } from "./pglite-repository";
import { createEnv, ids, type TestEnv } from "./test-utils";
import { parseWritingRequest, writeAssignment, type WritingDeps } from "./writing";

let env: TestEnv;
let ledger: SqlAiLedger;
const ADMIN = "00000000-0000-4000-8000-0000000000d4";
const A = ids.alice;
const raw = async (sql: string, params: unknown[] = []) => (await env.db.query<any>(sql, params)).rows;
const adminSql = (sql: string, params: unknown[] = []) => asOwnerAs(env.db, ADMIN, (tx) => tx.query<any>(sql, params));

const DOC = {
  title: "Rəqəmsal iqtisadiyyat",
  introduction: ["Mövzunun aktuallığı."],
  sections: [
    { heading: "1. Anlayış", paragraphs: ["Birinci bölmə."] },
    { heading: "2. İnkişaf", paragraphs: ["İkinci bölmə."] },
  ],
  conclusion: ["Nəticə."],
  keyTerms: ["rəqəmsallaşma"],
  searchKeywords: ["rəqəmsal iqtisadiyyat Azərbaycan"],
};
const DECK = { title: "Rəqəmsal iqtisadiyyat", subtitle: "", slides: [1, 2, 3, 4, 5].map((i) => ({ title: `Slayd ${i}`, bullets: ["Bənd"], notes: "" })), searchKeywords: ["e-ticarət"] };

const deps = (provider: FakeProvider): WritingDeps => ({ repo: env.repo, guard: new GuardedProvider({ ledger, provider, sleep: async () => {} }) });
const gen = (p: FakeProvider) => p.calls.filter((c): c is GenerateRequest => "prompt" in c);

beforeAll(async () => {
  env = await createEnv();
  await env.db.query("insert into auth.users (id, email) values ($1, 'admin4@example.test')", [ADMIN]);
  await env.db.query("update public.profiles set role = 'admin' where id = $1", [ADMIN]);
  ledger = new SqlAiLedger(pgliteExecutor(env.db));
  const prov = (await adminSql("select public.admin_set_ai_provider('write-prov', 'openai', true, null) as id")).rows[0].id;
  const model = (await adminSql("select public.admin_set_ai_model($1, 'write-model', 'small', 150000, 600000, 15000, 8192, true, false) as id", [prov])).rows[0].id;
  await adminSql("select public.admin_set_ai_route('chat'::public.ai_task, 'free', $1, '{}', 100)", [model]);
  await adminSql("select public.admin_set_ai_budget('global', '*', 'day', 1000000000)");
}, 120_000);
afterAll(async () => {
  await env.db.close();
});
beforeEach(async () => {
  await raw("delete from public.usage_counters");
});

describe("writing assistant", () => {
  it("validates the request", () => {
    expect(() => parseWritingRequest({ kind: "independent_work", topic: "x" })).toThrow(PipelineError);
    expect(() => parseWritingRequest({ kind: "thesis", topic: "Rəqəmsal iqtisadiyyat" })).toThrow(PipelineError);
    expect(parseWritingRequest({ kind: "report", topic: "Rəqəmsal iqtisadiyyat", outputLanguage: "az" }).kind).toBe("report");
  });

  it("drafts a sərbəst iş on the chat route, in the profile language, with the student's text fenced as data", async () => {
    const p = new FakeProvider(() => JSON.stringify(DOC));
    const r = await writeAssignment(deps(p), { userId: A, kind: "independent_work", topic: "Rəqəmsal iqtisadiyyat", subject: "İqtisadiyyat", length: 4 });
    expect(r.output).toMatchObject({ title: DOC.title, sections: DOC.sections });
    const call = gen(p)[0]!;
    expect(call.task).toBe("chat");
    expect(call.system).toMatch(/never invent sources/);
    expect(call.prompt).toContain("Rəqəmsal iqtisadiyyat");
    expect((await raw("select n from public.usage_counters where user_id = $1 and kind = 'ai_message'", [A]))[0].n).toBe(1);
  });

  it("drafts a presentation deck and repairs one invalid reply", async () => {
    let n = 0;
    const p = new FakeProvider(() => (n++ === 0 ? "not json" : JSON.stringify(DECK)));
    const r = await writeAssignment(deps(p), { userId: A, kind: "presentation", topic: "Rəqəmsal iqtisadiyyat", length: 5 });
    expect((r.output as typeof DECK).slides).toHaveLength(5);
    expect(gen(p)).toHaveLength(2);
  });

  it("rejects out-of-range lengths per kind", async () => {
    const p = new FakeProvider(() => JSON.stringify(DOC));
    await expect(writeAssignment(deps(p), { userId: A, kind: "presentation", topic: "Rəqəmsal iqtisadiyyat", length: 3 })).rejects.toThrow(PipelineError);
    await expect(writeAssignment(deps(p), { userId: A, kind: "report", topic: "Rəqəmsal iqtisadiyyat", length: 14 })).rejects.toThrow(PipelineError);
    expect(gen(p)).toHaveLength(0);
  });
});
