import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Profile } from "./db";
import { getServerClient } from "./supabase/server";

export const ONBOARDING_SKIP_COOKIE = "um-onboarding-skipped";

/** The verified identity fields this app needs (from the JWT claims). */
export interface SessionUser {
  id: string;
  email: string | null;
  user_metadata: Record<string, unknown>;
}

export interface Session {
  supabase: SupabaseClient;
  user: SessionUser;
  profile: Profile | null;
}

const PROFILE_COLUMNS = "id,display_name,avatar_url,university_id,major_id,study_year,locale,locale_set_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verified server-side session. getClaims checks the JWT signature locally (asymmetric signing keys) or with Supabase
 * Auth (symmetric secret), so it is as trustworthy as getUser without its extra network round trip per page.
 * Returns null if the backend is not configured.
 */
export async function requireSession(): Promise<Session | null> {
  const supabase = await getServerClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/sign-in");
  const user: SessionUser = { id: claims.sub, email: claims.email ?? null, user_metadata: (claims.user_metadata ?? {}) as Record<string, unknown> };

  let { data: profile } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).maybeSingle<Profile>();

  // Sign-up stores university/major as user metadata (no session existed to update the profile). Apply once.
  if (profile && !profile.university_id) {
    const meta = user.user_metadata;
    const uni = typeof meta.university_id === "string" && UUID.test(meta.university_id) ? meta.university_id : null;
    const major = typeof meta.major_id === "string" && UUID.test(meta.major_id) ? meta.major_id : null;
    if (uni) {
      const { data: updated } = await supabase
        .from("profiles")
        .update({ university_id: uni, ...(major ? { major_id: major } : {}) })
        .eq("id", user.id)
        .select(PROFILE_COLUMNS)
        .maybeSingle<Profile>();
      if (updated) profile = updated;
    }
  }
  return { supabase, user, profile };
}

export async function onboardingSkipped(): Promise<boolean> {
  return (await cookies()).get(ONBOARDING_SKIP_COOKIE)?.value === "1";
}
