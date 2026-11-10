import { validateUpload, type UploadError } from "@unimate/core";

export type PrecheckResult =
  | { ok: true; extension: string; mimeType: string; title: string }
  | { ok: false; error: UploadError | "image_unsupported" };

/**
 * Client-side pre-validation with @unimate/core validateUpload. The server (storage policies + pipeline) is the
 * authority; this only gives instant feedback. The 'documents' bucket does not allow png/jpg
 * (supabase/migrations/..1100_storage.sql), so images that core would accept are rejected here instead of failing
 * at upload time.
 */
export function precheckFile(input: { name: string; size: number; mimeType: string; head: Uint8Array }): PrecheckResult {
  const r = validateUpload({ name: input.name, size: input.size, mimeType: input.mimeType, headBytes: input.head });
  if (!r.ok) return { ok: false, error: r.error };
  if (r.kind === "png" || r.kind === "jpg") return { ok: false, error: "image_unsupported" };
  const title = input.name.replace(/\.[^.]+$/, "").trim().slice(0, 300) || input.name.slice(0, 300);
  return { ok: true, extension: r.extension, mimeType: r.mimeType, title };
}

export const storagePathFor = (userId: string, objectId: string, extension: string) => `${userId}/${objectId}.${extension}`;
