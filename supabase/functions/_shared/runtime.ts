// Shared plumbing for the Edge Functions. Deno runtime. UNTESTED: Deno is not available in the dev environment,
// and nothing in this directory has been type-checked or run. Business logic lives in packages/pipeline (tested).
//
// Import resolution (not set up/verified): the pipeline sources use extensionless relative imports, so either run
// with sloppy imports (`deno --unstable-sloppy-imports`) or bundle packages/pipeline/src/index.ts into this
// directory (e.g. esbuild --bundle --format=esm --platform=neutral) and point "@unimate/pipeline" at the bundle in
// supabase/functions/deno.json.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3";
import { ProviderNotConfiguredError } from "@unimate/core";
import {
  PipelineError,
  SqlRepository,
  assertStoragePath,
  createProviderFromEnv,
  GuardedProvider,
  BudgetExceededError,
  RateLimitedError,
  SqlAiLedger,
  SqlCareerStore,
  parseAllowedOrigins,
  corsOriginFor,
  publicError,
  tesseractLangPathFromEnv,
  safeEqual,
  sanitizeError,
  type Queryable,
  type SqlExecutor,
  type StorageReader,
} from "@unimate/pipeline";

const env = (k: string): string => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

export const BUCKET = "documents";

export { safeEqual };

// Fail closed: ALLOWED_ORIGIN must be an explicit comma-separated origin list. No "*" default (throws at start-up).
const allowedOrigins = parseAllowedOrigins(Deno.env.get("ALLOWED_ORIGIN"));

/** Fresh per-request CORS headers: echoes the request Origin only if allow-listed, else the first allowed origin. */
export const corsHeadersFor = (req: Request): Record<string, string> => ({
  "access-control-allow-origin": corsOriginFor(req.headers.get("origin"), allowedOrigins),
  vary: "Origin",
  "access-control-allow-headers": "authorization, content-type, x-client-info, apikey",
  "access-control-allow-methods": "POST, OPTIONS",
});

export const json = (req: Request, status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeadersFor(req), "content-type": "application/json" } });

export const preflight = (req: Request): Response => new Response(null, { headers: corsHeadersFor(req) });

/** Verifies the caller's JWT with Supabase Auth. Returns the user id, or null when missing/invalid. */
export async function authenticate(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return null;
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(m[1]!);
  return error || !data.user ? null : data.user.id;
}

export const serviceClient = (): SupabaseClient =>
  createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

let sql: ReturnType<typeof postgres> | undefined;
const pg = () => (sql ??= postgres(env("SUPABASE_DB_URL"), { prepare: false, max: 3 }));

// deno-lint-ignore no-explicit-any
const asQueryable = (tx: any): Queryable => ({
  async query(text: string, params: unknown[] = []) {
    const rows = await tx.unsafe(text, params);
    return { rows: [...rows], affectedRows: rows.count };
  },
});

/** Same role model as the PGlite harness: service ops as service_role; retrieval as `authenticated` with auth.uid() set. */
export const executor: SqlExecutor = {
  service: (fn) =>
    pg().begin(async (tx) => {
      await tx.unsafe("set local role service_role");
      return fn(asQueryable(tx));
    }) as Promise<never>,
  user: (userId, fn) =>
    pg().begin(async (tx) => {
      await tx.unsafe("set local role authenticated");
      await tx.unsafe("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      return fn(asQueryable(tx));
    }) as Promise<never>,
};

export const repository = () => new SqlRepository(executor);

export function storageReader(): StorageReader {
  const sb = serviceClient();
  // No object cache: read() is called once per job and a long-lived Map would pin whole files in isolate memory.
  // Every method asserts "<owner uuid>/<flat safe name>" first: the service-role client bypasses storage RLS.
  return {
    // Server-side object metadata, never the client-declared size.
    async size(path) {
      assertStoragePath(path);
      const i = path.lastIndexOf("/");
      const { data, error } = await sb.storage.from(BUCKET).list(path.slice(0, i), { search: path.slice(i + 1), limit: 10 });
      const f = data?.find((o) => o.name === path.slice(i + 1));
      if (error || !f) throw new PipelineError("storage_missing", "Stored object not found", true);
      return Number((f.metadata as { size?: number } | null)?.size ?? 0);
    },
    // Ranged read through a short-lived signed URL, so an oversized object is rejected before it is downloaded.
    async readHead(path, n) {
      assertStoragePath(path);
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 60);
      if (error || !data) throw new PipelineError("storage_read", "Could not read stored object", true);
      const res = await fetch(data.signedUrl, { headers: { range: `bytes=0-${n - 1}` } });
      if (!res.ok) throw new PipelineError("storage_read", "Could not read stored object", true);
      return new Uint8Array(await res.arrayBuffer()).slice(0, n);
    },
    async read(path) {
      assertStoragePath(path);
      const { data, error } = await sb.storage.from(BUCKET).download(path);
      if (error || !data) throw new PipelineError("storage_read", "Could not read stored object", true);
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

/** Pinned OCR traineddata host (https) from TESSERACT_LANG_PATH; undefined = tesseract.js default. */
export const ocrLangPath = (): string | undefined => tesseractLangPathFromEnv(Deno.env.toObject());

/**
 * Provider from env (keys only) + a GuardedProvider. Model names, prices, routes, budgets and rate limits come from the
 * DB (admin-managed ai_* tables); there is NO env model default, so an unconfigured deployment fails with ai_not_configured.
 */
export function aiConfig() {
  const provider = createProviderFromEnv(Deno.env.toObject());
  return { provider, guard: new GuardedProvider({ ledger: new SqlAiLedger(executor), provider }) };
}

/** Career AI (cv-feedback, interview-prep): same guarded provider, plus the CV/listing/cache store. */
export function careerDeps() {
  const { guard } = aiConfig();
  return { repo: repository(), store: new SqlCareerStore(executor), guard };
}

/** Maps pipeline errors to HTTP. Internal details are never returned. */
export function errorResponse(req: Request, e: unknown): Response {
  if (e instanceof ProviderNotConfiguredError) return json(req, 503, { error: "ai_not_configured" });
  if (e instanceof PipelineError) {
    const status =
      e.code === "not_found" ? 404 :
      e.code === "quota_exceeded" || e.code === "budget_exceeded" || e.code === "rate_limited" ? 429 :
      e.code === "ai_not_configured" ? 503 :
      e.code === "duplicate_request" ? 409 :
      e.code === "provider_error" || e.code === "ai_ledger_error" ? 502 :
      e.code === "not_ready" || e.code === "not_uploaded" ? 409 :
      e.code === "invalid_question" || e.code === "bad_request" ? 400 :
      e.code === "provider_http" || e.code === "provider_network" || e.code === "provider_timeout" ? 502 :
      422;
    // Client gets a fixed message for provider/enqueue/storage failures; the redacted detail goes to server logs only.
    console.error("pipeline error", sanitizeError(e));
    const pub = publicError(e);
    return json(req, status, { error: pub.code, message: pub.message, ...(e instanceof RateLimitedError ? { retryAfterSeconds: e.retryAfterSeconds } : {}), ...(e instanceof BudgetExceededError ? { scope: e.scope, period: e.period } : {}) });
  }
  console.error("unhandled", e instanceof Error ? e.name : "unknown"); // name only: no message/stack with possible secrets
  return json(req, 500, { error: "internal_error" });
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {
    /* fallthrough */
  }
  throw new PipelineError("bad_request", "Body must be a JSON object", false);
}

export const uuidField = (b: Record<string, unknown>, k: string): string => {
  const v = b[k];
  if (typeof v !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))
    throw new PipelineError("bad_request", `${k} must be a UUID`, false);
  return v.toLowerCase();
};
