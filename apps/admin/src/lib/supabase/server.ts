import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

/** Server-side client bound to the request cookies. Returns null when the backend is not configured. */
export async function getServerClient(): Promise<SupabaseClient | null> {
  const env = getSupabaseEnv();
  if (!env) return null;
  const store = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(items) {
        try {
          for (const { name, value, options } of items) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookie writes are handled by proxy.ts instead.
        }
      },
    },
  });
}
