// UNTESTED (no Deno). Mints a short-lived signed URL for a resource file AFTER an authz check as the caller (RLS: published
// + visible + not blocked, or own upload). The bucket has no client read policy, so this is the only read path.
// POST { resourceId } (user JWT) -> 200 { url, expiresIn, mimeType, filename }
import { authorizeResourceDownload } from "@unimate/pipeline";
import { authenticate, preflight, errorResponse, json, readBody, serviceClient, uuidField } from "../_shared/runtime.ts";
import { RESOURCES_BUCKET, objectVerifier, resourceReader } from "../_shared/notes.ts";

const EXPIRES_IN = 120;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });
  try {
    const userId = await authenticate(req);
    if (!userId) return json(req, 401, { error: "unauthorized" });
    const resourceId = uuidField(await readBody(req), "resourceId");
    const f = await authorizeResourceDownload({ resources: resourceReader, objects: objectVerifier }, { userId, resourceId });
    const { data, error } = await serviceClient().storage.from(RESOURCES_BUCKET).createSignedUrl(f.path, EXPIRES_IN, f.filename ? { download: f.filename } : undefined);
    if (error || !data) return json(req, 404, { error: "not_found" });
    return json(req, 200, { url: data.signedUrl, expiresIn: EXPIRES_IN, mimeType: f.mimeType, filename: f.filename });
  } catch (e) {
    return errorResponse(req, e);
  }
});
