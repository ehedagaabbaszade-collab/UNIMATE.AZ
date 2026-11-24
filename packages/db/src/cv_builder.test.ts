import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb } from "./harness";

// Migration 20260101005800_cv_builder: cv_documents.design + is_default, set_default_cv, cap 10, wider data validator.
// Client calls run as `authenticated` with auth.uid() set; every negative has a positive control.

let db: PGlite;
const U = (k: number) => `00000000-0000-4000-8000-00000000f${String(k).padStart(3, "0")}`;
const [A, B] = [U(1), U(2)];
const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const rows = async (uid: string, sql: string, params: unknown[] = []) => (await asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params))).rows;
const fails = async (uid: string, sql: string, params: unknown[] = []) => {
  let err: Error | null = null;
  try {
    await rows(uid, sql, params);
  } catch (e) {
    err = e as Error;
  }
  expect(err, `expected failure: ${sql}`).not.toBeNull();
  return err!.message;
};
const newCv = async (uid: string, data: unknown = {}) => (await rows(uid, "insert into public.cv_documents (user_id, data) values ($1, $2::jsonb) returning id", [uid, JSON.stringify(data)]))[0]!.id as string;
const setDesign = (uid: string, id: string, design: unknown) => rows(uid, "update public.cv_documents set design = $2::jsonb where id = $1 returning id", [id, JSON.stringify(design)]);
const clear = () => raw("delete from public.cv_documents");

beforeAll(async () => {
  db = await createTestDb({ seed: false });
  for (const [i, u] of [A, B].entries()) await raw("insert into auth.users (id, email) values ($1, $2)", [u, `cvb${i}@example.test`]);
}, 120_000);
afterAll(async () => db.close());

describe("cv_documents.design", () => {
  const good = { sectionOrder: ["skills", "summary"], hidden: ["references"], font: "noto-serif", fontSize: "lg", headingScale: 1.2, primary: "#1F3A5F", accent: "#abcdef", background: "#FFFFFF", spacing: "compact", margins: "wide", columns: "two", showPhoto: true, photoShape: "rounded", mode: "ats" };
  it("defaults to {} and only the owner can update it", async () => {
    const id = await newCv(A);
    expect((await raw("select design, is_default from public.cv_documents where id = $1", [id]))[0]).toEqual({ design: {}, is_default: false });
    expect(await setDesign(A, id, good)).toHaveLength(1);
    expect(await setDesign(B, id, { font: "inter" })).toEqual([]); // RLS: invisible to others
    expect((await raw("select design->>'font' as f from public.cv_documents where id = $1", [id]))[0]!.f).toBe("noto-serif");
    await clear();
  });
  it("rejects invalid designs", async () => {
    const id = await newCv(A);
    for (const bad of [
      [],
      { primary: "red" },
      { primary: "#fff" },
      { accent: "#12345g" },
      { font: "comic-sans" },
      { fontSize: "xl" },
      { headingScale: 2 },
      { headingScale: "1" },
      { sectionOrder: ["personal"] },
      { hidden: "skills" },
      { hidden: [1] },
      { showPhoto: "yes" },
      { mode: "fancy" },
      { unknownKey: true },
      { sectionOrder: Array(15).fill("skills") },
    ])
      await fails(A, "update public.cv_documents set design = $2::jsonb where id = $1", [id, JSON.stringify(bad)]);
    expect(await setDesign(A, id, { primary: "#000000" })).toHaveLength(1); // positive control
    await clear();
  });
  it("authenticated cannot set is_default directly", async () => {
    const id = await newCv(A);
    await fails(A, "update public.cv_documents set is_default = true where id = $1", [id]);
    await clear();
  });
});

describe("set_default_cv", () => {
  it("keeps exactly one default per user and never touches other users' CVs", async () => {
    const [a1, a2] = [await newCv(A), await newCv(A)];
    const b1 = await newCv(B);
    await rows(A, "select public.set_default_cv($1)", [a1]);
    await rows(B, "select public.set_default_cv($1)", [b1]);
    await rows(A, "select public.set_default_cv($1)", [a2]);
    const defs = await raw("select id from public.cv_documents where is_default order by id");
    expect(defs.map((r) => r.id).sort()).toEqual([a2, b1].sort());
    expect(await fails(A, "select public.set_default_cv($1)", [b1])).toMatch(/not found/);
    expect((await raw("select is_default from public.cv_documents where id = $1", [b1]))[0]!.is_default).toBe(true);
    await fails(A, "select public.set_default_cv($1)", ["00000000-0000-4000-8000-000000000000"]);
    await expect(db.query("insert into public.cv_documents (user_id, is_default) values ($1, true)", [A])).rejects.toThrow(/cv_documents_one_default|unique/);
    await clear();
  });
  it("is not callable by anon", async () => {
    const id = await newCv(A);
    let err: unknown = null;
    try {
      await db.transaction(async (tx) => {
        await tx.query("set local role anon");
        await tx.query("select public.set_default_cv($1)", [id]);
      });
    } catch (e) {
      err = e;
    }
    expect(String(err)).toMatch(/permission denied/);
    await clear();
  });
});

describe("content validator and cap", () => {
  it("accepts the new sections and object skills, still rejects unknown keys and over-long lists", async () => {
    const data = { volunteer: [{ role: "Mentor" }], publications: [{ title: "P" }], courses: [{ name: "C" }], references: [{ name: "R", onRequest: true }], skills: ["SQL", { name: "Excel", level: 3 }] };
    expect(await newCv(A, data)).toBeTruthy();
    await fails(A, "insert into public.cv_documents (user_id, data) values ($1, $2::jsonb)", [A, JSON.stringify({ volunteers: [] })]);
    await fails(A, "insert into public.cv_documents (user_id, data) values ($1, $2::jsonb)", [A, JSON.stringify({ courses: Array(31).fill({}) })]);
    await fails(A, "insert into public.cv_documents (user_id, data) values ($1, $2::jsonb)", [A, JSON.stringify({ references: "on request" })]);
    await clear();
  });
  it("budget is 100000 bytes", async () => {
    expect(await newCv(A, { summary: "x".repeat(99_000) })).toBeTruthy();
    await fails(A, "insert into public.cv_documents (user_id, data) values ($1, $2::jsonb)", [A, JSON.stringify({ summary: "x".repeat(100_001) })]);
    await clear();
  });
  it("caps an account at 10 CVs with errcode 54000", async () => {
    for (let i = 0; i < 10; i++) await newCv(A);
    let code = "";
    try {
      await rows(A, "insert into public.cv_documents (user_id) values ($1)", [A]);
    } catch (e) {
      code = (e as { code?: string }).code ?? "";
    }
    expect(code).toBe("54000");
    expect(await newCv(B)).toBeTruthy(); // per user, not global
    await clear();
  });
  it("updated_at moves on content edits only, not when the default flag changes", async () => {
    const id = await newCv(A);
    await raw("update public.cv_documents set updated_at = '2020-01-01' where id = $1", [id]);
    await rows(A, "select public.set_default_cv($1)", [id]);
    expect((await raw("select updated_at::date::text as d from public.cv_documents where id = $1", [id]))[0]!.d).toBe("2020-01-01");
    await setDesign(A, id, { font: "inter" });
    expect((await raw("select updated_at::date::text as d from public.cv_documents where id = $1", [id]))[0]!.d).not.toBe("2020-01-01");
    await clear();
  });
});

describe("insert grant and wipe guard", () => {
  it("denies inserting is_default=true but allows the client columns", async () => {
    await fails(A, "insert into public.cv_documents (user_id, is_default) values ($1, true)", [A]);
    expect(await newCv(A)).toBeTruthy();
    await clear();
  });
  it("blocks replacing a CV that has content with an empty one, allows normal edits", async () => {
    const id = await newCv(A, { personal: { fullName: "Ali", email: "a@b.az" }, skills: [{ name: "x" }] });
    const upd = (d: unknown) => rows(A, "update public.cv_documents set data = $2::jsonb where id = $1 returning id", [id, JSON.stringify(d)]);
    for (const empty of [{}, { personal: {}, summary: "", skills: [] }]) {
      let code = "";
      let msg = "";
      try {
        await upd(empty);
      } catch (e) {
        code = (e as { code?: string }).code ?? "";
        msg = (e as Error).message;
      }
      expect([code, msg]).toEqual(["P0001", expect.stringContaining("CV_EMPTY")]);
      expect(msg).toContain("CV_EMPTY_OVERWRITE");
    }
    expect(await upd({ personal: { fullName: "Ali" } })).toHaveLength(1); // clearing single fields/sections is fine
    expect(await upd({ summary: "hi" })).toHaveLength(1);
    await clear();
    const empty = await newCv(A, {});
    expect(await rows(A, "update public.cv_documents set data = '{}'::jsonb where id = $1 returning id", [empty])).toHaveLength(1);
    await clear();
  });
});
