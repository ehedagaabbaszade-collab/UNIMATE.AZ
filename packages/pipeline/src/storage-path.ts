import { PipelineError } from "./errors";

// Mirrors the documents/resources CHECK constraints (migration 20260101001500): "<owner uuid>/<flat safe file name>".
const SAFE_PATH = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[A-Za-z0-9._ -]+$/;

/**
 * Asserts a storage path is inside the owner's folder with a flat, safe file name. Call before ANY storage access:
 * the service-role client bypasses storage RLS, so a bad path read from the database must never reach it.
 */
export function assertStoragePath(path: string, ownerId?: string): void {
  const m = typeof path === "string" && path.length <= 512 ? SAFE_PATH.exec(path) : null;
  if (!m || path.includes("..") || (ownerId !== undefined && m[1] !== ownerId.toLowerCase()))
    throw new PipelineError("bad_storage_path", "Invalid storage path", false);
}
