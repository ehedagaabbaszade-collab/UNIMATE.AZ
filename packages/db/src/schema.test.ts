import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, ids, migrationFiles, seedFixtures } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb({ seed: true });
  await seedFixtures(db);
}, 120_000);

afterAll(async () => {
  await db.close();
});

const rows = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;

describe("schema shape", () => {
  it("migrations are timestamp-named and sorted", () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(5);
    expect(files.every((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))).toBe(true);
  });
  it("every public table has RLS enabled and at least one explicit policy", async () => {
    const tables = await rows(
      `select c.relname, c.relrowsecurity,
              (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)::int as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`,
    );
    console.info(`public tables: ${tables.length}`);
    expect(tables.length).toBe(80); // +account_suspensions (…4600); +campus_actions, campus_notified, community_invites, event_rsvps, event_planner_links (…4400); +organizations, opportunities, opportunity_tracking, cv_documents, career_ai_cache (…4310); +shared_quizzes, shared_quiz_questions, shared_quiz_keys, shared_decks, shared_deck_cards (…4200); +achievements, user_achievements, challenges, user_challenge_progress (…4000); +quiz_first_attempts (…3800); +8 AI cost tables (…1900); +3 i18n (…3300); +question_keys (…3500)
    expect(tables.filter((t) => !t.relrowsecurity).map((t) => t.relname)).toEqual([]);
    expect(tables.filter((t) => t.policies === 0).map((t) => t.relname)).toEqual([]);
  });
  it("every SECURITY DEFINER function pins its search_path", async () => {
    const r = await rows(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig::text like '%search_path=%', false)`,
    );
    expect(r).toEqual([]);
  });
  it("embedding is vector(1536) with an HNSW index", async () => {
    const col = await rows(
      `select format_type(atttypid, atttypmod) as t from pg_attribute where attrelid = 'public.document_chunks'::regclass and attname = 'embedding'`,
    );
    expect(col[0]?.t).toMatch(/vector\(1536\)/);
    const idx = await rows(`select indexdef from pg_indexes where indexname = 'document_chunks_embedding_hnsw'`);
    expect(idx[0]?.indexdef).toMatch(/hnsw/);
  });
  it("updated_at triggers fire", async () => {
    const [before] = await rows("select updated_at from public.documents where id = $1", [ids.docA]);
    await db.query("select pg_sleep(0.01)");
    await db.query("update public.documents set title = 'touched' where id = $1", [ids.docA]);
    const [after] = await rows("select updated_at from public.documents where id = $1", [ids.docA]);
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(new Date(before!.updated_at).getTime());
  });
});

describe("seed.sql", () => {
  it("contains real universities by name only and nothing else", async () => {
    const u = await rows("select name, short_name, city from public.universities order by name");
    expect(u.length).toBeGreaterThanOrEqual(10);
    expect(u.map((x) => x.name)).toEqual(
      expect.arrayContaining(["Bakı Dövlət Universiteti", "ADA Universiteti", "Xəzər Universiteti", "Bakı Ali Neft Məktəbi"]),
    );
    expect(u.every((x) => x.short_name === null && x.city === null)).toBe(true);
    expect((await rows("select count(*)::int as n from public.job_listings"))[0]?.n).toBe(0);
  });
  it("is idempotent", async () => {
    const before = (await rows("select count(*)::int as n from public.universities"))[0]!.n;
    await db.exec(readFileSync(fileURLToPath(new URL("../../../supabase/seed.sql", import.meta.url)), "utf8"));
    expect((await rows("select count(*)::int as n from public.universities"))[0]?.n).toBe(before);
  });
});

describe("constraint violations are rejected", () => {
  const nowhere = "99999999-9999-4999-8999-999999999999";
  const FK = /foreign key constraint/;
  const CHECK = /check constraint/;
  const UNIQUE = /duplicate key/;
  const quiz = "80000000-0000-4000-8000-000000000001";

  beforeAll(async () => {
    await db.query("insert into public.quizzes (id, user_id, title) values ($1, $2, 'q')", [quiz, ids.alice]);
    await db.query("update public.profiles set username = 'dupname' where id = $1", [ids.alice]);
  });

  const cases: [string, string, unknown[], RegExp][] = [
    ["FK: document for unknown user", "insert into public.documents (user_id, title, storage_path, idempotency_key) values ($1, 't', $2, 'idem-fk-0001')", [nowhere, `${nowhere}/x.pdf`], FK],
    ["FK: message in unknown conversation", "insert into public.messages (conversation_id, role, content) values ($1, 'user', 'x')", [nowhere], FK],
    ["FK: membership in unknown community", "insert into public.memberships (community_id, user_id) values ($1, $2)", [nowhere, ids.alice], FK],
    ["FK: chunk of unknown document", "insert into public.document_chunks (document_id, chunk_index, content) values ($1, 0, 'x')", [nowhere], FK],
    ["FK: profile without auth user", "insert into public.profiles (id) values ($1)", [nowhere], FK],
    ["FK: question for unknown quiz", "insert into public.questions (quiz_id, position, kind, prompt, answer, options) values ($1, 0, 'mcq', 'p', 'a', '[]')", [nowhere], FK],
    ["CHECK: storage_path outside owner folder", "insert into public.documents (user_id, title, storage_path, idempotency_key) values ($1, 't', 'other/x.pdf', 'idem-chk-0001')", [ids.alice], CHECK],
    ["CHECK: document size must be positive", "insert into public.documents (user_id, title, storage_path, idempotency_key, size_bytes) values ($1, 't', $2, 'idem-chk-0002', 0)", [ids.alice, `${ids.alice}/z.pdf`], CHECK],
    ["CHECK: chunk page_end before page_start", "insert into public.document_chunks (document_id, chunk_index, content, page_start, page_end) values ($1, 7, 'x', 5, 2)", [ids.docA], CHECK],
    ["CHECK: message citations must be an array", "insert into public.messages (conversation_id, role, content, citations) values ($1, 'user', 'x', '{}'::jsonb)", [ids.convA], CHECK],
    ["CHECK: self block", "insert into public.blocks (blocker_id, blocked_id) values ($1, $1)", [ids.alice], CHECK],
    ["CHECK: self follow", "insert into public.follows (follower_id, followee_id) values ($1, $1)", [ids.alice], CHECK],
    ["CHECK: reaction needs exactly one target", "insert into public.reactions (user_id) values ($1)", [ids.alice], CHECK],
    ["CHECK: anonymous post must not carry an author", "insert into public.posts (community_id, author_id, is_anonymous, kind, title, body) values ($1, $2, true, 'question', 't', 'b')", [ids.pubCommunity, ids.alice], CHECK],
    ["CHECK: only questions can be anonymous", "insert into public.posts (community_id, author_id, is_anonymous, kind, title, body) values ($1, null, true, 'post', 't', 'b')", [ids.pubCommunity], CHECK],
    ["CHECK: non-anonymous post needs an author", "insert into public.posts (community_id, author_id, is_anonymous, title, body) values ($1, null, false, 't', 'b')", [ids.pubCommunity], CHECK],
    ["CHECK: community slug format", "insert into public.communities (name, slug, created_by) values ('X', 'Bad Slug!', $1)", [ids.alice], CHECK],
    ["CHECK: job attempts cannot exceed max_attempts", "insert into public.processing_jobs (document_id, user_id, kind, idempotency_key, attempts, max_attempts) values ($1, $2, 'embed', 'job-chk-0001', 6, 5)", [ids.docA, ids.alice], CHECK],
    ["CHECK: job kind", "insert into public.processing_jobs (document_id, user_id, kind, idempotency_key) values ($1, $2, 'bogus', 'job-chk-0002')", [ids.docA, ids.alice], CHECK],
    ["CHECK: running job must be locked", "insert into public.processing_jobs (document_id, user_id, kind, idempotency_key, state) values ($1, $2, 'embed', 'job-chk-0003', 'running')", [ids.docA, ids.alice], CHECK],
    ["CHECK: quiz attempt score above max", "insert into public.attempts (quiz_id, user_id, score, max_score) values ($1, $2, 9, 5)", [quiz, ids.alice], CHECK],
    ["CHECK: done task needs completed_at", "insert into public.tasks (user_id, title, status) values ($1, 't', 'done')", [ids.alice], CHECK],
    ["CHECK: timetable end must be after start", "insert into public.timetable_entries (user_id, title, weekday, start_time, end_time) values ($1, 't', 1, '10:00', '09:00')", [ids.alice], CHECK],
    ["CHECK: weekday range", "insert into public.timetable_entries (user_id, title, weekday, start_time, end_time) values ($1, 't', 8, '09:00', '10:00')", [ids.alice], CHECK],
    ["CHECK: streak longest >= current", "insert into public.streaks (user_id, current_streak, longest_streak) values ($1, 5, 2)", [ids.alice], CHECK],
    ["CHECK: xp points non-zero", "insert into public.xp_events (user_id, kind, points) values ($1, 'x', 0)", [ids.alice], CHECK],
    ["CHECK: username format", "update public.profiles set username = 'Bad Name' where id = $1", [ids.bob], CHECK],
    ["CHECK: job listing url scheme", "insert into public.job_listings (title, company, url) values ('t', 'c', 'javascript:alert(1)')", [], CHECK],
    ["CHECK: rating range", "insert into public.resources (id, uploader_id, title) values ($1, $2, 'r'); insert into public.resource_ratings (resource_id, user_id, rating) values ($1, $2, 6)", [ids.pubPost, ids.alice], CHECK],
    ["UNIQUE: document idempotency key per user", "insert into public.documents (user_id, title, storage_path, idempotency_key) values ($1, 't', $2, 'idem-alice-1')", [ids.alice, `${ids.alice}/dup.pdf`], UNIQUE],
    ["UNIQUE: chunk index per document", "insert into public.document_chunks (document_id, chunk_index, content) values ($1, 0, 'dup')", [ids.docA], UNIQUE],
    ["UNIQUE: username", "update public.profiles set username = 'dupname' where id = $1", [ids.bob], UNIQUE],
    ["ENUM: invalid role", "update public.profiles set role = 'owner' where id = $1", [ids.alice], /invalid input value for enum/],
  ];

  it.each(cases)("%s", async (_name, sql, params, re) => {
    // rating case uses two statements; run those in a transaction with explicit statements instead
    if (sql.includes(";")) {
      const [first, second] = sql.split(";") as [string, string];
      await expect(
        db.transaction(async (tx) => {
          await tx.query(first, [params[0], params[1]]);
          await tx.query(second, [params[0], params[1]]);
        }),
      ).rejects.toThrow(re);
      return;
    }
    await expect(db.query(sql, params)).rejects.toThrow(re);
  });
});
