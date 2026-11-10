import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { canAccess, isStaff, toRole, type AppRole } from "./guard";
import { getServerClient } from "./supabase/server";

export type StaffSession =
  | { state: "unconfigured" }
  | { state: "anonymous" }
  | { state: "denied"; role: AppRole | null }
  | { state: "ok"; supabase: SupabaseClient; userId: string; role: Extract<AppRole, "moderator" | "admin" | "super_admin">; displayName: string | null; email: string | null };

/**
 * Server-side staff check. getUser() validates the JWT with Supabase Auth (never trust the cookie alone), then the role
 * is read from profiles with the user's own JWT (RLS: own row). Deduplicated per request. The database re-checks the
 * role inside every RPC, so this is the UX/first-line gate, not the only one.
 */
export const getStaffSession = cache(async (): Promise<StaffSession> => {
  const supabase = await getServerClient();
  if (!supabase) return { state: "unconfigured" };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { state: "anonymous" };
  const { data: profile, error } = await supabase.from("profiles").select("role,display_name").eq("id", data.user.id).maybeSingle<{ role: string; display_name: string | null }>();
  const role = error ? null : toRole(profile?.role);
  if (!isStaff(role)) return { state: "denied", role };
  return { state: "ok", supabase, userId: data.user.id, role, displayName: profile?.display_name ?? null, email: data.user.email ?? null };
});

/** Page-level guard: every route calls this with its own path (deny by default). Returns null when not configured. */
export async function requireRoute(pathname: string) {
  const s = await getStaffSession();
  if (s.state === "unconfigured") return null;
  if (s.state === "anonymous") redirect("/sign-in");
  if (s.state === "denied") redirect("/access-denied");
  if (!canAccess(s.role, pathname)) redirect("/access-denied");
  return s;
}
