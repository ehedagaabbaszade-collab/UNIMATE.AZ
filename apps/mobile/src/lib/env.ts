/**
 * The ONLY Supabase configuration the mobile app reads: the project URL and the public anon key
 * (EXPO_PUBLIC_* values are bundled into the app, so they must never be secrets; row-level security protects data).
 */
export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export function parseSupabaseEnv(url: string | undefined, anonKey: string | undefined): SupabaseEnv | null {
  if (!url || !anonKey) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/+$/, ""), anonKey };
}

/** Static property access so Expo inlines the values at bundle time. */
export const getSupabaseEnv = (): SupabaseEnv | null => parseSupabaseEnv(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
