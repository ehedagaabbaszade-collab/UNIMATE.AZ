import type { SupabaseClient } from "@supabase/supabase-js";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { DOCUMENT_MIME_TYPES } from "../../lib/documents";
import { processDocument } from "../../lib/edge-client";
import type { EdgeError } from "../../lib/edge";
import { precheckFile, storagePathFor } from "../../lib/upload";

export interface PickedFile {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
}

export type UploadOutcome =
  | { kind: "canceled" }
  | { kind: "rejected"; error: string }
  | { kind: "failed"; message: string }
  | { kind: "uploaded"; documentId: string; processError: EdgeError | null };

export async function pickDocument(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: [...DOCUMENT_MIME_TYPES], copyToCacheDirectory: true, multiple: false });
  const a = res.canceled ? null : res.assets[0];
  return a ? { uri: a.uri, name: a.name, size: a.size ?? 0, mimeType: a.mimeType ?? "" } : null;
}

export async function pickImage(): Promise<PickedFile | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  const a = res.canceled ? null : res.assets[0];
  if (!a) return null;
  return { uri: a.uri, name: a.fileName ?? `image-${Date.now()}.${a.mimeType?.includes("png") ? "png" : "jpg"}`, size: a.fileSize ?? 0, mimeType: a.mimeType ?? "" };
}

/**
 * Pre-validates with core validateUpload (via precheckFile; the server stays the authority), then follows the web flow:
 * insert documents row (pending_upload) -> upload to the private 'documents' bucket at `<uid>/<uuid>.<ext>` ->
 * status 'uploaded' (the only change a client may make) -> process-document edge function.
 */
export async function uploadDocument(sb: SupabaseClient, userId: string, file: PickedFile): Promise<UploadOutcome> {
  let bytes: ArrayBuffer;
  try {
    bytes = await new File(file.uri).arrayBuffer();
  } catch (e) {
    return { kind: "failed", message: e instanceof Error ? e.message : "" };
  }
  const check = precheckFile({ name: file.name, size: bytes.byteLength, mimeType: file.mimeType, head: new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength)) });
  if (!check.ok) return { kind: "rejected", error: check.error };

  const path = storagePathFor(userId, Crypto.randomUUID(), check.extension);
  const ins = await sb
    .from("documents")
    .insert({ user_id: userId, title: check.title, original_filename: file.name, storage_path: path, mime_type: check.mimeType, size_bytes: bytes.byteLength, idempotency_key: Crypto.randomUUID() })
    .select("id")
    .single<{ id: string }>();
  if (ins.error) return { kind: "failed", message: ins.error.message };
  const docId = ins.data.id;

  const up = await sb.storage.from("documents").upload(path, bytes, { contentType: check.mimeType, upsert: false });
  if (up.error) {
    await sb.from("documents").delete().eq("id", docId);
    return { kind: "failed", message: up.error.message };
  }
  const upd = await sb.from("documents").update({ status: "uploaded" }).eq("id", docId);
  if (upd.error) return { kind: "failed", message: upd.error.message };

  const proc = await processDocument(docId);
  return { kind: "uploaded", documentId: docId, processError: proc.ok ? null : proc.error };
}
