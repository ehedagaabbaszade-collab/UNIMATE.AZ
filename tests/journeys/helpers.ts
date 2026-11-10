import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb } from "../../packages/db/src/harness";

/**
 * Shared kit for the critical-journey tests. Every journey runs against a fresh PGlite with ALL migrations applied and
 * calls the real RPCs as `authenticated` users with auth.uid() set (RLS and grants apply). `raw` is the superuser
 * connection and is used only for fixtures and read-back.
 */
export type R = Record<string, any>;
export type Locale = "az" | "tr" | "en" | "ru";
export const LOCALES: Locale[] = ["az", "tr", "en", "ru"];

export async function newDb(seed = true): Promise<PGlite> {
  return createTestDb({ seed });
}

let userSeq = 0;
export const uuidOf = (prefix: string, n: number) => `00000000-0000-4000-8000-${prefix}${String(n).padStart(12 - prefix.length, "0")}`;

export function kit(db: PGlite) {
  const raw = async (sql: string, params: unknown[] = []) => (await db.query<R>(sql, params)).rows;
  const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<R>(sql, params));
  const rows = async (uid: string, sql: string, params: unknown[] = []) => (await run(uid, sql, params)).rows;
  const one = async (uid: string, sql: string, params: unknown[] = []) => (await rows(uid, sql, params))[0]!;
  /** Runs the statement expecting it to fail; returns the error (message + SQLSTATE code). */
  const fails = async (uid: string, sql: string, params: unknown[] = []) => {
    let err: (Error & { code?: string }) | null = null;
    try {
      await run(uid, sql, params);
    } catch (e) {
      err = e as Error & { code?: string };
    }
    if (!err) throw new Error(`expected failure but succeeded: ${sql}`);
    return err;
  };
  const user = async (o: { name?: string; locale?: Locale; role?: "student" | "moderator" | "admin" | "super_admin"; university?: string | null } = {}) => {
    const n = ++userSeq;
    const id = uuidOf("9", n);
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `journey${n}@example.test`, JSON.stringify({ display_name: o.name ?? `User${n}` })]);
    if (o.locale) await db.query("update public.profiles set locale = $2 where id = $1", [id, o.locale]);
    if (o.role && o.role !== "student") await db.query("update public.profiles set role = $2::public.app_role where id = $1", [id, o.role]);
    if (o.university) await db.query("update public.profiles set university_id = $2 where id = $1", [id, o.university]);
    return id;
  };
  const setClock = (iso: string) => raw("insert into app_private.clock_override (at) values ($1) on conflict (singleton) do update set at = excluded.at", [iso]);
  const clearClock = () => raw("delete from app_private.clock_override");
  return { raw, run, rows, one, fails, user, setClock, clearClock };
}
