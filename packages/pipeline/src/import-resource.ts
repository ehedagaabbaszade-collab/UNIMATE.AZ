import { PipelineError } from "./errors";
import { submitDocument } from "./process";
import type { Job, Repository } from "./repository";
import { assertStoragePath } from "./storage-path";

/**
 * "Study with AI" for shared NOTES material: copy a published resource file into the caller's own `documents` folder and
 * enqueue it through the normal document pipeline (ownership + atomic monthly quota + idempotent enqueue).
 * Pure orchestration: the edge function `import-resource` supplies the adapters (service role, never trusted input).
 */
export interface ImportableResource {
  id: string;
  uploaderId: string;
  title: string;
  storagePath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  originalFilename: string | null;
  courseId: string | null;
  status: "pending" | "published" | "removed";
  /** Storage object bound at create_resource (id / etag / size). Rows without a binding are refused (fail closed). */
  storageObjectId?: string | null;
  storageEtag?: string | null;
  storageSize?: number | null;
}

/** What storage.objects says about a path right now (service-role read; never trusted from the client). */
export interface StoredObject {
  id: string;
  etag: string | null;
  size: number | null;
}

export interface ImportDeps {
  repo: Repository;
  resources: {
    /** Must apply the CALLER's visibility rules (RLS / can_view_resource): null when the caller cannot see it. */
    getVisible(userId: string, resourceId: string): Promise<ImportableResource | null>;
  };
  /** Looks up the CURRENT stored object at a path; null when missing. Required: files are only served/copied while the stored object is the one bound to the resource. */
  objects?: { stat(path: string): Promise<StoredObject | null> };
  documents: {
    findByIdempotencyKey(userId: string, key: string): Promise<{ id: string; status: string } | null>;
    /** Inserts an `uploaded` document row owned by userId. */
    insertUploaded(row: { userId: string; title: string; courseId: string | null; originalFilename: string | null; storagePath: string; mimeType: string; sizeBytes: number; idempotencyKey: string }): Promise<{ id: string }>;
    remove(documentId: string): Promise<void>;
  };
  /** Copies between the `resources` and `documents` buckets (service role). */
  storage: { copyToDocuments(srcPath: string, destPath: string): Promise<void>; removeDocument(destPath: string): Promise<void> };
  newId?: () => string;
  now?: () => Date;
}

/** pdf/docx/pptx only: the documents bucket and the extractors do not accept images. Limits mirror core MAX_BYTES. */
export const IMPORTABLE: Record<string, { ext: string; maxBytes: number }> = {
  "application/pdf": { ext: "pdf", maxBytes: 50 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", maxBytes: 25 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: "pptx", maxBytes: 50 * 1024 * 1024 },
};

/**
 * The object at res.storagePath must be exactly the one bound when the resource was created (id, and etag/size when
 * recorded): an owner replacing the file after review would otherwise swap approved content. Fails closed: no binding,
 * no verifier, a missing object or any mismatch all read as "not found".
 */
export async function verifyBoundObject(deps: Pick<ImportDeps, "objects">, res: ImportableResource): Promise<void> {
  const notFound = () => new PipelineError("not_found", "Resource not found", false);
  if (!res.storagePath || !res.storageObjectId || !deps.objects) throw notFound();
  const o = await deps.objects.stat(res.storagePath);
  if (!o || o.id !== res.storageObjectId) throw notFound();
  if (res.storageEtag && o.etag !== res.storageEtag) throw notFound();
  if (res.storageSize != null && o.size !== res.storageSize) throw notFound();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function importResource(
  deps: ImportDeps,
  input: { userId: string; resourceId: string },
): Promise<{ documentId: string; job: Job; created: boolean }> {
  if (!UUID.test(input.userId) || !UUID.test(input.resourceId)) throw new PipelineError("bad_request", "Invalid id", false);
  const userId = input.userId.toLowerCase();
  const res = await deps.resources.getVisible(userId, input.resourceId);
  // Not visible to the caller (unpublished, other university, blocked, taken down) is indistinguishable from missing.
  if (!res || (res.status !== "published" && res.uploaderId !== userId)) throw new PipelineError("not_found", "Resource not found", false);
  if (res.status === "removed") throw new PipelineError("not_found", "Resource not found", false);
  if (!res.storagePath || !res.mimeType) throw new PipelineError("bad_request", "Resource has no file", false);
  const kind = IMPORTABLE[res.mimeType];
  if (!kind) throw new PipelineError("unsupported_type", "This file type cannot be studied with AI", false);
  if (!res.sizeBytes || res.sizeBytes < 1 || res.sizeBytes > kind.maxBytes) throw new PipelineError("bad_request", "File size out of range", false);
  // The service-role client bypasses storage RLS: the source path must be inside the uploader's folder.
  assertStoragePath(res.storagePath, res.uploaderId);
  await verifyBoundObject(deps, res);

  const key = `import-resource:${res.id}`;
  let doc: { id: string } | null = await deps.documents.findByIdempotencyKey(userId, key);
  let copiedTo: string | null = null;
  let createdDoc = false;
  if (!doc) {
    const dest = `${userId}/${(deps.newId ?? (() => crypto.randomUUID()))()}.${kind.ext}`;
    assertStoragePath(dest, userId);
    await deps.storage.copyToDocuments(res.storagePath, dest);
    copiedTo = dest;
    try {
      doc = await deps.documents.insertUploaded({
        userId,
        title: res.title.slice(0, 300),
        courseId: res.courseId,
        originalFilename: res.originalFilename,
        storagePath: dest,
        mimeType: res.mimeType,
        sizeBytes: res.sizeBytes,
        idempotencyKey: key,
      });
      createdDoc = true;
    } catch (e) {
      // lost a race with a parallel import: use the winner's row and drop our copy
      const winner = await deps.documents.findByIdempotencyKey(userId, key).catch(() => null);
      await deps.storage.removeDocument(dest).catch(() => {});
      if (!winner) throw new PipelineError("import_failed", "Could not create the document", true);
      doc = winner;
      copiedTo = null;
    }
  }
  try {
    const { job, created } = await submitDocument({ repo: deps.repo, ...(deps.now ? { now: deps.now } : {}) }, { documentId: doc.id, userId });
    return { documentId: doc.id, job, created };
  } catch (e) {
    // Quota/enqueue refused: leave nothing behind from THIS call (a pre-existing document is kept).
    if (createdDoc) {
      await deps.documents.remove(doc.id).catch(() => {});
      if (copiedTo) await deps.storage.removeDocument(copiedTo).catch(() => {});
    }
    throw e;
  }
}

/**
 * Authorisation for minting a signed download URL for a resource file (edge function `resource-url`).
 * Returns the storage path to sign; throws not_found for anything the caller may not see.
 */
export async function authorizeResourceDownload(
  deps: Pick<ImportDeps, "resources" | "objects">,
  input: { userId: string; resourceId: string },
): Promise<{ path: string; mimeType: string | null; filename: string | null }> {
  if (!UUID.test(input.userId) || !UUID.test(input.resourceId)) throw new PipelineError("bad_request", "Invalid id", false);
  const res = await deps.resources.getVisible(input.userId.toLowerCase(), input.resourceId);
  if (!res || res.status === "removed" || !res.storagePath) throw new PipelineError("not_found", "Resource not found", false);
  if (res.status !== "published" && res.uploaderId !== input.userId.toLowerCase()) throw new PipelineError("not_found", "Resource not found", false);
  assertStoragePath(res.storagePath, res.uploaderId);
  await verifyBoundObject(deps, res);
  return { path: res.storagePath, mimeType: res.mimeType, filename: res.originalFilename };
}
