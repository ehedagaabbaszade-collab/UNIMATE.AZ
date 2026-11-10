import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon } from "../../packages/db/src/harness";
import { kit, newDb } from "./helpers";

// Journey (g): authorization matrix. Each row is an admin RPC and the lowest role allowed to call it.
type Role = "student" | "moderator" | "admin" | "super_admin";
const ORDER: Role[] = ["student", "moderator", "admin", "super_admin"];
let db: PGlite;
let k: ReturnType<typeof kit>;
const actor = {} as Record<Role, string>;
let target: string;
const REASON = "authz matrix check";

beforeAll(async () => {
  db = await newDb();
  k = kit(db);
  for (const r of ORDER) actor[r] = await k.user({ role: r });
  target = await k.user({ name: "Target" });
}, 120_000);
afterAll(async () => {
  await db.close();
});

const matrix: { name: string; min: Role; sql: () => [string, unknown[]] }[] = [
  { name: "admin_overview_counters", min: "moderator", sql: () => ["select public.admin_overview_counters()", []] },
  { name: "admin_reports_queue", min: "moderator", sql: () => ["select * from public.admin_reports_queue('open', 5, 0)", []] },
  { name: "admin_list_users", min: "admin", sql: () => ["select * from public.admin_list_users(null, 5, 0)", []] },
  { name: "admin_expiring_subscriptions", min: "admin", sql: () => ["select * from public.admin_expiring_subscriptions(14, 5, 0)", []] },
  { name: "admin_grant_plan", min: "admin", sql: () => ["select public.admin_grant_plan($1, 'plus', now() + interval '5 days', $2)", [target, REASON]] },
  { name: "admin_set_user_suspended", min: "admin", sql: () => ["select public.admin_set_user_suspended($1, false, $2)", [target, REASON]] },
  { name: "admin_upsert_university", min: "admin", sql: () => ["select public.admin_upsert_university(null, $1, null, null, 'university', 'state', null, $2)", [`Matrix Uni ${Math.random()}`, REASON]] },
  { name: "admin_set_role", min: "super_admin", sql: () => ["select public.admin_set_role($1, 'student', $2)", [target, REASON]] },
];

describe("admin authorization matrix", () => {
  for (const row of matrix)
    for (const role of ORDER) {
      const allowed = ORDER.indexOf(role) >= ORDER.indexOf(row.min);
      it(`${row.name}: ${role} ${allowed ? "allowed" : "denied"}`, async () => {
        const [sql, params] = row.sql();
        if (allowed) await expect(k.run(actor[role], sql, params)).resolves.toBeTruthy();
        else {
          const e = await k.fails(actor[role], sql, params);
          expect(e.code).toBe("42501");
          expect(e.message).toMatch(/privileges required/);
        }
      });
    }

  it("anonymous callers cannot execute any of them", async () => {
    for (const row of matrix) {
      const [sql, params] = row.sql();
      await expect(asAnon(db, (tx) => tx.query(sql, params))).rejects.toThrow();
    }
  });

  it("denied calls leave no audit trail and no effect; allowed ones are audited with the actor", async () => {
    expect((await k.raw("select 1 from public.audit_logs where actor_id = $1", [actor.student])).length).toBe(0);
    expect((await k.raw("select role from public.profiles where id = $1", [target]))[0]!.role).toBe("student");
    expect((await k.raw("select 1 from public.audit_logs where actor_id = $1", [actor.admin])).length).toBeGreaterThan(0);
    // a student cannot promote themselves by writing their own profile
    await k.fails(actor.student, "update public.profiles set role = 'admin' where id = $1", [actor.student]);
    expect((await k.raw("select role from public.profiles where id = $1", [actor.student]))[0]!.role).toBe("student");
  });
});
