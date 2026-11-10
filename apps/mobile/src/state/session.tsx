import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Profile } from "../lib/db";
import { getSupabase } from "../lib/supabase";

export const PROFILE_COLUMNS = "id,display_name,avatar_url,university_id,major_id,study_year,locale,locale_set_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SessionState =
  | { status: "loading" }
  | { status: "no-backend" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: User; profile: Profile | null };

interface Ctx {
  state: SessionState;
  supabase: SupabaseClient | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}
const SessionCtx = createContext<Ctx | null>(null);

async function loadProfile(sb: SupabaseClient, user: User): Promise<Profile | null> {
  let { data: profile } = await sb.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).maybeSingle<Profile>();
  // Sign-up stores university/major as user metadata (no session existed to update the profile). Apply once.
  if (profile && !profile.university_id) {
    const meta = user.user_metadata as Record<string, unknown>;
    const uni = typeof meta.university_id === "string" && UUID.test(meta.university_id) ? meta.university_id : null;
    const major = typeof meta.major_id === "string" && UUID.test(meta.major_id) ? meta.major_id : null;
    if (uni) {
      const { data: updated } = await sb
        .from("profiles")
        .update({ university_id: uni, ...(major ? { major_id: major } : {}) })
        .eq("id", user.id)
        .select(PROFILE_COLUMNS)
        .maybeSingle<Profile>();
      if (updated) profile = updated;
    }
  }
  return profile;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const sb = useMemo(() => getSupabase(), []);
  const [state, setState] = useState<SessionState>(sb ? { status: "loading" } : { status: "no-backend" });

  const apply = useCallback(
    async (session: Session | null) => {
      if (!sb) return;
      if (!session) return setState({ status: "signed-out" });
      const profile = await loadProfile(sb, session.user).catch(() => null);
      setState({ status: "signed-in", user: session.user, profile });
    },
    [sb],
  );

  useEffect(() => {
    if (!sb) return;
    void sb.auth.getSession().then(({ data }) => apply(data.session));
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      // Defer: supabase-js forbids awaiting other auth calls inside this callback.
      setTimeout(() => void apply(event === "SIGNED_OUT" ? null : session), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [sb, apply]);

  const refreshProfile = useCallback(async () => {
    if (!sb) return;
    const { data } = await sb.auth.getSession();
    await apply(data.session);
  }, [sb, apply]);

  const signOut = useCallback(async () => {
    await sb?.auth.signOut();
    setState({ status: "signed-out" });
  }, [sb]);

  const value = useMemo(() => ({ state, supabase: sb, refreshProfile, signOut }), [state, sb, refreshProfile, signOut]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): Ctx {
  const v = useContext(SessionCtx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

/** For screens behind the auth gate: the signed-in user, never null. */
export function useUser(): { user: User; profile: Profile | null; supabase: SupabaseClient } {
  const { state, supabase } = useSession();
  if (state.status !== "signed-in" || !supabase) throw new Error("useUser outside an authenticated screen");
  return { user: state.user, profile: state.profile, supabase };
}
