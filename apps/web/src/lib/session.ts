import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Profile } from "./db";
import { getServerClient } from "./supabase/server";

export const ONBOARDING_SKIP_COOKIE = "um-onboarding-skipped";

export interface Session {
  supabase: SupabaseClient;
  user: User;
  profile: Profile | null;
}

const PROFILE_COLUMNS = "id,display_name,avatar_url,university_id,major_id,study_year,locale,locale_set_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Verified server-side session (getUser validates the JWT with Supabase Auth). Returns null if not configured. */
export async function requireSession(): Promise<Session | null> {
  const supabase = await getServerClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");
  const user = data.user;

  let { data: profile } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).maybeSingle<Profile>();

  // Sign-up stores university/major as user metadata (no session existed to update the profile). Apply once.
  if (profile && !profile.university_id) {
    const meta = user.user_metadata as Record<string, unknown>;
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
