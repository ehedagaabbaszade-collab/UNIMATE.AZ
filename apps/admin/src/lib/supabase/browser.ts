import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BackendNotConfiguredError, getSupabaseEnv } from "./env";

let client: SupabaseClient | undefined;

/** Browser-side client (cookie-based session shared with the server). Created lazily, never at module scope. */
export function getBrowserClient(): SupabaseClient {
  if (client) return client;
  const env = getSupabaseEnv();
  if (!env) throw new BackendNotConfiguredError();
  client = createBrowserClient(env.url, env.anonKey);
  return client;
}
