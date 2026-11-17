import type { SupabaseClient } from "@supabase/supabase-js";
import { fieldErrors, profileNameSchema } from "../../lib/schemas";

export type SaveNameResult = { ok: true; name: string } | { ok: false; kind: "validation"; messageKey: string } | { ok: false; kind: "server" };

/** Validates then updates profiles.display_name. A 0-row update (RLS filtered it) is an error, not a silent success. */
export async function saveDisplayName(sb: Pick<SupabaseClient, "from">, uid: string, raw: string): Promise<SaveNameResult> {
  const parsed = profileNameSchema.safeParse({ displayName: raw });
  if (!parsed.success) return { ok: false, kind: "validation", messageKey: fieldErrors(parsed.error).displayName ?? "validation.required" };
  const { data, error } = await sb.from("profiles").update({ display_name: parsed.data.displayName }).eq("id", uid).select("id").single();
  if (error || !data) return { ok: false, kind: "server" };
  return { ok: true, name: parsed.data.displayName };
}
