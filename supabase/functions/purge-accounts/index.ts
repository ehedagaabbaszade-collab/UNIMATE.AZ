// UNTESTED (no Deno available; the orchestration itself is unit-tested in packages/pipeline/src/account-purge.test.ts).
// Scheduled (cron) purge of accounts whose 14-day deletion grace has expired.
//
// POST + x-worker-secret header (WORKER_SECRET). No user JWT path.
// Per due user (public.due_account_deletions, service_role only; users with failed attempts sort last):
//   0. claim_account_purge(uid): atomic "still pending?" re-check; cancelling is refused while the claim is held,
//   1. recursively remove every storage object under "<uid>/" in the documents bucket (capped per user),
//   2. GoTrue admin deleteUser(uid) -> cascades auth.users -> profiles -> all owned rows,
//   3. record_account_purged(uid) -> audit row `account.purged`.
// Any failure (including the storage cap) records the attempt via record_account_purge_failure and skips the user;
// later users are still purged. The service-role key stays server-side (serviceClient reads it from the function env).
import { purgeDueAccounts } from "@unimate/pipeline";
import { BUCKET, corsHeaders, errorResponse, json, safeEqual, serviceClient } from "../_shared/runtime.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  try {
    const secret = Deno.env.get("WORKER_SECRET");
    if (!secret || !safeEqual(req.headers.get("x-worker-secret") ?? "", secret)) return json(401, { error: "unauthorized" });

    const sb = serviceClient();
    const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
      const { data, error } = await sb.rpc(fn, args);
      if (error) throw new Error(`${fn} failed`);
      return data as T;
    };
    const summary = await purgeDueAccounts(
      {
        storage: {
          list: (prefix, opts) => sb.storage.from(BUCKET).list(prefix, { limit: opts.limit, offset: opts.offset }),
          remove: (paths) => sb.storage.from(BUCKET).remove(paths),
        },
        dueUsers: async (limit) => (await rpc<string[] | null>("due_account_deletions", { p_limit: limit })) ?? [],
        claim: async (uid) => (await rpc<boolean>("claim_account_purge", { p_user_id: uid })) === true,
        recordFailure: async (uid, reason) => void (await rpc("record_account_purge_failure", { p_user_id: uid, p_reason: reason })),
        recordPurged: async (uid) => void (await rpc("record_account_purged", { p_user_id: uid })),
        deleteUser: async (uid) => {
          const { error } = await sb.auth.admin.deleteUser(uid);
          if (error) throw error;
        },
        log: (m) => console.error(m),
      },
      { limit: 25 },
    );
    return json(200, summary);
  } catch (e) {
    return errorResponse(e);
  }
});
