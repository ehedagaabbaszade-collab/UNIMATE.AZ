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
import { BUCKET, preflight, errorResponse, json, safeEqual, serviceClient } from "../_shared/runtime.ts";

/**
 * Buckets with "<uid>/..." folders that the documents-bucket walk in the pipeline does not cover. avatars and resources
 * are flat; submissions nests one level ("<uid>/<assignment_id>/<file>"), so sub-folders are walked too.
 */
const EXTRA_BUCKETS = ["avatars", "cv-photos", "resources", "submissions"] as const;
const MAX_EXTRA = 1000; // per bucket per user; more than this fails the attempt (recorded, retried) instead of half-purging

async function removeUserFolder(sb: ReturnType<typeof serviceClient>, bucket: string, uid: string): Promise<void> {
  const paths: string[] = [];
  const walk = async (prefix: string, depth: number): Promise<void> => {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: MAX_EXTRA + 1 });
    if (error) throw new Error(`${bucket} list failed`);
    for (const f of data ?? []) {
      if (f.id !== null) paths.push(`${prefix}/${f.name}`);
      else if (depth < 2) await walk(`${prefix}/${f.name}`, depth + 1); // folders have no id
      if (paths.length > MAX_EXTRA) throw new Error(`${bucket} has too many objects to purge in one pass`);
    }
  };
  await walk(uid, 0);
  if (paths.length === 0) return;
  const { error: rmError } = await sb.storage.from(bucket).remove(paths);
  if (rmError) throw new Error(`${bucket} remove failed`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });
  try {
    const secret = Deno.env.get("WORKER_SECRET");
    if (!secret || !safeEqual(req.headers.get("x-worker-secret") ?? "", secret)) return json(req, 401, { error: "unauthorized" });

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
          // The pipeline empties the documents bucket; the per-user folders in the other buckets must go too, or a
          // deleted user's (public) avatar stays downloadable and Storage can refuse deleteUser while objects remain.
          for (const bucket of EXTRA_BUCKETS) await removeUserFolder(sb, bucket, uid);
          const { error } = await sb.auth.admin.deleteUser(uid);
          if (error) throw error;
        },
        log: (m) => console.error(m),
      },
      { limit: 25 },
    );
    return json(req, 200, summary);
  } catch (e) {
    return errorResponse(req, e);
  }
});
