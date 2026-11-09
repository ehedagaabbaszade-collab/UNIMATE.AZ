// UNTESTED (no Deno available). Scheduled (cron) purge of accounts whose 14-day deletion grace has expired.
//
// POST + x-worker-secret header (WORKER_SECRET). No user JWT path.
// Per due user (public.due_account_deletions, service_role only):
//   1. remove every storage object under "<uid>/" in the documents bucket (SQL cannot delete the files),
//   2. GoTrue admin deleteUser(uid) -> cascades auth.users -> profiles -> all owned rows.
// If step 1 fails the user is skipped (retried on the next run) so files are never orphaned.
// The service-role key stays server-side (serviceClient reads SUPABASE_SERVICE_ROLE_KEY from the function env).
import { BUCKET, corsHeaders, errorResponse, json, safeEqual, serviceClient } from "../_shared/runtime.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  try {
    const secret = Deno.env.get("WORKER_SECRET");
    if (!secret || !safeEqual(req.headers.get("x-worker-secret") ?? "", secret)) return json(401, { error: "unauthorized" });

    const sb = serviceClient();
    const { data: due, error } = await sb.rpc("due_account_deletions", { p_limit: 25 });
    if (error) throw new Error("due_account_deletions failed");

    let purged = 0;
    let failed = 0;
    for (const uid of (due ?? []) as string[]) {
      // An empty/invalid id would list the bucket root: never proceed without a strict UUID.
      if (typeof uid !== "string" || !UUID.test(uid)) {
        failed++;
        continue;
      }
      try {
        for (;;) {
          const { data: objs, error: listErr } = await sb.storage.from(BUCKET).list(uid, { limit: PAGE });
          if (listErr) throw listErr;
          if (!objs || objs.length === 0) break;
          const { error: rmErr } = await sb.storage.from(BUCKET).remove(objs.map((o) => `${uid}/${o.name}`));
          if (rmErr) throw rmErr;
        }
        const { error: delErr } = await sb.auth.admin.deleteUser(uid);
        if (delErr) throw delErr;
        purged++;
      } catch (_e) {
        failed++;
        console.error("purge failed for one account");
      }
    }
    return json(200, { purged, failed });
  } catch (e) {
    return errorResponse(e);
  }
});
