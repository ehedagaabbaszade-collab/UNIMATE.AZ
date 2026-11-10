/**
 * The ONLY Supabase configuration the web app reads: the project URL and the public anon key (public by design;
 * row-level security is what protects data). No privileged key may ever be referenced from apps/admin
 * (enforced by src/security/no-secrets.test.ts).
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

/** Returns null when the backend is not configured. Static property access so Next inlines the values client-side. */
export function getSupabaseEnv(): SupabaseEnv | null {
  return parseSupabaseEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export class BackendNotConfiguredError extends Error {
  constructor() {
    super("Supabase is not configured");
    this.name = "BackendNotConfiguredError";
  }
}
