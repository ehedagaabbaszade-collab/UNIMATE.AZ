import type { SupabaseClient } from "@supabase/supabase-js";
import { CvDesignSchema, CvDocumentInputSchema, parseCvData, type CvDesign, type CvDocumentInput } from "@unimate/core";

export type CvSaveInput = CvDocumentInput & { design: CvDesign };
export type SaveOutcome = { kind: "saved"; updatedAt: string } | { kind: "conflict" } | { kind: "offline" } | { kind: "invalid" } | { kind: "too_large" } | { kind: "empty" } | { kind: "error" };

// PostgREST errors carry a code; a failed fetch (no connection) has none.
const isNetwork = (e: { message?: string; code?: string }) => !e.code && /fetch|network|offline|timeout|load failed/i.test(e.message ?? "");

/**
 * Optimistic-concurrency save: the UPDATE only matches while updated_at still equals the value this editor loaded or last saved.
 * Zero matched rows means another device saved first: "conflict" (the caller asks for a reload; nothing is overwritten).
 */
export async function saveCvGuarded(sb: SupabaseClient, id: string, input: CvSaveInput, loadedAt: string): Promise<SaveOutcome> {
  const { design, ...doc } = input;
  if (!CvDocumentInputSchema.safeParse(doc).success || !CvDesignSchema.safeParse(design).success) return { kind: "invalid" };
  const size = parseCvData(doc.data);
  if (!size.ok) return { kind: size.error === "too_large" ? "too_large" : "invalid" };
  try {
    const res = await sb.from("cv_documents").update({ ...doc, design }).eq("id", id).eq("updated_at", loadedAt).select("updated_at");
    if (res.error?.message.includes("CV_EMPTY_OVERWRITE")) return { kind: "empty" }; // DB data-loss guard
    if (res.error) return isNetwork(res.error) ? { kind: "offline" } : { kind: "error" };
    const row = (res.data as Array<{ updated_at: string }> | null)?.[0];
    return row ? { kind: "saved", updatedAt: row.updated_at } : { kind: "conflict" };
  } catch {
    return { kind: "offline" };
  }
}
