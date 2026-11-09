import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser } from "../../db/src/harness";
import { SqlRepository, type SqlExecutor } from "./sql-repository";

/** PGlite-backed executor: service ops run as service_role, retrieval as `authenticated` with auth.uid() = userId. */
export function pgliteExecutor(db: PGlite): SqlExecutor {
  return {
    service: (fn) => asService(db, fn),
    user: (userId, fn) => asUser(db, userId, fn),
  };
}
export const pgliteRepository = (db: PGlite): SqlRepository => new SqlRepository(pgliteExecutor(db));
